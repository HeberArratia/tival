"use client";

import { useState, type ReactNode } from "react";

export type OpportunityTabId = "general" | "productos" | "notas" | "timeline";

export function OpportunityTabs({
  general,
  products,
  notes,
  timeline,
  productsCount = 0,
  notesCount = 0,
  productsTotalLabel,
  initialTab = "general",
}: {
  general: ReactNode;
  products: ReactNode;
  notes: ReactNode;
  timeline: ReactNode;
  productsCount?: number;
  notesCount?: number;
  productsTotalLabel?: string | null;
  initialTab?: OpportunityTabId;
}) {
  const [tab, setTab] = useState<OpportunityTabId>(initialTab);

  return (
    <div className="opp-tabs">
      <div className="view-tabs" role="tablist" aria-label="Secciones">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "general"}
          className={`view-tab ${tab === "general" ? "is-active" : ""}`}
          onClick={() => setTab("general")}
        >
          General
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "productos"}
          className={`view-tab ${tab === "productos" ? "is-active" : ""}`}
          onClick={() => setTab("productos")}
        >
          Productos
          {productsCount > 0 ? (
            <span className="view-tab-count">{productsCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "notas"}
          className={`view-tab ${tab === "notas" ? "is-active" : ""}`}
          onClick={() => setTab("notas")}
        >
          Notas
          {notesCount > 0 ? (
            <span className="view-tab-count">{notesCount}</span>
          ) : null}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "timeline"}
          className={`view-tab ${tab === "timeline" ? "is-active" : ""}`}
          onClick={() => setTab("timeline")}
        >
          Timeline
        </button>
      </div>

      {tab === "productos" && productsTotalLabel ? (
        <p className="row-meta" style={{ margin: "0.65rem 0 0" }}>
          Total · {productsTotalLabel}
        </p>
      ) : null}

      <div className="opp-tab-panel" role="tabpanel">
        {tab === "general" ? general : null}
        {tab === "productos" ? products : null}
        {tab === "notas" ? notes : null}
        {tab === "timeline" ? timeline : null}
      </div>
    </div>
  );
}
