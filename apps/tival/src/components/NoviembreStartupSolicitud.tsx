import type { ReactNode } from "react";
import {
  readNoviembreStartup,
  websiteHref,
  type NoviembreStartupSolicitud,
} from "@/lib/integrations/noviembre-startup";

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li>
      <strong>{label}</strong>
      <div>{children}</div>
    </li>
  );
}

export function NoviembreStartupSolicitudPanel({
  qualification,
}: {
  qualification: Record<string, unknown> | null | undefined;
}) {
  const solicitud = readNoviembreStartup(qualification);
  if (!solicitud) return null;
  return <SolicitudBody solicitud={solicitud} />;
}

function SolicitudBody({ solicitud }: { solicitud: NoviembreStartupSolicitud }) {
  const href = websiteHref(solicitud.contact.website);
  const fund = solicitud.fund.program
    ? `${solicitud.fund.label} · ${solicitud.fund.program.label}`
    : solicitud.fund.label;

  return (
    <div className="panel" style={{ marginBottom: "1rem" }}>
      <p className="panel-kicker">Alfondo</p>
      <h3>Solicitud Noviembre StartUp</h3>
      <ul className="initiative-list" style={{ marginTop: "0.75rem" }}>
        <Row label="Proyecto / empresa">{solicitud.contact.company}</Row>
        <Row label="Fondo">{fund}</Row>
        <Row label="Servicio">{solicitud.service.label}</Row>
        {solicitud.review_progress ? (
          <Row label="Nivel de avance">{solicitud.review_progress.label}</Row>
        ) : null}
        <Row label="Descripción del proyecto">{solicitud.project_description}</Row>
        {href ? (
          <Row label="Página web">
            <a href={href} target="_blank" rel="noreferrer">
              {solicitud.contact.website}
            </a>
          </Row>
        ) : null}
        <Row label="Declaraciones aceptadas">
          <ul>
            {solicitud.declarations.map((item) => (
              <li key={item.id}>{item.text}</li>
            ))}
          </ul>
        </Row>
      </ul>
    </div>
  );
}
