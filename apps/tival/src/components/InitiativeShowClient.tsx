"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { notFound, useRouter } from "next/navigation";
import { AppShell, PlaybookPill, SegmentPill, Topbar } from "@/components/AppShell";
import { InitiativeFieldDefaults } from "@/components/OpportunityFields";
import { StageRail } from "@/components/ProcessUI";
import {
  FAKE_INITIATIVES,
  playbookMetaById,
  type FakeInitiative,
} from "@/lib/fake-data";
import { initiativeTypeById } from "@/lib/initiative-types";
import { findUserInitiative } from "@/lib/initiatives-local";
import {
  segmentModeLabel,
  segmentsByIds,
} from "@/lib/segments";
import { GLOSSARY } from "@/lib/glossary";

export function InitiativeShowClient({ slug }: { slug: string }) {
  const router = useRouter();
  const [ini, setIni] = useState<FakeInitiative | null | undefined>(undefined);

  useEffect(() => {
    const local = findUserInitiative(slug);
    const seed = FAKE_INITIATIVES.find((i) => i.slug === slug) ?? null;
    setIni(local ?? seed);
  }, [slug]);

  useEffect(() => {
    if (ini?.comingSoon) router.replace("/iniciativas");
  }, [ini, router]);

  if (ini === undefined || ini?.comingSoon) {
    return (
      <AppShell active="iniciativas">
        <Topbar title="Iniciativa" subtitle="Cargando…" />
        <div className="content">
          <p className="empty">…</p>
        </div>
      </AppShell>
    );
  }

  if (!ini) {
    notFound();
  }

  const type = initiativeTypeById(ini.typeId);
  const pb = playbookMetaById(ini.playbookId);
  const targets = segmentsByIds(ini.targetSegmentIds);
  const canvasHref =
    ini.slug === "diagnostico" || ini.slug === "diagnostico-innovacion"
      ? "/procesos/diagnostico"
      : pb.slug === "consultoria"
        ? "/procesos/diagnostico"
        : null;

  return (
    <AppShell active="iniciativas">
      <Topbar
        title={ini.name}
        subtitle={`Iniciativa · tipo ${type?.name ?? ini.typeId} · playbook ${pb.name}`}
        actions={
          <div className="topbar-actions">
            {canvasHref ? (
              <Link className="btn btn-primary" href={canvasHref}>
                Canvas
              </Link>
            ) : null}
            <Link className="btn" href={`/playbooks/${pb.slug}`}>
              Ver playbook
            </Link>
            <Link className="btn" href="/iniciativas">
              ← Iniciativas
            </Link>
          </div>
        }
      />
      <div className="content">
        <div style={{ marginBottom: "1rem" }}>
          <span className="pill pill-initiative">{type?.name}</span>{" "}
          <PlaybookPill playbookId={ini.playbookId} />{" "}
          {targets.map((s) => (
            <span key={s.id} style={{ marginRight: "0.25rem" }}>
              <SegmentPill segment={s} />
            </span>
          ))}
          {ini.userCreated ? <span className="pill pill-ok">local</span> : null}
        </div>

        <div className="panel" style={{ marginBottom: "1.25rem" }}>
          <p className="panel-kicker">Resumen</p>
          <h3>{ini.name}</h3>
          <p className="lede">{ini.blurb}</p>
          <p className="lede">
            Entry <span className="mono">{type?.entry}</span> · playbook
            compatible con tipos: {pb.compatibleTypes.join(", ")}
          </p>
        </div>

        <section className="section">
          <div className="section-head">
            <h2>{GLOSSARY.segmento.term}</h2>
            <span>Target de esta oferta</span>
          </div>
          <div className="panel">
            {targets.length === 0 ? (
              <p className="lede">Sin segmentos declarados.</p>
            ) : (
              <>
                <p className="lede">
                  Modo <strong>{segmentModeLabel(ini.segmentMode)}</strong>
                  {ini.segmentMode === "classify"
                    ? " — form / reglas resuelven el segmento al entrar."
                    : " — el lead entra ya tagged al target."}
                </p>
                <ul className="initiative-list" style={{ marginTop: "0.65rem" }}>
                  {targets.map((s) => (
                    <li key={s.id}>
                      <SegmentPill segment={s} /> {s.name} · {s.blurb}
                    </li>
                  ))}
                </ul>
                <p className="row-meta" style={{ marginTop: "0.65rem" }}>
                  <Link href="/segmentos" style={{ textDecoration: "underline" }}>
                    Ver catálogo del workspace
                  </Link>
                </p>
              </>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Defaults de campos</h2>
            <span>Hereda el esquema del playbook · no lo redefine</span>
          </div>
          <div className="panel">
            <p className="lede" style={{ marginBottom: "0.65rem" }}>
              Al crear una oportunidad, estos valores se precargan. El resto lo
              completa el flujo (form, Calendly, efectos).
            </p>
            <InitiativeFieldDefaults
              fields={pb.opportunityFields ?? []}
              defaults={ini.fieldDefaults}
            />
            <p className="row-meta" style={{ marginTop: "0.65rem" }}>
              <Link
                href={`/playbooks/${pb.slug}`}
                style={{ textDecoration: "underline" }}
              >
                Ver contrato de campos en {pb.name}
              </Link>
            </p>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Config del canal</h2>
            <span>Propio de la iniciativa (no del playbook)</span>
          </div>
          <div className="panel">
            {ini.config && Object.keys(ini.config).length > 0 ? (
              Object.entries(ini.config).map(([k, v]) => (
                <p className="lede" key={k}>
                  <span className="mono">{k}</span> · {v || "—"}
                </p>
              ))
            ) : (
              <p className="lede">Sin config extra.</p>
            )}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <h2>Playbook · {pb.name}</h2>
            <span>
              Etapas · clasificar = trigger → efecto (no columnas S1/S2/S3)
            </span>
          </div>
          <div className="panel">
            <StageRail
              stages={pb.stages}
              currentStageId={null}
              showEffects
              previewMode={!pb.comingSoon}
            />
          </div>
        </section>
      </div>
    </AppShell>
  );
}
