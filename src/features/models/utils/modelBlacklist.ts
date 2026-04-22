const BLOCKED_MODEL_SLUGS = new Set(["gpt-5.1-codex-max"]);

export function isBlacklistedModelSlug(value: string | null | undefined): boolean {
  if (typeof value !== "string") {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  return BLOCKED_MODEL_SLUGS.has(normalized);
}

