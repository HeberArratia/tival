import { memberById, memberInitials } from "@/lib/members-catalog";

const TONES = ["a", "b", "c", "d", "e"] as const;

function toneForId(id: string): (typeof TONES)[number] {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h + id.charCodeAt(i) * (i + 1)) % 997;
  return TONES[h % TONES.length]!;
}

export function MemberAvatar({
  memberId,
  name,
  size = "md",
  title,
  empty = false,
}: {
  memberId?: string | null;
  name?: string | null;
  size?: "sm" | "md";
  title?: string;
  /** Placeholder cuando no hay consultor asignado */
  empty?: boolean;
}) {
  const member = memberId ? memberById(memberId) : null;
  const displayName = name ?? member?.name ?? null;

  if (!displayName && !empty) return null;

  if (!displayName) {
    return (
      <span
        className={`member-avatar member-avatar-${size} is-empty`}
        title={title ?? "Sin consultor"}
        aria-label={title ?? "Sin consultor"}
      >
        ?
      </span>
    );
  }

  const id = memberId ?? displayName;
  const initials = memberInitials(displayName);
  return (
    <span
      className={`member-avatar member-avatar-${size} tone-${toneForId(id)}`}
      title={title ?? displayName}
      aria-label={title ?? displayName}
    >
      {initials}
    </span>
  );
}
