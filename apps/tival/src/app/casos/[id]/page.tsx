import { notFound, redirect } from "next/navigation";
import { getCaseWithEvents } from "@/lib/cases";
import { opportunityHref } from "@/lib/fake-data";

/** Alias legacy `/casos/[id]` → oportunidad bajo iniciativa. */
export default async function CasosDetailRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCaseWithEvents(id).catch(() => null);
  if (!data) notFound();
  redirect(opportunityHref(data.case));
}
