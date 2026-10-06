import { notFound, redirect } from "next/navigation";
import { getCaseWithEvents } from "@/lib/cases";
import { opportunityHref } from "@/lib/fake-data";

export const dynamic = "force-dynamic";

/** Legacy `/oportunidades/[id]` → anidado bajo iniciativa. */
export default async function OportunidadLegacyRedirect({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getCaseWithEvents(id).catch(() => null);
  if (!data) notFound();
  redirect(opportunityHref(data.case));
}
