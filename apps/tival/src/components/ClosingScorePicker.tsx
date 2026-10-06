"use client";

import {
  CLOSING_SCORE_KEYS,
  CLOSING_SCORES,
  type ClosingScore,
} from "@/lib/closing-scores";

export function ClosingScorePicker({
  value,
  onChange,
  disabled,
  /** Si true, volver a clickear la opción seleccionada la limpia. */
  allowClear = false,
}: {
  value: ClosingScore | null;
  onChange: (next: ClosingScore | null) => void;
  disabled?: boolean;
  allowClear?: boolean;
}) {
  const hasSelection = value !== null;

  return (
    <div
      className={`closing-score-picker${hasSelection ? " has-selection" : ""}`}
      role="radiogroup"
      aria-label="Closing score"
    >
      {CLOSING_SCORE_KEYS.map((key) => {
        const s = CLOSING_SCORES[key];
        const selected = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={selected}
            className={`closing-score-option${selected ? " is-selected" : ""}`}
            disabled={disabled}
            onClick={() => {
              if (selected) {
                if (allowClear) onChange(null);
                return;
              }
              onChange(key);
            }}
          >
            <span className="closing-score-mark" aria-hidden>
              {selected ? "✓" : ""}
            </span>
            <span className="closing-score-emoji" aria-hidden>
              {s.emoji}
            </span>
            <span className="closing-score-text">
              <strong>{s.label}</strong>
              <span>{s.description}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
