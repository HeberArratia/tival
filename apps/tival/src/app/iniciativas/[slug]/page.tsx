import { InitiativeShowClient } from "@/components/InitiativeShowClient";

export const dynamic = "force-dynamic";

export default async function IniciativaShowPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return <InitiativeShowClient slug={slug} />;
}
