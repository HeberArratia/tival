"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { PlaybookPill, SegmentPill } from "@/components/AppShell";
import { FAKE_INITIATIVES, type FakeInitiative } from "@/lib/fake-data";
import { initiativeTypeById } from "@/lib/initiative-types";
import { loadUserInitiatives } from "@/lib/initiatives-local";
import { segmentsByIds, segmentModeLabel } from "@/lib/segments";

export function InitiativesIndexClient() {
  const [extra, setExtra] = useState<FakeInitiative[]>([]);

  useEffect(() => {
    setExtra(loadUserInitiatives());
  }, []);

  const rows = [...extra, ...FAKE_INITIATIVES];

  return (
    <div className="row-list">
      {rows.map((ini) => {
        const type = initiativeTypeById(ini.typeId);
        const targets = segmentsByIds(ini.targetSegmentIds);
        const inner = (
          <>
            <div>
              <div className="row-title">
                {ini.name}
                <span className="pill pill-initiative">
                  {type?.name ?? ini.typeId}
                </span>
                <PlaybookPill playbookId={ini.playbookId} />
                {targets.map((s) => (
                  <SegmentPill key={s.id} segment={s} />
                ))}
                {ini.userCreated ? (
                  <span className="pill pill-ok">local</span>
                ) : null}
                {ini.comingSoon ? <span className="pill">pronto</span> : null}
              </div>
              <p className="row-sub">{ini.blurb}</p>
              <p className="row-meta">
                entry {type?.entry ?? "—"} ·{" "}
                {ini.segmentMode
                  ? segmentModeLabel(ini.segmentMode)
                  : "sin segmento"}{" "}
                · {ini.slug}
              </p>
            </div>
            <span className="pill">
              {ini.comingSoon ? "pronto" : "abrir"}
            </span>
          </>
        );
        if (ini.comingSoon) {
          return (
            <div
              key={ini.id}
              className="row is-disabled"
              aria-disabled="true"
            >
              {inner}
            </div>
          );
        }
        return (
          <Link
            key={ini.id}
            className="row"
            href={`/iniciativas/${ini.slug}`}
          >
            {inner}
          </Link>
        );
      })}
    </div>
  );
}
