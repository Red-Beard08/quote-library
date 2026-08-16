/* Supplies pure normalization, parsing, hashing, managed-block, and filename helpers. */

export const INDEX_START = "<!-- quote-library:index:start -->";
export const INDEX_END = "<!-- quote-library:index:end -->";
export const TOPIC_START = "<!-- quote-library:topic:start -->";
export const TOPIC_END = "<!-- quote-library:topic:end -->";
export const QUOTE_START = "<!-- quote-library:quote:start -->";
export const QUOTE_END = "<!-- quote-library:quote:end -->";

export function normalizeName(value: string): string { return value.trim().replace(/^["']|["']$/g, "").trim().replace(/\s+/g, " "); }
export function topicKey(value: string): string { return normalizeName(value).toLocaleLowerCase(); }
export function stableNames(values: string[]): string[] {
  const found = new Map<string, string>();
  for (const value of values) { const name = normalizeName(value); if (name && !found.has(topicKey(name))) found.set(topicKey(name), name); }
  return [...found.values()].sort((a, b) => a.localeCompare(b));
}
export function normalizeQuoteText(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/[“”„‟]/g, '"').replace(/[‘’‚‛]/g, "'").replace(/[—–]/g, "-").replace(/\s+/g, " ").trim();
}
export function duplicateKey(text: string, author = ""): string { return `${normalizeQuoteText(text)}\u241f${topicKey(author)}`; }
export function textDuplicateKey(text: string): string { return normalizeQuoteText(text); }
export function shortExcerpt(text: string, length = 48): string {
  const plain = text.replace(/\s+/g, " ").trim().replace(/[\\/:*?"<>|#^[\]]/g, "-");
  return (plain.slice(0, length).trim() || "Quote").replace(/[. ]+$/g, "");
}
export function safeFilename(value: string): string { return value.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim().slice(0, 120) || "Quote"; }
export function recordId(prefix = "QTE", guid = randomGuid()): string { return `${prefix}-${normalizeGuid(guid)}`; }
export function deterministicRecordId(prefix: string, seed: string): string {
  const hex = [0, 1, 2, 3].map(index => contentHash(`${index}:${seed}`).padStart(8, "0")).join("").toUpperCase().split("");
  hex[12] = "5"; hex[16] = ["8", "9", "A", "B"][Number.parseInt(hex[16], 16) % 4];
  return recordId(prefix, formatGuid(hex.join("")));
}
export function isTimestampRecordId(value: string, prefix = "QTE"): boolean { return new RegExp(`^${prefix}-\\d{8}-\\d{6}-[A-Z0-9]{4}$`, "i").test(value); }
export function randomGuid(): string {
  const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return formatGuid([...bytes].map(byte => byte.toString(16).padStart(2, "0")).join(""));
}
function normalizeGuid(value: string): string { const compact = value.replace(/-/g, "").toUpperCase(); if (!/^[A-F0-9]{32}$/.test(compact)) throw new Error("A valid GUID is required."); return formatGuid(compact); }
function formatGuid(hex: string): string { return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`.toUpperCase(); }
export function isoMinute(date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}
export function dateKey(date = new Date()): string { return isoMinute(date).slice(0, 10); }
export function stableHash(value: string): number { let hash = 2166136261; for (let i = 0; i < value.length; i++) { hash ^= value.charCodeAt(i); hash = Math.imul(hash, 16777619); } return hash >>> 0; }
export function dailyIndex(ids: string[], day: string, offset = 0): number { return ids.length ? (stableHash(`${day}:${ids.join("|")}`) + offset) % ids.length : -1; }
export function contentHash(value: string): string { return stableHash(value).toString(16).padStart(8, "0"); }
export async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value); const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

export interface ParsedNote { frontmatter: Record<string, unknown>; body: string; prefix: string; }
export function parseNote(content: string): ParsedNote {
  if (!content.startsWith("---\n")) return { frontmatter: {}, body: content, prefix: "" };
  const end = content.indexOf("\n---\n", 4);
  if (end < 0) return { frontmatter: {}, body: content, prefix: "" };
  const frontmatter: Record<string, unknown> = {};
  const lines = content.slice(4, end).split("\n");
  let listKey = ""; let blockKey = ""; const block: string[] = [];
  const flushBlock = () => { if (blockKey) { frontmatter[blockKey] = block.map(line => line.replace(/^\s{2}/, "")).join("\n").trimEnd(); blockKey = ""; block.length = 0; } };
  for (const line of lines) {
    if (blockKey && /^\s+/.test(line)) { block.push(line); continue; }
    flushBlock();
    const list = /^\s+-\s+(.*)$/.exec(line);
    if (list && listKey) { const current = frontmatter[listKey]; if (Array.isArray(current)) current.push(yamlScalar(list[1])); continue; }
    const pair = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line); if (!pair) continue;
    const [, key, raw] = pair;
    if (raw === "|-" || raw === "|") { blockKey = key; listKey = ""; continue; }
    if (!raw || raw === "[]") { frontmatter[key] = []; listKey = key; }
    else { frontmatter[key] = yamlScalar(raw); listKey = ""; }
  }
  flushBlock();
  return { frontmatter, body: content.slice(end + 5), prefix: content.slice(0, end + 5) };
}
function yamlScalar(raw: string): string | boolean {
  const value = raw.trim(); if (value === "true") return true; if (value === "false") return false;
  if (value.startsWith('"')) { try { return JSON.parse(value) as string; } catch { return value.slice(1, -1); } }
  return value.replace(/^['"]|['"]$/g, "");
}
export function scalar(value: unknown): string { return Array.isArray(value) ? String(value[0] ?? "") : typeof value === "boolean" ? String(value) : String(value ?? ""); }
export function strings(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : typeof value === "string" && value ? [value] : []; }
export function bool(value: unknown): boolean { return value === true || scalar(value).toLocaleLowerCase() === "true"; }
export function yamlString(value: string): string { return JSON.stringify(value); }
export function yamlList(values: string[]): string { return values.length ? values.map(value => `  - ${yamlString(value)}`).join("\n") : "  []"; }
export function replaceManagedBlock(content: string, start: string, end: string, body: string): string {
  const block = `${start}\n${body.trim()}\n${end}`; const from = content.indexOf(start); const to = content.indexOf(end);
  if (from >= 0 && to >= from) return `${content.slice(0, from)}${block}${content.slice(to + end.length)}`;
  return `${content.trimEnd()}\n\n${block}\n`;
}
export function bodySection(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\n)## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`).exec(body)?.[1]?.trim() ?? "";
}
export function knownLegacyBody(body: string): boolean { return /`=this\.quote_text`\s+[—â€”-]+\s+\*\*`=this\.quote_author`\*\*/.test(body); }
export function removeKnownLegacyBody(body: string): string {
  return body.split("\n").filter(line => !/^#quote\s*$/.test(line.trim()) && !/`=this\.quote_text`/.test(line)).join("\n").trim();
}
