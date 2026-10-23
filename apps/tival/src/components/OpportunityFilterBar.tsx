"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MemberAvatar } from "@/components/MemberAvatar";
import { CLOSING_SCORE_KEYS, closingScoreLabel } from "@/lib/closing-scores";
import { CHILE_REGION_KEYS, chileRegionLabel } from "@/lib/chile-regions";
import { DEAL_FIT_KEYS, dealFitLabel } from "@/lib/deal-fits";
import {
  FILTER_DIMENSIONS,
  FILTER_NONE,
  EMPTY_OPPORTUNITY_FILTERS,
  clearDimension,
  diagnosticoHref,
  dimensionActive,
  dimensionSummary,
  filtersActive,
  meetingDatePresets,
  toggleToken,
  type DiagnosticoView,
  type FilterDimensionId,
  type OpportunityFilterState,
} from "@/lib/opportunity-filters";

type Choice = {
  value: string;
  label: string;
  avatarId?: string;
};

function fold(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

function MultiPanel({
  pinned,
  choices,
  selected,
  onToggle,
  searchPlaceholder,
}: {
  pinned: Choice | null;
  choices: Choice[];
  selected: readonly string[];
  onToggle: (value: string) => void;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState("");
  const searchId = useId();
  const needle = fold(query.trim());
  const visible = needle
    ? choices.filter((choice) => fold(choice.label).includes(needle))
    : choices;
  const searchable = choices.length > 8;

  return (
    <div className="filter-pop" role="group">
      {searchable ? (
        <input
          id={searchId}
          className="filter-pop-search"
          value={query}
          placeholder={searchPlaceholder ?? "Buscar"}
          aria-label={searchPlaceholder ?? "Buscar"}
          onChange={(event) => setQuery(event.target.value)}
        />
      ) : null}
      <div className="filter-options">
        {pinned ? (
          <FilterChoice
            choice={pinned}
            checked={selected.includes(pinned.value)}
            onToggle={onToggle}
          />
        ) : null}
        {pinned && visible.length > 0 ? <div className="filter-pop-rule" /> : null}
        {visible.length === 0 ? (
          <p className="filter-empty-note">Nada con ese nombre.</p>
        ) : (
          visible.map((choice) => (
            <FilterChoice
              key={choice.value}
              choice={choice}
              checked={selected.includes(choice.value)}
              onToggle={onToggle}
            />
          ))
        )}
      </div>
    </div>
  );
}

function FilterChoice({
  choice,
  checked,
  onToggle,
}: {
  choice: Choice;
  checked: boolean;
  onToggle: (value: string) => void;
}) {
  return (
    <label className="filter-option">
      <input
        type="checkbox"
        checked={checked}
        onChange={() => onToggle(choice.value)}
      />
      {choice.avatarId ? (
        <MemberAvatar memberId={choice.avatarId} name={choice.label} size="sm" />
      ) : null}
      <span className="filter-option-label">{choice.label}</span>
    </label>
  );
}

function DatePanel({
  filters,
  onRange,
  onMissing,
}: {
  filters: OpportunityFilterState;
  onRange: (desde: string | null, hasta: string | null) => void;
  onMissing: () => void;
}) {
  const [from, setFrom] = useState(filters.meetingFrom ?? "");
  const [to, setTo] = useState(filters.meetingTo ?? "");
  useEffect(() => {
    setFrom(filters.meetingFrom ?? "");
    setTo(filters.meetingTo ?? "");
  }, [filters.meetingFrom, filters.meetingTo]);
  const presets = meetingDatePresets();
  const missingOnly =
    filters.meetingMissing && !filters.meetingFrom && !filters.meetingTo;

  return (
    <div className="filter-pop filter-pop-date" role="group">
      <div className="filter-presets">
        {presets.map((preset) => {
          const on =
            !filters.meetingMissing &&
            filters.meetingFrom === preset.desde &&
            filters.meetingTo === preset.hasta;
          return (
            <button
              key={preset.id}
              type="button"
              className={`filter-preset ${on ? "is-on" : ""}`}
              aria-pressed={on}
              onClick={() => onRange(preset.desde, preset.hasta)}
            >
              {preset.label}
            </button>
          );
        })}
      </div>
      <div className="filter-date-row">
        <label>
          Desde
          <input
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          />
        </label>
        <label>
          Hasta
          <input
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
          />
        </label>
      </div>
      <div className="filter-date-actions">
        <button
          type="button"
          className={`filter-preset ${missingOnly ? "is-on" : ""}`}
          aria-pressed={missingOnly}
          onClick={onMissing}
        >
          Sin fecha
        </button>
        <button
          type="button"
          className="filter-apply"
          onClick={() => {
            let nextFrom = from || null;
            let nextTo = to || null;
            if (nextFrom && nextTo && nextFrom > nextTo) {
              [nextFrom, nextTo] = [nextTo, nextFrom];
            }
            onRange(nextFrom, nextTo);
          }}
        >
          Aplicar
        </button>
      </div>
    </div>
  );
}

export function OpportunityFilterBar({
  view,
  filters,
  totalCount,
  segments,
  consultants,
  products,
}: {
  view: DiagnosticoView;
  filters: OpportunityFilterState;
  totalCount: number;
  segments: { id: string; code: string; name: string; count: number }[];
  consultants: { id: string; name: string }[];
  products: { key: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState<FilterDimensionId | "add" | null>(null);
  const [draft, setDraft] = useState(filters);
  const live = useRef(filters);
  const pendingHref = useRef<string | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const serverKey = diagnosticoHref(view, filters);

  useEffect(() => {
    if (pendingHref.current && pendingHref.current !== serverKey) return;
    pendingHref.current = null;
    live.current = filters;
    setDraft(filters);
  }, [serverKey, filters]);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) setOpen(null);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(null);
    }
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function commit(next: OpportunityFilterState) {
    const href = diagnosticoHref(view, next);
    pendingHref.current = href;
    live.current = next;
    setDraft(next);
    router.replace(href, { scroll: false });
  }

  function toggleList(
    key: "consultants" | "temperatures" | "fits" | "regions" | "products",
    value: string
  ) {
    const current = live.current;
    commit({ ...current, [key]: toggleToken(current[key], value) });
  }

  const names = {
    consultant: (id: string) =>
      consultants.find((consultant) => consultant.id === id)?.name ?? "Consultor",
    product: (key: string) =>
      products.find((product) => product.key === key)?.name ?? key,
  };

  const available = FILTER_DIMENSIONS.filter(
    (dimension) => !dimensionActive(draft, dimension.id) && open !== dimension.id
  );

  function panelFor(id: FilterDimensionId) {
    if (id === "consultor") {
      return (
        <MultiPanel
          pinned={{ value: FILTER_NONE, label: "Sin consultor" }}
          choices={consultants.map((consultant) => ({
            value: consultant.id,
            label: consultant.name,
            avatarId: consultant.id,
          }))}
          selected={draft.consultants}
          onToggle={(value) => toggleList("consultants", value)}
          searchPlaceholder="Buscar consultor"
        />
      );
    }
    if (id === "temp") {
      return (
        <MultiPanel
          pinned={{ value: FILTER_NONE, label: "Sin temperatura" }}
          choices={CLOSING_SCORE_KEYS.map((key) => ({
            value: key,
            label: closingScoreLabel(key) ?? key,
          }))}
          selected={draft.temperatures}
          onToggle={(value) => toggleList("temperatures", value)}
        />
      );
    }
    if (id === "fit") {
      return (
        <MultiPanel
          pinned={{ value: FILTER_NONE, label: "Sin fit" }}
          choices={DEAL_FIT_KEYS.map((key) => ({
            value: key,
            label: dealFitLabel(key) ?? key,
          }))}
          selected={draft.fits}
          onToggle={(value) => toggleList("fits", value)}
        />
      );
    }
    if (id === "region") {
      return (
        <MultiPanel
          pinned={{ value: FILTER_NONE, label: "Sin región" }}
          choices={CHILE_REGION_KEYS.map((key) => ({
            value: key,
            label: chileRegionLabel(key) ?? key,
          }))}
          selected={draft.regions}
          onToggle={(value) => toggleList("regions", value)}
          searchPlaceholder="Buscar región"
        />
      );
    }
    if (id === "producto") {
      return (
        <MultiPanel
          pinned={{ value: FILTER_NONE, label: "Sin producto" }}
          choices={products.map((product) => ({
            value: product.key,
            label: product.name,
          }))}
          selected={draft.products}
          onToggle={(value) => toggleList("products", value)}
          searchPlaceholder="Buscar producto"
        />
      );
    }
    return (
      <DatePanel
        filters={draft}
        onRange={(desde, hasta) =>
          commit({
            ...live.current,
            meetingFrom: desde,
            meetingTo: hasta,
            meetingMissing: false,
          })
        }
        onMissing={() =>
          commit({
            ...live.current,
            meetingFrom: null,
            meetingTo: null,
            meetingMissing: true,
          })
        }
      />
    );
  }

  function chip(id: FilterDimensionId, isDraft: boolean) {
    const meta = FILTER_DIMENSIONS.find((dimension) => dimension.id === id)!;
    const summary = isDraft ? null : dimensionSummary(id, live.current, names);
    const text = summary ? `${meta.chip}: ${summary.short}` : `${meta.chip}: elegir`;
    const expanded = open === id;
    return (
      <div
        key={id}
        className="filter-anchor"
        ref={expanded ? anchorRef : undefined}
      >
        <span className={`filter-chip ${isDraft ? "is-draft" : ""}`}>
          <button
            type="button"
            className="filter-chip-main"
            aria-expanded={expanded}
            title={summary?.full ?? meta.label}
            onClick={() => setOpen(expanded ? null : id)}
          >
            {text}
          </button>
          {isDraft ? null : (
            <button
              type="button"
              className="filter-chip-x"
              aria-label={`Quitar ${meta.label.toLowerCase()}`}
              onClick={() => {
                commit(clearDimension(live.current, id));
                if (open === id) setOpen(null);
              }}
            >
              ×
            </button>
          )}
        </span>
        {expanded ? panelFor(id) : null}
      </div>
    );
  }

  return (
    <div className="filter-bar" aria-label="Filtros">
      <button
        type="button"
        className={`pill ${!draft.segment ? "pill-ok" : ""}`}
        onClick={() => commit({ ...live.current, segment: null })}
      >
        Todos · {totalCount}
      </button>
      {segments.map((segment) => (
        <button
          key={segment.id}
          type="button"
          className={`pill ${draft.segment === segment.id ? "pill-segment" : ""}`}
          title={segment.name}
          onClick={() => commit({ ...live.current, segment: segment.id })}
        >
          {segment.code} · {segment.count}
        </button>
      ))}

      <span className="filter-bar-rule" aria-hidden />

      {FILTER_DIMENSIONS.filter(
        (dimension) =>
          dimensionActive(draft, dimension.id) || open === dimension.id
      ).map((dimension) =>
        chip(dimension.id, !dimensionActive(draft, dimension.id))
      )}

      {available.length > 0 ? (
        <div className="filter-anchor" ref={open === "add" ? anchorRef : undefined}>
          <button
            type="button"
            className="filter-add"
            aria-expanded={open === "add"}
            onClick={() => setOpen(open === "add" ? null : "add")}
          >
            Agregar filtro
          </button>
          {open === "add" ? (
            <div className="filter-pop" role="menu">
              {available.map((dimension) => (
                <button
                  key={dimension.id}
                  type="button"
                  className="filter-menu-item"
                  role="menuitem"
                  onClick={() => setOpen(dimension.id)}
                >
                  {dimension.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {filtersActive(draft) ? (
        <button
          type="button"
          className="filter-clear"
          onClick={() => {
            setOpen(null);
            commit({ ...EMPTY_OPPORTUNITY_FILTERS });
          }}
        >
          Quitar filtros
        </button>
      ) : null}
    </div>
  );
}
