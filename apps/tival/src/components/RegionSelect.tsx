"use client";

import {
  CHILE_REGION_KEYS,
  CHILE_REGIONS,
  type ChileRegion,
} from "@/lib/chile-regions";

/** Select compacto de región (Chile). */
export function RegionSelect({
  value,
  onChange,
  disabled,
  id,
}: {
  value: ChileRegion | null;
  onChange: (next: ChileRegion | null) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <select
      id={id}
      className="field-select"
      value={value ?? ""}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === "" ? null : (v as ChileRegion));
      }}
    >
      <option value="">Sin región</option>
      {CHILE_REGION_KEYS.map((key) => (
        <option key={key} value={key}>
          {CHILE_REGIONS[key]}
        </option>
      ))}
    </select>
  );
}
