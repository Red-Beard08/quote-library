/* Runs repeatable mapped imports with previews, verified backups, journals, verification, and rollback. */

import { App, normalizePath, TFile } from "obsidian";
import { cleanFolder, sameOrInside, validateMigration } from "./config";
import { QuoteRepository } from "./repository";
import { extractCandidate, LEGACY_PROFILE, profileById } from "./profiles";
import type { MigrationIssue, MigrationJournal, MigrationJournalV2, MigrationPreview, MigrationProfile, MigrationRunSummary, QuoteLibrarySettings, QuoteRecord, VerificationResult } from "./types";
import { availableRecordId, bodySection, contentHash, duplicateKey, isShortRecordId, isoMinute, normalizeName, safeFilename, sha256, shortExcerpt, textDuplicateKey } from "./utils";

interface Candidate { file: TFile; record: QuoteRecord; issues: string[]; confidence: "high" | "manual"; bodyConvertible: boolean; proposedId: string; destinationPath: string; exactDuplicatePath: string; }
interface Analysis { preview: MigrationPreview; candidates: Candidate[]; profile: MigrationProfile; source: string; }

export class QuoteMigration {
  constructor(private app: App, private repository: QuoteRepository, private settings: QuoteLibrarySettings, private saveSettings: () => Promise<void>) {}
  updateSettings(settings: QuoteLibrarySettings): void { this.settings = settings; }

  async preview(runId = this.activeRun()?.id || this.newRunId()): Promise<MigrationPreview> { return (await this.analyze(runId)).preview; }

  async recordPreview(): Promise<MigrationPreview> {
    const runId = this.newRunId(); const analysis = await this.analyze(runId); const defaults = this.settings.migrationDefaults;
    const run: MigrationRunSummary = { id: runId, created: analysis.preview.generated, status: "previewed", mode: defaults.mode, sourceFolder: analysis.source, targetFolder: this.repository.quotesFolder, profileName: analysis.profile.name, previewSignature: analysis.preview.signature, journalPath: "", total: analysis.preview.candidates, failures: analysis.preview.manualReview + analysis.preview.unreadable };
    this.upsertRun(run); this.settings.activeMigrationRunId = runId; await this.saveSettings(); return analysis.preview;
  }

  async migrateSchema(): Promise<MigrationJournalV2> {
    const run = this.requireRun("previewed"); const analysis = await this.analyze(run.id);
    if (analysis.preview.signature !== run.previewSignature) throw new Error("The source, settings, or library changed after preview. Run Preview migration again.");
    if (analysis.preview.unreadable) throw new Error(`${analysis.preview.unreadable} source note${analysis.preview.unreadable === 1 ? " is" : "s are"} unreadable.`);
    if (analysis.preview.manualReview) throw new Error(`${analysis.preview.manualReview} candidate${analysis.preview.manualReview === 1 ? " requires" : "s require"} correction or exclusion before migration.`);
    const journal = await this.backupCandidates(run, analysis, "schema");
    for (let index = 0; index < journal.entries.length; index++) {
      const entry = journal.entries[index]; const candidate = analysis.candidates.find(item => item.file.path === entry.sourcePath);
      try {
        if (!candidate) throw new Error("The source candidate disappeared after backup.");
        if (candidate.exactDuplicatePath && run.mode === "copy") { entry.status = "skipped"; entry.destinationPath = candidate.exactDuplicatePath; }
        else if (run.mode === "copy") { const imported = await this.repository.createImportedQuote(candidate.record, candidate.proposedId); entry.status = "copied"; entry.destinationPath = imported.path; entry.destinationHash = await this.hashFile(imported.path); }
        else { const content = await this.app.vault.cachedRead(candidate.file); candidate.record.id = candidate.proposedId; candidate.record.notes = bodySection(content, "Personal notes"); await this.repository.writeQuote(candidate.record, analysis.profile.body.cleanupKnownLegacyBody); entry.status = "migrated"; entry.destinationPath = candidate.file.path; entry.destinationHash = await this.hashFile(candidate.file.path); }
      } catch (error) { entry.status = "failed"; entry.error = message(error); }
      await this.writeJournal(journal);
    }
    if (run.mode === "in-place") { this.settings.layout.rootFolder = analysis.source; this.settings.layout.quotesFolder = ""; this.repository.updateSettings(this.settings); }
    run.journalPath = journalPath(journal); run.failures = journal.entries.filter(entry => entry.status === "failed").length; run.status = run.failures ? "failed" : "migrated"; this.upsertRun(run); await this.saveSettings(); await this.repository.rebuildSummaries(); return journal;
  }

  async verify(runId = this.settings.activeMigrationRunId): Promise<VerificationResult> {
    const run = this.runById(runId); if (!run?.journalPath) return { valid: false, checks: [], failures: ["Choose a migration run with a journal."] };
    const journal = await this.readJournal(run.journalPath); const failures: string[] = []; const checks = [`Journal entries: ${journal.entries.length}`];
    for (const entry of journal.entries) {
      const backup = this.file(entry.backupPath); if (!backup) { failures.push(`Missing backup: ${entry.backupPath}`); continue; }
      if (await sha256(await this.app.vault.cachedRead(backup)) !== entry.backupHash) failures.push(`Backup hash mismatch: ${entry.backupPath}`);
      if (entry.status === "skipped") continue; const destination = this.file(entry.destinationPath || entry.sourcePath); if (!destination) { failures.push(`Missing destination: ${entry.destinationPath || entry.sourcePath}`); continue; }
      const quote = await this.repository.readQuote(destination); if (!quote) { failures.push(`Destination is not a canonical quote: ${destination.path}`); continue; }
      if (quote.id !== entry.proposedId || !isShortRecordId(quote.id)) failures.push(`Invalid ID: ${destination.path}`);
      if (quote.text !== entry.originalText || normalizeName(quote.author) !== normalizeName(entry.originalAuthor)) failures.push(`Text or author changed: ${destination.path}`);
    }
    const valid = failures.length === 0; if (valid) { run.status = "verified"; run.failures = 0; this.upsertRun(run); await this.saveSettings(); checks.push("Migration verified and filename modernization unlocked."); } return { valid, checks, failures };
  }

  async modernizeFilenames(): Promise<MigrationJournalV2> {
    const parent = this.requireRun("verified", "filenames-modernized"); const quotes = await this.repository.getQuotes(); const profile = profileById(this.settings.customProfiles, this.settings.migrationDefaults.profileId); const run = this.newSummary("filenames", parent.mode, this.repository.quotesFolder, this.repository.quotesFolder, profile.name, quotes.length); const analysis = this.recordsAnalysis(run.id, quotes, profile); const journal = await this.backupCandidates(run, analysis, "filenames");
    for (let index = 0; index < journal.entries.length; index++) { const entry = journal.entries[index]; try { const quote = quotes.find(item => item.path === entry.sourcePath); if (!quote?.id) throw new Error("The quote is missing its stable ID."); const file = this.file(quote.path); if (!file) throw new Error("The quote note could not be found."); const destination = await this.availableDestination(`${quote.id} - ${shortExcerpt(quote.text)}`, file.path); if (destination !== file.path) await this.app.fileManager.renameFile(file, destination); entry.destinationPath = destination; entry.destinationHash = await this.hashFile(destination); entry.status = "renamed"; } catch (error) { entry.status = "failed"; entry.error = message(error); } await this.writeJournal(journal); }
    run.status = "filenames-modernized"; run.journalPath = journalPath(journal); run.failures = journal.entries.filter(entry => entry.status === "failed").length; this.upsertRun(run); this.settings.activeMigrationRunId = run.id; await this.saveSettings(); await this.repository.rebuildSummaries(); return journal;
  }

  async backupForMerge(quotes: QuoteRecord[]): Promise<void> {
    const profile = LEGACY_PROFILE; const active = this.settings.activeMigrationRunId; const run = this.newSummary("merge", "in-place", this.repository.quotesFolder, this.repository.quotesFolder, profile.name, quotes.length); const analysis = this.recordsAnalysis(run.id, quotes, profile); const journal = await this.backupCandidates(run, analysis, "duplicate-merge"); run.status = "verified"; run.journalPath = journalPath(journal); this.upsertRun(run); this.settings.activeMigrationRunId = active; await this.saveSettings();
  }

  async restoreRun(runId: string): Promise<number> {
    const run = this.runById(runId); if (!run?.journalPath) throw new Error("That migration run has no journal."); const journal = await this.readJournal(run.journalPath); let restored = 0;
    for (const entry of [...journal.entries].reverse()) {
      const backup = this.file(entry.backupPath); if (!backup) throw new Error(`Missing backup: ${entry.backupPath}`); const content = await this.app.vault.cachedRead(backup); if (await sha256(content) !== entry.backupHash) throw new Error(`Backup verification failed: ${entry.backupPath}`);
      if (journal.version === 2 && journal.mode === "copy" && entry.status === "copied") { const generated = this.file(entry.destinationPath || ""); if (!generated) continue; if (entry.destinationHash && await sha256(await this.app.vault.cachedRead(generated)) !== entry.destinationHash) throw new Error(`Generated copy was edited and needs manual review: ${generated.path}`); await this.app.fileManager.trashFile(generated); restored++; continue; }
      if (entry.status === "skipped") continue; const currentPath = entry.destinationPath || entry.sourcePath; let current = this.file(currentPath); if (current && current.path !== entry.sourcePath && !this.app.vault.getAbstractFileByPath(entry.sourcePath)) { await this.ensureParent(entry.sourcePath); await this.app.fileManager.renameFile(current, entry.sourcePath); current = this.file(entry.sourcePath); }
      if (current) await this.app.vault.process(current, () => content); else { await this.ensureParent(entry.sourcePath); await this.app.vault.create(entry.sourcePath, content); } restored++;
    }
    run.status = "restored"; this.upsertRun(run); await this.saveSettings(); await this.repository.rebuildSummaries(); return restored;
  }

  private async analyze(runId: string): Promise<Analysis> {
    const failures = validateMigration(this.settings.layout, this.settings.migrationDefaults); if (failures.length) throw new Error(failures.join(" "));
    const defaults = this.settings.migrationDefaults; const source = cleanFolder(defaults.sourceFolder || this.repository.quotesFolder); const profile = profileById(this.settings.customProfiles, defaults.profileId); const files = this.sourceFiles(source, defaults.recursive); const existing = await this.repository.getQuotes(); const reserved = new Set(existing.map(quote => quote.id).filter(id => isShortRecordId(id))); const assigned = new Set<string>(); const plannedPaths = new Set<string>(); const candidates: Candidate[] = []; const items: MigrationIssue[] = []; let unreadable = 0; let excluded = 0;
    for (const file of files) {
      if (defaults.excludedPaths.includes(file.path)) { excluded++; continue; } let content = ""; try { content = await this.app.vault.cachedRead(file); } catch { unreadable++; items.push({ path: file.path, issues: ["unreadable"], proposedId: "", destinationPath: "", bodyConvertible: false, confidence: "manual" }); continue; }
      const extracted = extractCandidate(content, profile, file.path, file.stat.ctime, file.stat.mtime); if (!extracted) { excluded++; continue; } const record = extracted.record; const issues = [...extracted.issues]; if (!record.id) issues.push("missing-id"); else if (!isShortRecordId(record.id)) issues.push("long-id"); if (record.legacy) issues.push("missing-type"); if (record.pinned && record.archived) issues.push("pinned-and-archived"); if (!record.topics.length) issues.push("unassigned-topic");
      const sameRecord = existing.find(quote => quote.path === record.path); const canKeepId = isShortRecordId(record.id) && !assigned.has(record.id) && (!reserved.has(record.id) || sameRecord?.id === record.id); const proposedId = canKeepId ? record.id : availableRecordId("QTE", `${record.created}:${record.path}:${record.text}`, new Set([...reserved, ...assigned])); assigned.add(proposedId);
      const exact = existing.find(quote => duplicateKey(quote.text, quote.author) === duplicateKey(record.text, record.author)); if (exact && defaults.mode === "copy") issues.push("exact-duplicate");
      const destinationPath = defaults.mode === "copy" ? this.plannedDestination(proposedId, record.text, plannedPaths) : file.path; const confidence = extracted.confidence; candidates.push({ file, record, issues, confidence, bodyConvertible: extracted.bodyConvertible, proposedId, destinationPath, exactDuplicatePath: exact?.path || "" }); items.push({ path: file.path, issues, proposedId, destinationPath, bodyConvertible: extracted.bodyConvertible, confidence });
    }
    const duplicateGroups = duplicateTextGroups([...existing, ...candidates.map(item => item.record)]); const signature = contentHash(`${JSON.stringify({ defaults, layout: this.settings.layout, profile })}|${items.map(item => `${item.path}:${this.file(item.path)?.stat.mtime ?? 0}:${item.proposedId}:${item.destinationPath}:${item.issues.join(",")}`).join("|")}`);
    const preview: MigrationPreview = { runId, generated: isoMinute(), signature, total: files.length, candidates: candidates.length, excluded, missingSource: items.filter(item => item.issues.includes("missing-source")).length, missingTimestamp: items.filter(item => item.issues.includes("missing-timestamp")).length, missingId: items.filter(item => item.issues.includes("missing-id")).length, missingType: items.filter(item => item.issues.includes("missing-type")).length, pinnedArchived: items.filter(item => item.issues.includes("pinned-and-archived")).length, duplicateGroups, convertibleBodies: items.filter(item => item.bodyConvertible).length, manualReview: candidates.filter(item => item.confidence === "manual").length, unreadable, items };
    return { preview, candidates, profile, source };
  }

  private recordsAnalysis(runId: string, records: QuoteRecord[], profile: MigrationProfile): Analysis {
    const candidates = records.map(record => ({ file: this.file(record.path)!, record, issues: [], confidence: "high" as const, bodyConvertible: false, proposedId: record.id, destinationPath: record.path, exactDuplicatePath: "" })); const items = candidates.map(item => ({ path: item.record.path, issues: [], proposedId: item.proposedId, destinationPath: item.destinationPath, bodyConvertible: false, confidence: "high" as const }));
    return { profile, source: this.repository.quotesFolder, candidates, preview: { runId, generated: isoMinute(), signature: contentHash(items.map(item => item.path).join("|")), total: records.length, candidates: records.length, excluded: 0, missingSource: 0, missingTimestamp: 0, missingId: 0, missingType: 0, pinnedArchived: 0, duplicateGroups: 0, convertibleBodies: 0, manualReview: 0, unreadable: 0, items } };
  }

  private async backupCandidates(run: MigrationRunSummary, analysis: Analysis, phase: MigrationJournalV2["phase"]): Promise<MigrationJournalV2> {
    const backupRoot = await this.availableBackupRoot(`${isoMinute().replace(/[:T]/g, "-")}-${run.id}-${phase}`); const journal: MigrationJournalV2 = { version: 2, runId: run.id, phase, mode: run.mode, created: isoMinute(), sourceFolder: run.sourceFolder, targetFolder: run.targetFolder, backupRoot, profile: analysis.profile, entries: [] };
    for (const candidate of analysis.candidates) { const content = await this.app.vault.cachedRead(candidate.file); const relative = candidate.file.path.startsWith(`${analysis.source}/`) ? candidate.file.path.slice(analysis.source.length + 1) : safeFilename(candidate.file.path); const backupPath = normalizePath(`${backupRoot}/${relative}`); await this.ensureParent(backupPath); if (this.app.vault.getAbstractFileByPath(backupPath)) throw new Error(`Backup path already exists: ${backupPath}`); await this.app.vault.create(backupPath, content); const backup = this.file(backupPath); if (!backup) throw new Error(`Backup could not be created: ${backupPath}`); const originalHash = await sha256(content); const backupHash = await sha256(await this.app.vault.cachedRead(backup)); if (originalHash !== backupHash) throw new Error(`Backup verification failed: ${candidate.file.path}`); journal.entries.push({ sourcePath: candidate.file.path, backupPath, originalHash, backupHash, proposedId: candidate.proposedId, originalText: candidate.record.text, originalAuthor: candidate.record.author, status: "backed-up", destinationPath: candidate.destinationPath }); }
    await this.writeJournal(journal); run.journalPath = journalPath(journal); this.upsertRun(run); await this.saveSettings(); return journal;
  }

  private sourceFiles(source: string, recursive: boolean): TFile[] { return this.app.vault.getMarkdownFiles().filter(file => { if (!sameOrInside(file.path, source) || sameOrInside(file.path, this.repository.paths.backup) || sameOrInside(file.path, this.repository.topicsFolder) || file.path === this.repository.indexPath) return false; const relative = file.path.slice(source.length).replace(/^\//, ""); return recursive || !relative.includes("/"); }).sort((a, b) => a.path.localeCompare(b.path)); }
  private plannedDestination(id: string, text: string, planned: Set<string>): string { const base = `${this.repository.quotesFolder}/${safeFilename(`${id} - ${shortExcerpt(text)}`)}`; let path = normalizePath(`${base}.md`); let index = 2; while (planned.has(path) || this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${base}-${index++}.md`); planned.add(path); return path; }
  private newRunId(): string { return availableRecordId("MIG", `${Date.now()}:${this.settings.migrationHistory.length}`, new Set(this.settings.migrationHistory.map(run => run.id))); }
  private newSummary(seed: string, mode: "copy" | "in-place", source: string, target: string, profileName: string, total: number): MigrationRunSummary { return { id: availableRecordId("MIG", `${seed}:${Date.now()}`, new Set(this.settings.migrationHistory.map(run => run.id))), created: isoMinute(), status: "previewed", mode, sourceFolder: source, targetFolder: target, profileName, previewSignature: "", journalPath: "", total, failures: 0 }; }
  private activeRun(): MigrationRunSummary | undefined { return this.runById(this.settings.activeMigrationRunId); }
  private runById(id: string): MigrationRunSummary | undefined { return this.settings.migrationHistory.find(run => run.id === id); }
  private requireRun(...statuses: MigrationRunSummary["status"][]): MigrationRunSummary { const run = this.activeRun(); if (!run || !statuses.includes(run.status)) throw new Error(`The active migration must be ${statuses.join(" or ")}.`); return run; }
  private upsertRun(run: MigrationRunSummary): void { const index = this.settings.migrationHistory.findIndex(item => item.id === run.id); if (index >= 0) this.settings.migrationHistory[index] = run; else this.settings.migrationHistory.unshift(run); }
  private async availableBackupRoot(base: string): Promise<string> { let path = normalizePath(`${this.repository.paths.backup}/${safeFilename(base)}`); let index = 2; while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.repository.paths.backup}/${safeFilename(base)}-${index++}`); await this.ensureFolder(path); return path; }
  private async availableDestination(base: string, current: string): Promise<string> { let path = normalizePath(`${this.repository.quotesFolder}/${safeFilename(base)}.md`); let index = 2; while (path !== current && this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.repository.quotesFolder}/${safeFilename(base)}-${index++}.md`); return path; }
  private async writeJournal(journal: MigrationJournalV2): Promise<void> { const path = journalPath(journal); const content = JSON.stringify(journal, null, 2); const file = this.file(path); if (file) await this.app.vault.process(file, () => content); else await this.app.vault.create(path, content); }
  private async readJournal(path: string): Promise<MigrationJournal> { const file = this.file(path); if (!file) throw new Error("The migration journal could not be found."); try { const value = JSON.parse(await this.app.vault.cachedRead(file)) as MigrationJournal; if (value.version !== 1 && value.version !== 2) throw new Error(); return value; } catch { throw new Error("The migration journal is malformed or unsupported."); } }
  private async hashFile(path: string): Promise<string> { const file = this.file(path); if (!file) throw new Error(`Cannot hash missing file: ${path}`); return sha256(await this.app.vault.cachedRead(file)); }
  private file(path: string): TFile | null { const item = this.app.vault.getAbstractFileByPath(normalizePath(path)); return item instanceof TFile ? item : null; }
  private async ensureFolder(path: string): Promise<void> { let current = ""; for (const part of normalizePath(path).split("/")) { current = normalizePath(current ? `${current}/${part}` : part); if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current); } }
  private async ensureParent(path: string): Promise<void> { await this.ensureFolder(path.split("/").slice(0, -1).join("/")); }
}

function journalPath(journal: MigrationJournal): string { return normalizePath(`${journal.backupRoot}/Migration Journal.json`); }
function duplicateTextGroups(quotes: QuoteRecord[]): number { const groups = new Map<string, number>(); for (const quote of quotes) groups.set(textDuplicateKey(quote.text), (groups.get(textDuplicateKey(quote.text)) ?? 0) + 1); return [...groups.values()].filter(count => count > 1).length; }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown migration error"; }
