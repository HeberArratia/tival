/**
 * Búsqueda global de directorio: contactos, empresas y oportunidades.
 * Campos: nombre, email, teléfono (primary + secundarios), RUT.
 */

import { getDb } from "@/db";
import { contactPhones, type ContactPhoneRow } from "@/db/schema";
import { caseTitle, listCases, type CaseWithIdentity } from "@/lib/cases";
import {
  FAKE_CONTACT_PHONES,
  initiativeForCase,
  isFakeDataEnabled,
  opportunityHref,
} from "@/lib/fake-data";
import {
  listCompanies,
  listContacts,
  normalizeEmail,
  normalizePhone,
  normalizeRut,
} from "@/lib/identity";

export type SearchResultType = "contact" | "company" | "opportunity";

export type SearchResult = {
  type: SearchResultType;
  id: string;
  title: string;
  subtitle: string;
  href: string;
};

const DEFAULT_LIMIT = 24;
const PER_TYPE = 8;
const MIN_QUERY = 2;

function digitsOnly(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function haystackIncludes(
  haystack: string | null | undefined,
  needle: string
): boolean {
  if (!haystack || !needle) return false;
  return haystack.toLowerCase().includes(needle);
}

function phoneMatches(
  phone: string | null | undefined,
  q: string,
  qDigits: string
): boolean {
  if (!phone) return false;
  if (haystackIncludes(phone, q)) return true;
  if (!qDigits) return false;
  const normalized = normalizePhone(phone);
  return !!normalized && normalized.includes(qDigits);
}

function rutMatches(
  rut: string | null | undefined,
  q: string,
  qRut: string
): boolean {
  if (!rut) return false;
  if (haystackIncludes(rut, q)) return true;
  if (!qRut) return false;
  const normalized = normalizeRut(rut);
  return !!normalized && normalized.includes(qRut);
}

function contactMatches(
  contact: {
    name?: string | null;
    email?: string | null;
    primaryPhone?: string | null;
  },
  phones: ContactPhoneRow[],
  q: string,
  qEmail: string | null,
  qDigits: string
): boolean {
  if (haystackIncludes(contact.name, q)) return true;
  if (qEmail && haystackIncludes(contact.email, qEmail)) return true;
  if (haystackIncludes(contact.email, q)) return true;
  if (phoneMatches(contact.primaryPhone, q, qDigits)) return true;
  for (const p of phones) {
    if (phoneMatches(p.phone, q, qDigits)) return true;
  }
  return false;
}

function companyMatches(
  company: { name?: string | null; rut?: string | null },
  q: string,
  qRut: string
): boolean {
  if (haystackIncludes(company.name, q)) return true;
  if (rutMatches(company.rut, q, qRut)) return true;
  return false;
}

function opportunityMatches(
  c: CaseWithIdentity,
  phonesByContact: Map<string, ContactPhoneRow[]>,
  q: string,
  qEmail: string | null,
  qDigits: string,
  qRut: string
): boolean {
  if (
    c.contact &&
    contactMatches(
      c.contact,
      phonesByContact.get(c.contact.id) ?? [],
      q,
      qEmail,
      qDigits
    )
  ) {
    return true;
  }
  if (c.company && companyMatches(c.company, q, qRut)) return true;
  return false;
}

function contactSubtitle(contact: {
  email?: string | null;
  primaryPhone?: string | null;
}): string {
  const parts = [contact.email, contact.primaryPhone].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Contacto";
}

function companySubtitle(company: { rut?: string | null }): string {
  return company.rut ? `RUT ${company.rut}` : "Empresa";
}

function opportunitySubtitle(c: CaseWithIdentity): string {
  const ini = initiativeForCase(c);
  const who = c.contact?.name || c.contact?.email || null;
  const parts = [ini?.name, who].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : "Oportunidad";
}

async function loadAllPhones(): Promise<ContactPhoneRow[]> {
  if (isFakeDataEnabled()) return [...FAKE_CONTACT_PHONES];
  const db = await getDb();
  return db.select().from(contactPhones);
}

function groupPhones(
  phones: ContactPhoneRow[]
): Map<string, ContactPhoneRow[]> {
  const map = new Map<string, ContactPhoneRow[]>();
  for (const p of phones) {
    const list = map.get(p.contactId) ?? [];
    list.push(p);
    map.set(p.contactId, list);
  }
  return map;
}

export async function searchDirectory(
  rawQuery: string,
  options?: { limit?: number }
): Promise<SearchResult[]> {
  const q = rawQuery.trim().toLowerCase();
  if (q.length < MIN_QUERY) return [];

  const limit = options?.limit ?? DEFAULT_LIMIT;
  const qEmail = normalizeEmail(q);
  const qDigits = digitsOnly(q);
  const qRut = normalizeRut(q) ?? "";

  const [people, companies, cases, phones] = await Promise.all([
    listContacts(),
    listCompanies(),
    listCases(),
    loadAllPhones(),
  ]);
  const phonesByContact = groupPhones(phones);

  const contactsOut: SearchResult[] = [];
  for (const person of people) {
    if (contactsOut.length >= PER_TYPE) break;
    const personPhones = phonesByContact.get(person.id) ?? [];
    if (!contactMatches(person, personPhones, q, qEmail, qDigits)) {
      continue;
    }
    contactsOut.push({
      type: "contact",
      id: person.id,
      title: person.name?.trim() || person.email || "Sin nombre",
      subtitle: contactSubtitle(person),
      href: `/contactos/${person.id}`,
    });
  }

  const companiesOut: SearchResult[] = [];
  for (const company of companies) {
    if (companiesOut.length >= PER_TYPE) break;
    if (!companyMatches(company, q, qRut)) continue;
    companiesOut.push({
      type: "company",
      id: company.id,
      title: company.name?.trim() || company.rut || "Sin nombre",
      subtitle: companySubtitle(company),
      href: `/empresas/${company.id}`,
    });
  }

  const oppsOut: SearchResult[] = [];
  for (const c of cases) {
    if (oppsOut.length >= PER_TYPE) break;
    if (!opportunityMatches(c, phonesByContact, q, qEmail, qDigits, qRut)) {
      continue;
    }
    oppsOut.push({
      type: "opportunity",
      id: c.id,
      title: caseTitle(c),
      subtitle: opportunitySubtitle(c),
      href: opportunityHref(c),
    });
  }

  return [...contactsOut, ...companiesOut, ...oppsOut].slice(0, limit);
}
