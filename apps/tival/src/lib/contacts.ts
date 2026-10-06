import type { CompanyRow, ContactPhoneRow, ContactRow } from "@/db/schema";
import { listCases, type CaseWithIdentity } from "@/lib/cases";
import { initiativeForCase } from "@/lib/fake-data";
import {
  getContactById,
  listCompaniesForContact,
  listContacts,
  listPhonesForContact,
} from "@/lib/identity";

/** Contacto de directorio = identidad + oportunidades + empresas. */
export type DirectoryContact = {
  contact: ContactRow;
  phones: ContactPhoneRow[];
  companies: CompanyRow[];
  opportunities: CaseWithIdentity[];
};

export async function listDirectoryContacts(): Promise<DirectoryContact[]> {
  const [people, cases] = await Promise.all([listContacts(), listCases()]);
  const byId = new Map<string, DirectoryContact>();

  for (const person of people) {
    const [phones, companies] = await Promise.all([
      listPhonesForContact(person.id),
      listCompaniesForContact(person.id),
    ]);
    byId.set(person.id, {
      contact: person,
      phones,
      companies,
      opportunities: [],
    });
  }

  for (const c of cases) {
    if (!c.contactId) continue;
    let entry = byId.get(c.contactId);
    if (!entry) {
      const person = c.contact;
      if (!person) continue;
      const [phones, companies] = await Promise.all([
        listPhonesForContact(person.id),
        listCompaniesForContact(person.id),
      ]);
      entry = { contact: person, phones, companies, opportunities: [] };
      byId.set(person.id, entry);
    }
    entry.opportunities.push(c);
  }

  return [...byId.values()].sort((a, b) =>
    (a.contact.name ?? "").localeCompare(b.contact.name ?? "", "es")
  );
}

export async function getDirectoryContact(
  id: string
): Promise<DirectoryContact | null> {
  const person = await getContactById(id);
  if (!person) return null;
  const [phones, companies, cases] = await Promise.all([
    listPhonesForContact(id),
    listCompaniesForContact(id),
    listCases(),
  ]);
  return {
    contact: person,
    phones,
    companies,
    opportunities: cases.filter((c) => c.contactId === id),
  };
}

export function opportunitySummaryLine(c: CaseWithIdentity) {
  const ini = initiativeForCase(c);
  return ini?.name ?? "Sin iniciativa";
}
