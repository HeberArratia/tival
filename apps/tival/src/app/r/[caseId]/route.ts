import { NextResponse } from "next/server";
import { getCaseWithEvents } from "@/lib/cases";
import { listPhonesForContact } from "@/lib/identity";
import { resolveReagendaDestination } from "@/lib/reagenda-link";

export const dynamic = "force-dynamic";

function unavailableHtml(message: string) {
  const safe = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Link no disponible</title>
  <style>
    body { font-family: system-ui, sans-serif; margin: 0; min-height: 100vh;
      display: grid; place-items: center; background: #f6f4f0; color: #1a1a1a; }
    main { max-width: 28rem; padding: 2rem; text-align: center; }
    h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
    p { margin: 0; color: #555; line-height: 1.45; }
  </style>
</head>
<body>
  <main>
    <h1>Link no disponible</h1>
    <p>${safe}</p>
  </main>
</body>
</html>`;
}

/**
 * Link público de reagenda: resuelve destino Calendly al vuelo
 * (reschedule nativo si el slot no pasó; booking prefildado post no-show).
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ caseId: string }> }
) {
  const { caseId } = await context.params;
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) {
    return new NextResponse(
      unavailableHtml("Este link de reagenda no es válido."),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const data = await getCaseWithEvents(caseId).catch(() => null);
  if (!data) {
    return new NextResponse(
      unavailableHtml("Este link de reagenda no es válido."),
      { status: 404, headers: { "Content-Type": "text/html; charset=utf-8" } }
    );
  }

  const { case: c } = data;
  const phones = c.contactId
    ? await listPhonesForContact(c.contactId).catch(() => [])
    : [];
  const dest = resolveReagendaDestination(c, {
    phone: c.contact?.primaryPhone ?? phones[0]?.phone ?? null,
  });

  if (!dest.ok) {
    const status =
      dest.reason === "not_found"
        ? 404
        : dest.reason === "expired"
          ? 410
          : 404;
    return new NextResponse(unavailableHtml(dest.message), {
      status,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  return NextResponse.redirect(dest.url, 302);
}
