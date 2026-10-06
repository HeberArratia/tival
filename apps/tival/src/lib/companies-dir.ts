import type { CompanyRow, ContactRow } from "@/db/schema";
import { listCases, type CaseWithIdentity } from "@/lib/cases";
import {
  getCompanyById,
  listCompanies,
  listContacts,
} from "@/lib/identity";
import { FAKE_CONTACT_COMPANIES, isFakeDataEnabled } from "@/lib/fake-data";
import { getDb } from "@/db";
import { contactCompanies } from "@/db/schema";
import { eq } from "drizzle-orm";

export type DirectoryCompany = {
  company: CompanyRow;
  contacts: ContactRow[];
  opportunities: CaseWithIdentity[];
};

async function contactIdsForCompany(companyId: string): Promise<string[]> {
  if (isFakeDataEnabled()) {
    return FAKE_CONTACT_COMPANIES.filter((x) => x.companyId === companyId).map(
      (x) => x.contactId
    );
  }
  const db = await getDb();
  const links = await db
    .select()
    .from(contactCompanies)
    .where(eq(contactCompanies.companyId, companyId));
  return links.map((l) => l.contactId);
}

export async function listDirectoryCompanies(): Promise<DirectoryCompany[]> {
  const [cos, cases, people] = await Promise.all([
    listCompanies(),
    listCases(),
    listContacts(),
  ]);
  const peopleById = new Map(people.map((p) => [p.id, p]));

  const out: DirectoryCompany[] = [];
  for (const company of cos) {
    const cids = await contactIdsForCompany(company.id);
    out.push({
      company,
      contacts: cids
        .map((id) => peopleById.get(id))
        .filter((x): x is ContactRow => !!x),
      opportunities: cases.filter((c) => c.companyId === company.id),
    });
  }
  return out.sort((a, b) =>
    (a.company.name ?? "").localeCompare(b.company.name ?? "", "es")
  );
}

export async function getDirectoryCompany(
  id: string
): Promise<DirectoryCompany | null> {
  const company = await getCompanyById(id);
  if (!company) return null;
  const [cids, cases, people] = await Promise.all([
    contactIdsForCompany(id),
    listCases(),
    listContacts(),
  ]);
  const peopleById = new Map(people.map((p) => [p.id, p]));
  return {
    company,
    contacts: cids
      .map((cid) => peopleById.get(cid))
      .filter((x): x is ContactRow => !!x),
    opportunities: cases.filter((c) => c.companyId === id),
  };
}
