/* Registers Quote Library views, commands, repository actions, migrations, and settings. */

import { Notice, Plugin, TFile } from "obsidian";
import { DASHBOARD_VIEW, QuoteLibraryDashboard } from "./dashboard";
import { DuplicateReviewModal, MigrationModal, QuoteModal, TopicManagerModal } from "./modals";
import { QuoteMigration } from "./migration";
import { QuoteRepository } from "./repository";
import { QuoteLibrarySettingTab } from "./settings";
import type { DashboardData, QuoteInput, QuoteLibrarySettings, QuoteRecord, TopicRecord, TopicStatus } from "./types";
import { DEFAULT_SETTINGS } from "./types";

export default class QuoteLibraryPlugin extends Plugin {
  settings: QuoteLibrarySettings = DEFAULT_SETTINGS; repository!: QuoteRepository; migration!: QuoteMigration;
  cachedTopics: TopicRecord[] = []; cachedAuthors: string[] = []; cachedSources: string[] = [];
  private bulkOperation = false;

  async onload(): Promise<void> {
    await this.loadSettings(); this.repository = new QuoteRepository(this.app, this.settings); this.migration = new QuoteMigration(this.app, this.repository, this.settings, () => this.saveSettings());
    this.registerView(DASHBOARD_VIEW, leaf => new QuoteLibraryDashboard(leaf, this)); this.addRibbonIcon("quote", "Open Quote Library", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "add-quote", name: "Add quote", callback: () => this.openQuoteModal() });
    this.addCommand({ id: "manage-topics", name: "Manage topics", callback: () => this.openTopicManager() });
    this.addCommand({ id: "review-incomplete", name: "Review incomplete quotes", callback: () => void this.openDashboard() });
    this.addCommand({ id: "review-duplicates", name: "Review duplicates", callback: () => void this.openDuplicateReview() });
    this.addCommand({ id: "preview-migration", name: "Preview migration", callback: () => void this.previewMigration() });
    this.addCommand({ id: "run-schema-migration", name: "Run schema migration", callback: () => this.openMigrationTools() });
    this.addCommand({ id: "verify-migration", name: "Verify migration", callback: () => void this.verifyMigration() });
    this.addCommand({ id: "modernize-filenames", name: "Modernize filenames", callback: () => this.openMigrationTools() });
    this.addCommand({ id: "rebuild-summaries", name: "Rebuild managed summaries", callback: () => void this.rebuildSummaries() });
    this.addCommand({ id: "restore-migration-backup", name: "Restore latest migration backup", callback: () => this.openMigrationTools() });
    this.addSettingTab(new QuoteLibrarySettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("modify", file => this.handleVaultEvent(file.path)));
    this.registerEvent(this.app.vault.on("rename", file => this.handleVaultEvent(file.path)));
    this.registerEvent(this.app.vault.on("delete", file => this.handleVaultEvent(file.path)));
    try { await this.repository.initialize(); await this.refreshDashboard(); } catch (error) { console.error("Quote Library initialization failed.", error); new Notice("Quote Library could not initialize its configured folders."); }
  }
  onunload(): void { this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW); }
  async loadSettings(): Promise<void> { const stored = await this.loadData() as Partial<QuoteLibrarySettings> | null; this.settings = { ...DEFAULT_SETTINGS, ...stored, rootFolder: stored?.rootFolder?.trim() || DEFAULT_SETTINGS.rootFolder, backupFolder: stored?.backupFolder?.trim() || DEFAULT_SETTINGS.backupFolder }; await this.saveData(this.settings); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.repository?.updateSettings(this.settings); this.migration?.updateSettings(this.settings); }
  async openDashboard(): Promise<void> { let leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: DASHBOARD_VIEW, active: true }); } this.app.workspace.revealLeaf(leaf); await this.refreshDashboard(); }
  async openFile(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) { new Notice("That Quote Library note could not be found."); return; } await this.app.workspace.getLeaf("tab").openFile(file); }
  openQuoteModal(): void { new QuoteModal(this.app, this, async input => this.saveQuote(input)).open(); }
  openQuoteEditor(quote: QuoteRecord): void { new QuoteModal(this.app, this, async input => { await this.repository.editQuote(quote.path, input); await this.afterMutation("Quote updated."); }, quote).open(); }
  openTopicManager(): void { new TopicManagerModal(this.app, this).open(); }
  openMigrationTools(): void { new MigrationModal(this.app, this).open(); }
  async openDuplicateReview(): Promise<void> { const groups = this.repository.duplicateGroups(await this.repository.getQuotes()); new DuplicateReviewModal(this.app, this, groups).open(); }
  updateCaches(data: DashboardData): void { this.cachedTopics = data.topics; this.cachedAuthors = unique(data.quotes.map(q => q.author).filter(Boolean)); this.cachedSources = unique(data.quotes.map(q => q.source).filter(Boolean)); }
  async saveQuote(input: QuoteInput): Promise<void> { const result = await this.repository.saveQuote(input); await this.afterMutation(result.created ? "Quote added." : "That quote already exists."); await this.openFile(result.quote.path); }
  async setPinned(quote: QuoteRecord, pinned: boolean): Promise<void> { await this.repository.setPinned(quote, pinned); await this.afterMutation(pinned ? "Quote pinned." : "Quote unpinned."); }
  async setArchived(quote: QuoteRecord, archived: boolean): Promise<void> { await this.repository.setArchived(quote, archived); await this.afterMutation(archived ? "Quote archived." : "Quote restored."); }
  async createTopic(name: string): Promise<void> { await this.repository.createTopic(name); await this.afterMutation("Topic created."); }
  async renameTopic(topic: TopicRecord, name: string): Promise<void> { await this.repository.renameTopic(topic, name); await this.afterMutation("Topic renamed across the library."); }
  async setTopicStatus(topic: TopicRecord, status: TopicStatus): Promise<void> { await this.repository.setTopicStatus(topic, status); await this.afterMutation(status === "archived" ? "Topic archived." : "Topic reactivated."); }
  async keepDuplicates(quotes: QuoteRecord[]): Promise<void> { await this.repository.keepDuplicates(quotes); await this.afterMutation("Both quotes retained."); }
  async mergeDuplicates(primary: QuoteRecord, secondary: QuoteRecord): Promise<void> { await this.migration.backupForMerge([primary, secondary]); await this.repository.mergeDuplicates(primary, secondary); await this.afterMutation("Duplicate merged without deleting either note."); }
  async previewMigration() { const preview = await this.migration.recordPreview(); new Notice(`Migration previewed: ${preview.total} quotes, ${preview.duplicateGroups} duplicate groups.`); return preview; }
  async runMigration() { return this.runBulk(async () => { const journal = await this.migration.migrateSchema(); const failed = journal.entries.filter(e => e.status === "failed").length; await this.afterMutation(`Schema migration finished with ${failed} failure${failed === 1 ? "" : "s"}.`); return journal; }); }
  async verifyMigration() { const result = await this.migration.verify(); new Notice(result.valid ? "Migration verification passed." : `Migration verification found ${result.failures.length} problem(s).`); return result; }
  async modernizeFilenames() { return this.runBulk(async () => { const journal = await this.migration.modernizeFilenames(); const failed = journal.entries.filter(e => e.status === "failed").length; await this.afterMutation(`Filename modernization finished with ${failed} failure${failed === 1 ? "" : "s"}.`); return journal; }); }
  async restoreLatest() { return this.runBulk(async () => { const count = await this.migration.restoreLatest(); await this.afterMutation(`${count} quote note${count === 1 ? "" : "s"} restored.`); return count; }); }
  async rebuildSummaries(): Promise<void> { try { await this.repository.rebuildSummaries(); await this.refreshDashboard(); } catch (error) { console.error("Quote Library rebuild failed.", error); new Notice("Quote Library summaries could not be rebuilt."); } }
  async refreshDashboard(): Promise<void> { const data = await this.repository.dashboard(); this.updateCaches(data); for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof QuoteLibraryDashboard) await leaf.view.render(); }
  private async afterMutation(notice: string): Promise<void> { await this.refreshDashboard(); new Notice(notice); }
  private handleVaultEvent(path: string): void { if (!this.bulkOperation && path.startsWith(`${this.repository.root}/`)) void this.refreshDashboard(); }
  private async runBulk<T>(action: () => Promise<T>): Promise<T> { this.bulkOperation = true; try { return await action(); } finally { this.bulkOperation = false; } }
}
function unique(values: string[]): string[] { return [...new Set(values)].sort((a, b) => a.localeCompare(b)); }
export { DASHBOARD_VIEW };
