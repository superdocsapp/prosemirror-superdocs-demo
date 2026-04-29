export const SUPERDOCS_BASE = "https://api.superdocs.app";

export function superdocsKey(): string {
  const key = process.env.SUPERDOCS_API_KEY;
  if (!key) throw new Error("SUPERDOCS_API_KEY missing from .env.local");
  return key;
}
