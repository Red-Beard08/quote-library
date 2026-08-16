/* Runs previewed, backed-up, journaled, reversible quote schema and filename migrations. */

import { App, normalizePath, TFile } from "obsidian";
import { QuoteRepository } from "./repository";
import type { MigrationIssue, MigrationJournal, MigrationPreview, QuoteLibrarySettings, QuoteRecord, VerificationResult } from "./types";
import { availableRecordId, contentHash, isShortRecordId, isoMinute, knownLegacyBody, normalizeName, parseNote, removeKnownLegacyBody, safeFilename, scalar, sha256, shortExcerpt, stableNames, strings } from "./utils";

export class QuoteMigration {
  constructor(private app: App, private repository: QuoteRepository, private settings: QuoteLibrarySettings, private saveSettings: () => Promise<void>) {}
  updateSettings(settings: QuoteLibrarySettings): void { this.settings = settings; }

  async preview(): Promise<MigrationPreview> {
    const quotes = await this.repository.getQuotes(); const unreadable = this.repository.getUnreadablePaths(); const duplicates = this.repository.duplicateGroups(quotes); const items: MigrationIssue[] = [];
    const reserved = new Set(quotes.map(quote => quote.id).filter(id => isShortRecordId(id))); const assigned = new Set<string>();
    for (const quote of quotes) {
      const file = this.file(quote.path); if (!file) continue; const parsed = parseNote(await this.app.vault.cachedRead(file)); const fm = parsed.frontmatter; const issues: string[] = [];
      if (!scalar(fm.quote_source)) issues.push("missing-source"); if (!scalar(fm.created) || !(scalar(fm.updated) || scalar(fm.last_updated))) issues.push("missing-timestamp");
      if (!scalar(fm.id)) issues.push("missing-id"); else if (!isShortRecordId(scalar(fm.id))) issues.push("long-id"); if (scalar(fm.type) !== "quote-library-quote") issues.push("missing-type");
      const tags = [...strings(fm.tags), ...strings(fm.Tags)]; if (!tags.some(tag => tag.toLocaleLowerCase() === "quote")) issues.push("missing-tag");
      if (quote.pinned && quote.archived) issues.push("pinned-and-archived"); if (!quote.topics.length) issues.push("unassigned-topic");
      let proposedId = quote.id; if (!isShortRecordId(proposedId) || assigned.has(proposedId)) { if (assigned.has(proposedId)) issues.push("duplicate-id"); proposedId = migrationId(quote, new Set([...reserved, ...assigned])); } assigned.add(proposedId);
      items.push({ path: quote.path, issues, proposedId, bodyConvertible: knownLegacyBody(parsed.body) });
    }
    for (const path of unreadable) items.push({ path, issues: ["unreadable"], proposedId: "", bodyConvertible: false });
    const signature = contentHash(items.map(item => `${item.path}:${this.file(item.path)?.stat.mtime ?? 0}:${item.proposedId}`).join("|"));
    return {
      generated: isoMinute(), signature, total: quotes.length + unreadable.length, missingSource: items.filter(i => i.issues.includes("missing-source")).length,
      missingTimestamp: items.filter(i => i.issues.includes("missing-timestamp")).length, missingId: items.filter(i => i.issues.includes("missing-id")).length,
      missingType: items.filter(i => i.issues.includes("missing-type")).length, pinnedArchived: items.filter(i => i.issues.includes("pinned-and-archived")).length,
      duplicateGroups: duplicates.length, convertibleBodies: items.filter(i => i.bodyConvertible).length,
      manualReview: items.filter(i => !i.bodyConvertible || i.issues.includes("missing-source")).length, unreadable: unreadable.length, items
    };
  }

  async recordPreview(): Promise<MigrationPreview> { const preview = await this.preview(); this.settings.previewSignature = preview.signature; this.settings.migrationPhase = "previewed"; await this.saveSettings(); return preview; }

  async migrateSchema(): Promise<MigrationJournal> {
    const preview = await this.preview(); if (!this.settings.previewSignature || preview.signature !== this.settings.previewSignature) throw new Error("The library changed after preview. Run Preview migration again.");
    if (preview.unreadable) throw new Error(`${preview.unreadable} quote note${preview.unreadable === 1 ? " is" : "s are"} unreadable. Make the files available offline before migration.`);
    const quotes = await this.repository.getQuotes(); const canonicalAuthors = mostCommon(quotes.map(q => q.author)); const canonicalSources = mostCommon(quotes.map(q => q.source));
    const journal = await this.backup(quotes, "schema", preview); const proposed = new Map(preview.items.map(item => [item.path, item.proposedId]));
    for (const entry of journal.entries) {
      try {
        const quote = quotes.find(item => item.path === entry.sourcePath); if (!quote) throw new Error("The source quote disappeared after backup.");
        const file = this.file(quote.path); if (!file) throw new Error("The source note could not be found.");
        const parsed = parseNote(await this.app.vault.cachedRead(file));
        if (knownLegacyBody(parsed.body)) await this.app.vault.process(file, content => { const note = parseNote(content); return `${content.slice(0, content.length - note.body.length)}${removeKnownLegacyBody(note.body)}\n`; });
        quote.id = proposed.get(quote.path) || quote.id; quote.author = canonicalAuthors.get(normalKey(quote.author)) || normalizeName(quote.author);
        quote.source = canonicalSources.get(normalKey(quote.source)) || normalizeName(quote.source); quote.topics = stableNames(quote.topics); quote.aliases = [`${shortExcerpt(quote.text, 56)} — ${quote.author}`]; quote.legacy = false;
        await this.repository.writeQuote(quote); entry.status = "migrated";
      } catch (error) { entry.status = "failed"; entry.error = message(error); }
      await this.writeJournal(journal);
    }
    this.settings.latestJournalPath = journalPath(journal); this.settings.migrationPhase = "schema-migrated"; await this.saveSettings(); await this.repository.rebuildSummaries(); return journal;
  }

  async verify(): Promise<VerificationResult> {
    const failures: string[] = []; const checks: string[] = []; const journal = await this.readLatestJournal(); if (!journal) return { valid: false, checks, failures: ["No migration journal is available."] };
    const quotes = await this.repository.getQuotes(); const byPath = new Map(quotes.map(q => [q.path, q]));
    checks.push(`Journal entries: ${journal.entries.length}`, `Dashboard records: ${quotes.length}`);
    if (quotes.length < journal.entries.length) failures.push("Fewer quote records exist than were backed up.");
    const ids = quotes.map(q => q.id).filter(Boolean); if (ids.length !== new Set(ids).size) failures.push("Stable quote IDs are not unique."); if (ids.some(id => !isShortRecordId(id))) failures.push("One or more quote IDs do not use the QTE-XXXX format.");
    for (const entry of journal.entries) {
      const backup = this.file(entry.backupPath); if (!backup) { failures.push(`Missing backup: ${entry.backupPath}`); continue; }
      if (await sha256(await this.app.vault.cachedRead(backup)) !== entry.backupHash) failures.push(`Backup hash mismatch: ${entry.backupPath}`);
      const quote = byPath.get(entry.destinationPath || entry.sourcePath); if (!quote) { failures.push(`Missing migrated quote: ${entry.sourcePath}`); continue; }
      if (!quote.id) failures.push(`Missing ID: ${quote.path}`); if (quote.text !== entry.originalText || normalKey(quote.author) !== normalKey(entry.originalAuthor)) failures.push(`Text or author changed: ${quote.path}`);
    }
    const valid = failures.length === 0; if (valid) { this.settings.migrationPhase = "verified"; await this.saveSettings(); checks.push("Schema migration verified and filename modernization unlocked."); }
    return { valid, checks, failures };
  }

  async modernizeFilenames(): Promise<MigrationJournal> {
    if (this.settings.migrationPhase !== "verified" && this.settings.migrationPhase !== "filenames-modernized") throw new Error("Verify the schema migration before modernizing filenames.");
    const quotes = await this.repository.getQuotes(); const preview = await this.preview(); const journal = await this.backup(quotes, "filenames", preview);
    for (const entry of journal.entries) {
      try {
        const quote = quotes.find(item => item.path === entry.sourcePath); if (!quote?.id) throw new Error("The quote is missing its stable ID.");
        const file = this.file(quote.path); if (!file) throw new Error("The quote note could not be found.");
        const destination = await this.availableDestination(`${quote.id} - ${shortExcerpt(quote.text)}`, file.path); if (destination !== file.path) await this.app.fileManager.renameFile(file, destination);
        entry.destinationPath = destination; entry.status = "renamed";
      } catch (error) { entry.status = "failed"; entry.error = message(error); }
      await this.writeJournal(journal);
    }
    this.settings.latestJournalPath = journalPath(journal); this.settings.migrationPhase = "filenames-modernized"; await this.saveSettings(); await this.repository.rebuildSummaries(); return journal;
  }

  async backupForMerge(quotes: QuoteRecord[]): Promise<void> { await this.backup(quotes, "duplicate-merge", await this.preview()); }

  async restoreLatest(): Promise<number> {
    const journal = await this.readLatestJournal(); if (!journal) throw new Error("No migration journal is available."); let restored = 0;
    for (const entry of journal.entries) {
      const backup = this.file(entry.backupPath); if (!backup) continue; const content = await this.app.vault.cachedRead(backup); if (await sha256(content) !== entry.backupHash) throw new Error(`Backup verification failed for ${entry.backupPath}.`);
      const currentPath = entry.destinationPath || entry.sourcePath; let current = this.file(currentPath);
      if (current && current.path !== entry.sourcePath && !this.app.vault.getAbstractFileByPath(entry.sourcePath)) { await this.app.fileManager.renameFile(current, entry.sourcePath); current = this.file(entry.sourcePath); }
      if (current) await this.app.vault.process(current, () => content); else { await this.ensureParent(entry.sourcePath); await this.app.vault.create(entry.sourcePath, content); }
      entry.status = "restored"; restored++;
    }
    await this.writeJournal(journal); this.settings.migrationPhase = "previewed"; await this.saveSettings(); await this.repository.rebuildSummaries(); return restored;
  }

  private async backup(quotes: QuoteRecord[], phase: MigrationJournal["phase"], preview: MigrationPreview): Promise<MigrationJournal> {
    const stamp = isoMinute().replace(/[:T]/g, "-"); const backupRoot = normalizePath(`${this.settings.backupFolder}/${stamp}-${phase}`); await this.ensureFolder(backupRoot);
    const journal: MigrationJournal = { version: 1, phase, created: isoMinute(), rootFolder: this.repository.root, backupRoot, entries: [] };
    const proposed = new Map(preview.items.map(item => [item.path, item.proposedId]));
    for (const quote of quotes) {
      const file = this.file(quote.path); if (!file) throw new Error(`Cannot back up missing file: ${quote.path}`); const content = await this.app.vault.cachedRead(file);
      const relative = quote.path.startsWith(`${this.repository.root}/`) ? quote.path.slice(this.repository.root.length + 1) : safeFilename(quote.path); const backupPath = normalizePath(`${backupRoot}/${relative}`); await this.ensureParent(backupPath);
      if (!this.app.vault.getAbstractFileByPath(backupPath)) await this.app.vault.create(backupPath, content); const backup = this.file(backupPath); if (!backup) throw new Error(`Backup could not be created: ${backupPath}`);
      const originalHash = await sha256(content); const backupHash = await sha256(await this.app.vault.cachedRead(backup)); if (originalHash !== backupHash) throw new Error(`Backup verification failed: ${quote.path}`);
      journal.entries.push({ sourcePath: quote.path, backupPath, originalHash, backupHash, proposedId: proposed.get(quote.path) || quote.id, originalText: quote.text, originalAuthor: quote.author, status: "backed-up" });
    }
    await this.writeJournal(journal); this.settings.latestJournalPath = journalPath(journal); await this.saveSettings(); return journal;
  }
  private async writeJournal(journal: MigrationJournal): Promise<void> { const path = journalPath(journal); const content = JSON.stringify(journal, null, 2); const file = this.file(path); if (file) await this.app.vault.process(file, () => content); else await this.app.vault.create(path, content); }
  private async readLatestJournal(): Promise<MigrationJournal | null> { const file = this.file(this.settings.latestJournalPath); if (!file) return null; try { return JSON.parse(await this.app.vault.cachedRead(file)) as MigrationJournal; } catch { throw new Error("The latest migration journal is malformed."); } }
  private file(path: string): TFile | null { const item = this.app.vault.getAbstractFileByPath(normalizePath(path)); return item instanceof TFile ? item : null; }
  private async ensureFolder(path: string): Promise<void> { let current = ""; for (const part of normalizePath(path).split("/")) { current = normalizePath(current ? `${current}/${part}` : part); if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current); } }
  private async ensureParent(path: string): Promise<void> { await this.ensureFolder(path.split("/").slice(0, -1).join("/")); }
  private async availableDestination(base: string, current: string): Promise<string> { let path = normalizePath(`${this.repository.root}/${safeFilename(base)}.md`); let i = 2; while (path !== current && this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.repository.root}/${safeFilename(base)}-${i++}.md`); return path; }
}

function journalPath(journal: MigrationJournal): string { return normalizePath(`${journal.backupRoot}/Migration Journal.json`); }
function migrationId(quote: QuoteRecord, used: ReadonlySet<string>): string { return availableRecordId("QTE", `${quote.created}:${quote.path}:${quote.text}`, used); }
function normalKey(value: string): string { return normalizeName(value).toLocaleLowerCase(); }
function mostCommon(values: string[]): Map<string, string> { const groups = new Map<string, Map<string, number>>(); for (const value of values.map(normalizeName).filter(Boolean)) { const key = normalKey(value); const variants = groups.get(key) ?? new Map<string, number>(); variants.set(value, (variants.get(value) ?? 0) + 1); groups.set(key, variants); } const result = new Map<string, string>(); for (const [key, variants] of groups) result.set(key, [...variants].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]); return result; }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown migration error"; }
