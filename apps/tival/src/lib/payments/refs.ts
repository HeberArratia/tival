import { getWorkspacePack } from "@/lib/workspace/registry";

/** Arma external_reference estilo Alfondo: diag_{calendlyEventUuid} */
export function toPaymentExternalReference(
  calendlyEventUuid: string,
  workspaceSlug?: string
) {
  const pack = getWorkspacePack(workspaceSlug);
  const prefix = pack.mpExternalRefPrefix ?? "";
  const id = calendlyEventUuid.trim();
  if (prefix && id.startsWith(prefix)) return id;
  return `${prefix}${id}`;
}

/** Extrae calendlyEventUuid desde diag_…, UUID crudo, o null. */
export function parsePaymentExternalReference(
  ref: string | null | undefined,
  workspaceSlug?: string
): string | null {
  if (!ref?.trim()) return null;
  const trimmed = ref.trim();
  const pack = getWorkspacePack(workspaceSlug);
  const prefix = pack.mpExternalRefPrefix;
  if (prefix && trimmed.startsWith(prefix)) {
    const id = trimmed.slice(prefix.length).trim();
    return id || null;
  }
  // UUID pelado
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      trimmed
    )
  ) {
    return trimmed;
  }
  return null;
}
