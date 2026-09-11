/* Shared Foundation adapters used without changing Quote Library's public schema. */

import { hashText as foundationSha256Digest, normalizeVaultPath, replaceManagedBlockIfChanged } from "./foundation-vendor";

/** Keep Quote Library's stricter absolute-path behavior while using the shared normalizer. */
export function normalizeQuotePath(value: string): string {
  const raw = String(value ?? "").trim();
  if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(raw)) throw new Error("Paths must be vault-relative, not absolute.");
  const normalized = normalizeVaultPath(raw);
  if (!normalized) throw new Error("Paths must be normal vault-relative paths.");
  return normalized;
}

export function foundationManagedBlock(text: string, start: string, end: string, body: string): string {
  return replaceManagedBlockIfChanged(text, { start, end }, body).text;
}

export async function foundationSha256(value: string): Promise<string> {
  return foundationSha256Digest(value);
}
