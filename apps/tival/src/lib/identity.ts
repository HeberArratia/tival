/**
 * Identidad: contacto (persona) + empresa (sociedad).
 * Teléfonos se acumulan; primary solo se setea si estaba vacío.
 * Empresa primaria del deal vive en cases.company_id.
 */

import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "crypto";
import { getDb } from "@/db";
import {
  companies,
  contactCompanies,
  contactPhones,
  contacts,
  type CompanyRow,
  type ContactPhoneRow,
  type ContactRow,
} from "@/db/schema";
import {
  FAKE_COMPANIES,
  FAKE_CONTACT_COMPANIES,
  FAKE_CONTACT_PHONES,
  FAKE_CONTACTS,
  isFakeDataEnabled,
} from "@/lib/fake-data";

export function normalizeEmail(email?: string | null): string | null {
  const v = email?.trim().toLowerCase();
  return v || null;
}

/** Normaliza teléfono para dedup (espacios/guiones/paréntesis). */
export function normalizePhone(phone?: string | null): string | null {
  if (!phone) return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^\d]/g, "");
  if (!digits) return null;
  return hasPlus ? `+${digits}` : digits;
}

export function normalizeRut(rut?: string | null): string | null {
  if (!rut) return null;
  const cleaned = rut
    .trim()
    .toUpperCase()
    .replace(/\./g, "")
    .replace(/\s/g, "");
  return cleaned || null;
}

export type ResolveContactInput = {
  workspaceId: string;
  email?: string | null;
  name?: string | null;
  phone?: string | null;
  phoneSource?: string | null;
};

export async function resolveContact(
  input: ResolveContactInput
): Promise<ContactRow> {
  const db = await getDb();
  const email = normalizeEmail(input.email);
  const phone = normalizePhone(input.phone);
  const name = input.name?.trim() || null;

  if (email) {
    const [existing] = await db
      .select()
      .from(contacts)
      .where(
        and(eq(contacts.workspaceId, input.workspaceId), eq(contacts.email, email))
      )
      .limit(1);

    if (existing) {
      const patch: Partial<ContactRow> = { updatedAt: new Date() };
      if (name && (!existing.name || existing.name === "Sin nombre")) {
        patch.name = name;
      }
      if (phone && !existing.primaryPhone) {
        patch.primaryPhone = phone;
      }
      const [updated] = await db
        .update(contacts)
        .set(patch)
        .where(eq(contacts.id, existing.id))
        .returning();
      if (phone) {
        await addContactPhone({
          contactId: updated.id,
          phone,
          source: input.phoneSource ?? "ingest",
        });
      }
      return updated;
    }
  }

  const [created] = await db
    .insert(contacts)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      email,
      name,
      primaryPhone: phone,
    })
    .returning();

  if (phone) {
    await addContactPhone({
      contactId: created.id,
      phone,
      source: input.phoneSource ?? "ingest",
    });
  }
  return created;
}

export async function addContactPhone(input: {
  contactId: string;
  phone: string;
  source?: string | null;
}): Promise<ContactPhoneRow | null> {
  const phone = normalizePhone(input.phone);
  if (!phone) return null;

  const db = await getDb();
  const [existing] = await db
    .select()
    .from(contactPhones)
    .where(
      and(
        eq(contactPhones.contactId, input.contactId),
        eq(contactPhones.phone, phone)
      )
    )
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(contactPhones)
    .values({
      id: randomUUID(),
      contactId: input.contactId,
      phone,
      source: input.source ?? null,
    })
    .returning();
  return row;
}

export type ResolveCompanyInput = {
  workspaceId: string;
  rut?: string | null;
  name?: string | null;
  region?: string | null;
  societyType?: string | null;
  antiquity?: string | null;
  sales12m?: string | null;
  giro?: string | null;
};

/**
 * Empresa primaria solo con RUT de facturación.
 * Sin RUT → null (persona natural; cases.company_id queda null).
 * El nombre solo enriquece; no alcanza para crear/ligar.
 */
export async function resolveCompany(
  input: ResolveCompanyInput
): Promise<CompanyRow | null> {
  const rut = normalizeRut(input.rut);
  if (!rut) return null;
  const name = input.name?.trim() || null;

  const db = await getDb();

  const [existing] = await db
    .select()
    .from(companies)
    .where(
      and(eq(companies.workspaceId, input.workspaceId), eq(companies.rut, rut))
    )
    .limit(1);

  if (existing) {
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (name && !existing.name) patch.name = name;
    if (input.societyType && !existing.societyType)
      patch.societyType = input.societyType;
    if (input.antiquity && !existing.antiquity)
      patch.antiquity = input.antiquity;
    if (input.sales12m && !existing.sales12m) {
      patch.sales12m = input.sales12m;
      patch.sales12mAt = new Date();
    }
    if (input.giro && !existing.giro) patch.giro = input.giro;
    const [updated] = await db
      .update(companies)
      .set(patch)
      .where(eq(companies.id, existing.id))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(companies)
    .values({
      id: randomUUID(),
      workspaceId: input.workspaceId,
      rut,
      name,
      societyType: input.societyType ?? null,
      antiquity: input.antiquity ?? null,
      sales12m: input.sales12m ?? null,
      sales12mAt: input.sales12m ? new Date() : null,
      giro: input.giro ?? null,
    })
    .returning();
  return created;
}

export async function linkContactCompany(
  contactId: string,
  companyId: string,
  role?: string | null
) {
  const db = await getDb();
  const [existing] = await db
    .select()
    .from(contactCompanies)
    .where(
      and(
        eq(contactCompanies.contactId, contactId),
        eq(contactCompanies.companyId, companyId)
      )
    )
    .limit(1);
  if (existing) return existing;

  const [row] = await db
    .insert(contactCompanies)
    .values({
      id: randomUUID(),
      contactId,
      companyId,
      role: role ?? null,
    })
    .returning();
  return row;
}

export async function isContactLinkedToCompany(
  contactId: string,
  companyId: string
): Promise<boolean> {
  if (isFakeDataEnabled()) {
    return FAKE_CONTACT_COMPANIES.some(
      (x) => x.contactId === contactId && x.companyId === companyId
    );
  }
  const db = await getDb();
  const [row] = await db
    .select()
    .from(contactCompanies)
    .where(
      and(
        eq(contactCompanies.contactId, contactId),
        eq(contactCompanies.companyId, companyId)
      )
    )
    .limit(1);
  return !!row;
}

/** Desliga contacto↔empresa. No borra la empresa. */
export async function unlinkContactCompany(
  contactId: string,
  companyId: string
): Promise<boolean> {
  const db = await getDb();
  const deleted = await db
    .delete(contactCompanies)
    .where(
      and(
        eq(contactCompanies.contactId, contactId),
        eq(contactCompanies.companyId, companyId)
      )
    )
    .returning();
  return deleted.length > 0;
}

export async function updateCompanyFields(
  companyId: string,
  patch: Partial<{
    name: string | null;
    rut: string | null;
    region: string | null;
    societyType: string | null;
    antiquity: string | null;
    sales12m: string | null;
    giro: string | null;
  }>
): Promise<CompanyRow> {
  const db = await getDb();
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.name !== undefined) set.name = patch.name?.trim() || null;
  if (patch.rut !== undefined) set.rut = normalizeRut(patch.rut);
  if (patch.region !== undefined) set.region = patch.region;
  if (patch.societyType !== undefined) set.societyType = patch.societyType;
  if (patch.antiquity !== undefined) set.antiquity = patch.antiquity;
  if (patch.giro !== undefined) set.giro = patch.giro;
  if (patch.sales12m !== undefined) {
    set.sales12m = patch.sales12m;
    if (patch.sales12m) set.sales12mAt = new Date();
  }
  const [updated] = await db
    .update(companies)
    .set(set)
    .where(eq(companies.id, companyId))
    .returning();
  if (!updated) throw new Error("Company not found");
  return updated;
}

export async function getContactById(id: string): Promise<ContactRow | null> {
  if (isFakeDataEnabled()) {
    return FAKE_CONTACTS.find((c) => c.id === id) ?? null;
  }
  const db = await getDb();
  const [row] = await db
    .select()
    .from(contacts)
    .where(eq(contacts.id, id))
    .limit(1);
  return row ?? null;
}

export async function getCompanyById(id: string): Promise<CompanyRow | null> {
  if (isFakeDataEnabled()) {
    return FAKE_COMPANIES.find((c) => c.id === id) ?? null;
  }
  const db = await getDb();
  const [row] = await db
    .select()
    .from(companies)
    .where(eq(companies.id, id))
    .limit(1);
  return row ?? null;
}

export async function listPhonesForContact(
  contactId: string
): Promise<ContactPhoneRow[]> {
  if (isFakeDataEnabled()) {
    return FAKE_CONTACT_PHONES.filter((p) => p.contactId === contactId);
  }
  const db = await getDb();
  return db
    .select()
    .from(contactPhones)
    .where(eq(contactPhones.contactId, contactId));
}

export async function listCompaniesForContact(
  contactId: string
): Promise<CompanyRow[]> {
  if (isFakeDataEnabled()) {
    const ids = FAKE_CONTACT_COMPANIES.filter((x) => x.contactId === contactId).map(
      (x) => x.companyId
    );
    return FAKE_COMPANIES.filter((c) => ids.includes(c.id));
  }
  const db = await getDb();
  const links = await db
    .select()
    .from(contactCompanies)
    .where(eq(contactCompanies.contactId, contactId));
  if (links.length === 0) return [];
  return db
    .select()
    .from(companies)
    .where(
      inArray(
        companies.id,
        links.map((l) => l.companyId)
      )
    );
}

export async function listContacts(workspaceId?: string): Promise<ContactRow[]> {
  if (isFakeDataEnabled()) {
    return [...FAKE_CONTACTS].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", "es")
    );
  }
  const db = await getDb();
  if (workspaceId) {
    return db
      .select()
      .from(contacts)
      .where(eq(contacts.workspaceId, workspaceId))
      .orderBy(contacts.name);
  }
  return db.select().from(contacts).orderBy(contacts.name);
}

export async function listCompanies(workspaceId?: string): Promise<CompanyRow[]> {
  if (isFakeDataEnabled()) {
    return [...FAKE_COMPANIES].sort((a, b) =>
      (a.name ?? "").localeCompare(b.name ?? "", "es")
    );
  }
  const db = await getDb();
  if (workspaceId) {
    return db
      .select()
      .from(companies)
      .where(eq(companies.workspaceId, workspaceId))
      .orderBy(companies.name);
  }
  return db.select().from(companies).orderBy(companies.name);
}

/** Carga contactos/empresas por ids (para enriquecer cases). */
export async function loadIdentityMaps(ids: {
  contactIds: string[];
  companyIds: string[];
}): Promise<{
  contactsById: Map<string, ContactRow>;
  companiesById: Map<string, CompanyRow>;
  phonesByContactId: Map<string, ContactPhoneRow[]>;
}> {
  const contactIds = [...new Set(ids.contactIds.filter(Boolean))];
  const companyIds = [...new Set(ids.companyIds.filter(Boolean))];

  if (isFakeDataEnabled()) {
    const contactsById = new Map(
      FAKE_CONTACTS.filter((c) => contactIds.includes(c.id)).map((c) => [
        c.id,
        c,
      ])
    );
    const companiesById = new Map(
      FAKE_COMPANIES.filter((c) => companyIds.includes(c.id)).map((c) => [
        c.id,
        c,
      ])
    );
    const phonesByContactId = new Map<string, ContactPhoneRow[]>();
    for (const id of contactIds) {
      phonesByContactId.set(
        id,
        FAKE_CONTACT_PHONES.filter((p) => p.contactId === id)
      );
    }
    return { contactsById, companiesById, phonesByContactId };
  }

  const db = await getDb();
  const contactRows =
    contactIds.length > 0
      ? await db
          .select()
          .from(contacts)
          .where(inArray(contacts.id, contactIds))
      : [];
  const companyRows =
    companyIds.length > 0
      ? await db
          .select()
          .from(companies)
          .where(inArray(companies.id, companyIds))
      : [];
  const phoneRows =
    contactIds.length > 0
      ? await db
          .select()
          .from(contactPhones)
          .where(inArray(contactPhones.contactId, contactIds))
      : [];

  const phonesByContactId = new Map<string, ContactPhoneRow[]>();
  for (const p of phoneRows) {
    const list = phonesByContactId.get(p.contactId) ?? [];
    list.push(p);
    phonesByContactId.set(p.contactId, list);
  }

  return {
    contactsById: new Map(contactRows.map((c) => [c.id, c])),
    companiesById: new Map(companyRows.map((c) => [c.id, c])),
    phonesByContactId,
  };
}
