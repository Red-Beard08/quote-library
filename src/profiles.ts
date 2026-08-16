/* Provides built-in/custom migration profiles and conservative frontmatter/body extraction. */

import type { MigrationProfile, QuoteRecord } from "./types";
import { bool, bodySection, isoMinute, normalizeName, parseNote, removeKnownLegacyBody, scalar, stableNames, strings } from "./utils";

export const LEGACY_PROFILE: MigrationProfile = { version: 1, id: "quote-library-legacy", name: "Quote Library legacy", builtIn: true, fields: { text: ["quote_text"], author: ["quote_author"], source: ["quote_source"], topics: ["topics"], pinned: ["quote_pin"], archived: ["quote_archive"], created: ["created"], updated: ["updated", "last_updated"], aliases: ["aliases"], tags: ["tags", "Tags"] }, requiredTags: [], requiredTypes: [], body: { strategy: "off", heading: "Quote", attributionLine: true, cleanupKnownLegacyBody: true } };
export const COMMON_PROFILE: MigrationProfile = { version: 1, id: "common-quote-properties", name: "Common quote properties", builtIn: true, fields: { text: ["quote", "quotation", "text"], author: ["author", "speaker"], source: ["source", "book", "work"], topics: ["topics", "subjects"], pinned: ["pinned", "favorite"], archived: ["archived"], created: ["created", "date"], updated: ["updated", "modified"], aliases: ["aliases"], tags: ["tags"] }, requiredTags: [], requiredTypes: [], body: { strategy: "first-blockquote", heading: "Quote", attributionLine: true, cleanupKnownLegacyBody: false } };
export const BUILT_IN_PROFILES = [LEGACY_PROFILE, COMMON_PROFILE];

export interface ExtractedCandidate { record: QuoteRecord; issues: string[]; confidence: "high" | "manual"; bodyConvertible: boolean; }

export function profiles(custom: MigrationProfile[]): MigrationProfile[] { const ids = new Set(BUILT_IN_PROFILES.map(item => item.id)); return [...BUILT_IN_PROFILES, ...custom.filter(item => !ids.has(item.id))]; }
export function profileById(custom: MigrationProfile[], id: string): MigrationProfile { return profiles(custom).find(item => item.id === id) ?? LEGACY_PROFILE; }

export function validateProfile(value: unknown): MigrationProfile {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("The migration profile must be a JSON object."); const raw = value as Partial<MigrationProfile>;
  if (raw.version !== 1 || !safeId(raw.id) || !String(raw.name ?? "").trim() || !raw.fields || !raw.body) throw new Error("The migration profile is missing version, ID, name, fields, or body rules.");
  const keys = ["text", "author", "source", "topics", "pinned", "archived", "created", "updated", "aliases", "tags"] as const; const fields = {} as MigrationProfile["fields"];
  for (const key of keys) fields[key] = propertyNames(raw.fields[key]); if (!fields.text.length && raw.body.strategy === "off") throw new Error("Map a text property or enable body extraction.");
  const strategy = raw.body.strategy; if (strategy !== "off" && strategy !== "first-blockquote" && strategy !== "heading-blockquote") throw new Error("Unknown body extraction strategy.");
  return { version: 1, id: raw.id!, name: String(raw.name).trim(), fields, requiredTags: stableNames(raw.requiredTags ?? []), requiredTypes: stableNames(raw.requiredTypes ?? []), body: { strategy, heading: String(raw.body.heading || "Quote").trim(), attributionLine: raw.body.attributionLine !== false, cleanupKnownLegacyBody: raw.body.cleanupKnownLegacyBody === true } };
}

export function extractCandidate(content: string, profile: MigrationProfile, path: string, ctime: number, mtime: number): ExtractedCandidate | null {
  const parsed = parseNote(content); const fm = parsed.frontmatter; const tags = mappedStrings(fm, profile.fields.tags).map(value => value.replace(/^#/, "")); const type = scalar(fm.type);
  if (profile.requiredTags.length && !profile.requiredTags.every(required => tags.some(tag => key(tag) === key(required)))) return null;
  if (profile.requiredTypes.length && !profile.requiredTypes.some(required => key(required) === key(type))) return null;
  let text = mappedScalar(fm, profile.fields.text); const authorValues = mappedScalars(fm, profile.fields.author).map(normalizeName).filter(Boolean); let author = authorValues[0] ?? ""; let ambiguousAuthor = new Set(authorValues.map(key)).size > 1; let extracted = false;
  if ((!text || !author) && profile.body.strategy !== "off") { const body = extractBody(parsed.body, profile); if (body) { if (!text) text = body.text; if (!author) author = body.author; else if (body.author && key(body.author) !== key(author)) ambiguousAuthor = true; extracted = true; } }
  text = text.trim(); author = normalizeName(author); if (!text) return null;
  const issues: string[] = []; if (!author) issues.push("missing-author"); else if (ambiguousAuthor) issues.push("ambiguous-author"); const source = normalizeName(mappedScalar(fm, profile.fields.source)); if (!source) issues.push("missing-source");
  const mappedCreated = mappedScalar(fm, profile.fields.created); const mappedUpdated = mappedScalar(fm, profile.fields.updated); if (!mappedCreated || !mappedUpdated) issues.push("missing-timestamp"); const created = mappedCreated || isoMinute(new Date(ctime)); const updated = mappedUpdated || isoMinute(new Date(mtime));
  const notes = bodySection(parsed.body, "Personal notes") || (profile.body.cleanupKnownLegacyBody ? removeKnownLegacyBody(parsed.body) : parsed.body.trim());
  return { record: { id: scalar(fm.id), path, text, author, source, pinned: mappedBool(fm, profile.fields.pinned), archived: mappedBool(fm, profile.fields.archived), topics: stableNames(mappedStrings(fm, profile.fields.topics)), aliases: stableNames(mappedStrings(fm, profile.fields.aliases)), created, updated, notes, legacy: scalar(fm.type) !== "quote-library-quote", duplicateOf: scalar(fm.quote_duplicate_of), duplicateKept: bool(fm.quote_duplicate_keep) }, issues, confidence: issues.includes("missing-author") || issues.includes("ambiguous-author") ? "manual" : "high", bodyConvertible: extracted || profile.body.cleanupKnownLegacyBody };
}

function extractBody(body: string, profile: MigrationProfile): { text: string; author: string } | null {
  const scope = profile.body.strategy === "heading-blockquote" ? section(body, profile.body.heading) : body; const lines = scope.split("\n"); let start = -1; for (let index = 0; index < lines.length; index++) if (/^\s*>/.test(lines[index])) { start = index; break; } if (start < 0) return null;
  const quoted: string[] = []; let index = start; while (index < lines.length && (/^\s*>/.test(lines[index]) || !lines[index].trim())) { if (/^\s*>/.test(lines[index])) quoted.push(lines[index].replace(/^\s*>\s?/, "")); index++; }
  let author = ""; if (profile.body.attributionLine && quoted.length) { const last = quoted[quoted.length - 1].trim(); const match = /^[—–-]\s*(.+)$/.exec(last); if (match) { author = normalizeName(match[1].replace(/^\*\*|\*\*$/g, "")); quoted.pop(); } }
  const text = quoted.join("\n").trim(); return text ? { text, author } : null;
}
function section(body: string, heading: string): string { const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); const match = new RegExp(`(?:^|\\n)(#{1,6})\\s+${escaped}\\s*\\n([\\s\\S]*?)(?=\\n\\1\\s+|$)`, "i").exec(body); return match?.[2] ?? ""; }
function mappedScalar(fm: Record<string, unknown>, names: string[]): string { for (const name of names) { const value = scalar(fm[name]); if (value) return value; } return ""; }
function mappedScalars(fm: Record<string, unknown>, names: string[]): string[] { return names.flatMap(name => strings(fm[name])).filter(Boolean); }
function mappedStrings(fm: Record<string, unknown>, names: string[]): string[] { for (const name of names) { const value = strings(fm[name]); if (value.length) return value; } return []; }
function mappedBool(fm: Record<string, unknown>, names: string[]): boolean { for (const name of names) if (fm[name] !== undefined) return bool(fm[name]); return false; }
function propertyNames(value: unknown): string[] { const names = Array.isArray(value) ? value.map(String) : []; if (names.some(name => !/^[A-Za-z0-9_-]+$/.test(name))) throw new Error("Mapped property names may contain only letters, numbers, underscores, and hyphens."); return [...new Set(names.filter(Boolean))]; }
function safeId(value: unknown): value is string { return typeof value === "string" && /^[a-z0-9][a-z0-9-]{2,48}$/.test(value); }
function key(value: string): string { return normalizeName(value).toLocaleLowerCase(); }
