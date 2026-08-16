/* Upgrades settings and validates portable vault-relative storage and migration paths. */

import type { LibraryLayoutSettings, MigrationDefaults, MigrationRunStatus, QuoteLibrarySettings } from "./types";
import { DEFAULT_LAYOUT, DEFAULT_SETTINGS } from "./types";

type LegacySettings = { rootFolder?: string; backupFolder?: string; preferPinnedForDaily?: boolean; migrationPhase?: string; latestJournalPath?: string; previewSignature?: string };

export function upgradeSettings(value: unknown): QuoteLibrarySettings {
  const stored = object(value); if (stored.settingsVersion === 2) return mergeV2(stored as Partial<QuoteLibrarySettings>);
  if (!Object.keys(stored).length) return clone(DEFAULT_SETTINGS);
  const legacy = stored as LegacySettings; const root = cleanFolder(legacy.rootFolder || DEFAULT_LAYOUT.rootFolder); const backup = cleanFolder(legacy.backupFolder || DEFAULT_LAYOUT.backupFolder);
  const history = legacy.latestJournalPath ? [{ id: "legacy-run", created: "", status: legacyStatus(legacy.migrationPhase), mode: "in-place" as const, sourceFolder: root, targetFolder: root, profileName: "Quote Library legacy", previewSignature: legacy.previewSignature || "", journalPath: cleanFile(legacy.latestJournalPath), total: 0, failures: 0 }] : [];
  return { settingsVersion: 2, layout: { ...DEFAULT_LAYOUT, rootFolder: root, quotesFolder: "", backupFolder: backup }, preferPinnedForDaily: legacy.preferPinnedForDaily !== false, migrationDefaults: { ...DEFAULT_SETTINGS.migrationDefaults, sourceFolder: root, mode: "in-place" }, customProfiles: [], activeMigrationRunId: history[0]?.id || "", migrationHistory: history };
}

function mergeV2(stored: Partial<QuoteLibrarySettings>): QuoteLibrarySettings {
  const layout = { ...DEFAULT_LAYOUT, ...(stored.layout ?? {}) }; const migration = { ...DEFAULT_SETTINGS.migrationDefaults, ...(stored.migrationDefaults ?? {}) };
  return { settingsVersion: 2, layout: { rootFolder: cleanFolder(layout.rootFolder), quotesFolder: cleanOptionalFolder(layout.quotesFolder), topicsFolder: cleanFolder(layout.topicsFolder), indexFile: cleanMarkdownFile(layout.indexFile), backupFolder: cleanFolder(layout.backupFolder) }, preferPinnedForDaily: stored.preferPinnedForDaily !== false, migrationDefaults: { sourceFolder: cleanOptionalFolder(migration.sourceFolder), recursive: migration.recursive !== false, mode: migration.mode === "in-place" ? "in-place" : "copy", profileId: String(migration.profileId || "quote-library-legacy"), excludedPaths: stringArray(migration.excludedPaths).map(cleanFile) }, customProfiles: Array.isArray(stored.customProfiles) ? stored.customProfiles : [], activeMigrationRunId: String(stored.activeMigrationRunId || ""), migrationHistory: Array.isArray(stored.migrationHistory) ? stored.migrationHistory : [] };
}

export function layoutPaths(layout: LibraryLayoutSettings): { root: string; quotes: string; topics: string; index: string; backup: string } {
  const root = cleanFolder(layout.rootFolder); return { root, quotes: join(root, cleanOptionalFolder(layout.quotesFolder)), topics: join(root, cleanFolder(layout.topicsFolder)), index: join(root, cleanMarkdownFile(layout.indexFile)), backup: cleanFolder(layout.backupFolder) };
}

export function validateLayout(layout: LibraryLayoutSettings): string[] {
  const failures: string[] = []; let paths: ReturnType<typeof layoutPaths>; try { paths = layoutPaths(layout); } catch (error) { return [message(error)]; }
  if (paths.quotes !== paths.root && (sameOrInside(paths.topics, paths.quotes) || sameOrInside(paths.quotes, paths.topics))) failures.push("Quotes and Topics locations must not overlap.");
  if (sameOrInside(paths.backup, paths.quotes) || sameOrInside(paths.quotes, paths.backup)) failures.push("The backup folder must not overlap the Quotes location.");
  if (paths.quotes !== paths.root && paths.index.startsWith(`${paths.quotes}/`)) failures.push("The index file must be outside the Quotes location.");
  return failures;
}

export function validateMigration(layout: LibraryLayoutSettings, migration: MigrationDefaults): string[] {
  const failures = validateLayout(layout); const paths = layoutPaths(layout); let source = ""; try { source = cleanFolder(migration.sourceFolder || paths.quotes); } catch (error) { failures.push(message(error)); return failures; }
  if (sameOrInside(paths.backup, source) || sameOrInside(source, paths.backup)) failures.push("The migration source and backup folder must not overlap.");
  if (migration.mode === "copy" && sameOrInside(paths.quotes, source) && sameOrInside(source, paths.quotes)) failures.push("Copy mode requires different source and target folders.");
  return [...new Set(failures)];
}

export function cleanFolder(value: string): string { const result = clean(value); if (!result) throw new Error("Choose a vault-relative folder."); return result; }
export function cleanOptionalFolder(value: string): string { return value.trim() ? cleanFolder(value) : ""; }
export function cleanMarkdownFile(value: string): string { const result = clean(value); if (!result || result.includes("/") || !result.toLocaleLowerCase().endsWith(".md")) throw new Error("Choose a Markdown filename without folders."); return result; }
export function cleanFile(value: string): string { return clean(value); }
export function join(parent: string, child: string): string { return child ? `${parent}/${child}` : parent; }
export function sameOrInside(path: string, parent: string): boolean { const left = path.toLocaleLowerCase(); const right = parent.toLocaleLowerCase(); return left === right || left.startsWith(`${right}/`); }

function clean(value: string): string { const raw = String(value ?? "").trim(); if (/^(?:[A-Za-z]:[\\/]|[\\/])/.test(raw)) throw new Error("Paths must be vault-relative, not absolute."); const normalized = raw.replace(/\\/g, "/").replace(/\/+$/g, "").replace(/\/{2,}/g, "/"); if (normalized.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Paths must be normal vault-relative paths."); return normalized; }
function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function stringArray(value: unknown): string[] { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
function legacyStatus(value: string | undefined): MigrationRunStatus { return value === "verified" ? "verified" : value === "filenames-modernized" ? "filenames-modernized" : value === "schema-migrated" ? "migrated" : "previewed"; }
function message(error: unknown): string { return error instanceof Error ? error.message : "Invalid settings."; }
