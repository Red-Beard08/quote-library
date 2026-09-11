/* Registers portable Quote Library views, commands, profiles, migrations, settings, and refresh handling. */

import { Notice, Plugin, TFile } from "obsidian";
import { registerDashboardWidget } from "./widget-bridge";
import type { DashboardWidgetDefinition } from "./widget-bridge";
import { sameOrInside, upgradeSettings } from "./config";
import { DASHBOARD_VIEW, QuoteLibraryDashboard } from "./dashboard";
import { CanonicalUpgradeModal, DataQualityModal, DuplicateReviewModal, MigrationModal, ProfileManagerModal, QuoteModal, TopicManagerModal } from "./modals";
import { QuoteMigration } from "./migration";
import { validateProfile } from "./profiles";
import { QuoteRepository } from "./repository";
import { QuoteLibrarySettingTab } from "./settings";
import type { CanonicalUpgradeResult, DashboardData, MigrationProfile, QuoteInput, QuoteLibrarySettings, QuoteRecord, TopicRecord, TopicStatus } from "./types";
import { DEFAULT_SETTINGS } from "./types";
import { dailyIndex, dateKey } from "./utils";

export default class QuoteLibraryPlugin extends Plugin {
  settings: QuoteLibrarySettings = DEFAULT_SETTINGS; repository!: QuoteRepository; migration!: QuoteMigration;
  cachedTopics: TopicRecord[] = []; cachedAuthors: string[] = []; cachedSources: string[] = [];
  private bulkOperation = false; private refreshTimer = 0; private widgetDisposals: Array<() => void> = [];

  async onload(): Promise<void> {
    await this.loadSettings(); this.repository = new QuoteRepository(this.app, this.settings); this.migration = new QuoteMigration(this.app, this.repository, this.settings, () => this.saveSettings());
    this.registerView(DASHBOARD_VIEW, leaf => new QuoteLibraryDashboard(leaf, this)); this.addRibbonIcon("quote", "Open Quote Library", () => void this.openDashboard());
    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => void this.openDashboard() });
    this.addCommand({ id: "add-quote", name: "Add quote", callback: () => this.openQuoteModal() });
    this.addCommand({ id: "manage-topics", name: "Manage topics", callback: () => this.openTopicManager() });
    this.addCommand({ id: "manage-migration-profiles", name: "Manage migration profiles", callback: () => this.openProfileManager() });
    this.addCommand({ id: "review-incomplete", name: "Review incomplete quotes", callback: () => void this.openIssueList() });
    this.addCommand({ id: "review-duplicates", name: "Review duplicates", callback: () => void this.openDuplicateReview() });
    this.addCommand({ id: "organize-archived-duplicates", name: "Organize archived duplicates", callback: () => void this.organizeArchivedDuplicates() });
    this.addCommand({ id: "upgrade-canonical-format", name: "Upgrade quotes to canonical format", callback: () => this.openCanonicalUpgrade() });
    this.addCommand({ id: "preview-migration", name: "Preview migration", callback: () => void this.previewMigration() });
    this.addCommand({ id: "run-schema-migration", name: "Run schema migration", callback: () => this.openMigrationTools() });
    this.addCommand({ id: "verify-migration", name: "Verify active migration", callback: () => void this.verifyMigration() });
    this.addCommand({ id: "modernize-filenames", name: "Modernize filenames", callback: () => this.openMigrationTools() });
    this.addCommand({ id: "rebuild-summaries", name: "Rebuild managed summaries", callback: () => void this.rebuildSummaries() });
     this.addCommand({ id: "restore-migration-backup", name: "Restore a migration backup", callback: () => this.openMigrationTools() });
     this.addCommand({ id: "refresh-dashboard", name: "Refresh dashboard", callback: () => void this.refreshDashboard() });
    this.addCommand({ id: "open-settings", name: "Open Quote Library settings", callback: () => this.openSettings() });
    this.addCommand({ id: "data-quality", name: "Review quote data quality", callback: () => this.openDataQuality() });
    this.addSettingTab(new QuoteLibrarySettingTab(this.app, this));
    this.registerEvent(this.app.vault.on("modify", file => this.handleVaultEvent(file.path))); this.registerEvent(this.app.vault.on("rename", file => this.handleVaultEvent(file.path))); this.registerEvent(this.app.vault.on("delete", file => this.handleVaultEvent(file.path)));
     try { await this.repository.initialize(); this.registerWidgets(); await this.refreshDashboard(); } catch (error) { console.error("Quote Library initialization failed.", error); new Notice(`Quote Library could not initialize: ${message(error)}`); }
  }
  onunload(): void { window.clearTimeout(this.refreshTimer); for (const dispose of this.widgetDisposals) dispose(); this.widgetDisposals = []; this.app.workspace.detachLeavesOfType(DASHBOARD_VIEW); }
  async loadSettings(): Promise<void> { this.settings = upgradeSettings(await this.loadData()); this.settings.customProfiles = this.settings.customProfiles.flatMap(profile => { try { return [validateProfile(profile)]; } catch (error) { console.warn("Quote Library ignored a malformed migration profile.", error); return []; } }); await this.saveData(this.settings); }
  async saveSettings(): Promise<void> { await this.saveData(this.settings); this.repository?.updateSettings(this.settings); this.migration?.updateSettings(this.settings); }
  invalidateMigrationPreview(): void { this.settings.activeMigrationRunId = ""; }

  async openDashboard(): Promise<void> { let leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: DASHBOARD_VIEW, active: true }); } this.app.workspace.revealLeaf(leaf); await this.refreshDashboard(); }
  async openIssueList(): Promise<void> { await this.openDashboard(); const leaf = this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)[0]; if (leaf?.view instanceof QuoteLibraryDashboard) await leaf.view.showIssues(); }
  async openFile(path: string): Promise<void> { const file = this.app.vault.getAbstractFileByPath(path); if (!(file instanceof TFile)) { new Notice("That Quote Library note could not be found."); return; } await this.app.workspace.getLeaf("tab").openFile(file); }
  openQuoteModal(): void { void this.prepareAndOpenQuoteModal(); }
  private async prepareAndOpenQuoteModal(): Promise<void> { try { const data = await this.repository.dashboard(); this.updateCaches(data); } catch (error) { console.warn("Quote Library could not refresh facets before opening the quote form.", error); } new QuoteModal(this.app, this, async input => this.saveQuote(input)).open(); }
  openQuoteEditor(quote: QuoteRecord): void { new QuoteModal(this.app, this, async input => { await this.repository.editQuote(quote.path, input); await this.afterMutation("Quote updated."); }, quote).open(); }
  openTopicManager(): void { new TopicManagerModal(this.app, this).open(); }
  openMigrationTools(): void { new MigrationModal(this.app, this).open(); }
  openCanonicalUpgrade(): void { new CanonicalUpgradeModal(this.app, this).open(); }
  openProfileManager(): void { new ProfileManagerModal(this.app, this).open(); }
  openDataQuality(): void { new DataQualityModal(this.app, this).open(); }
  openSettings(): void { const controller = (this.app as typeof this.app & { setting?: { open(): void; openTabById(id: string): void } }).setting; if (!controller) { new Notice("Open Obsidian Settings, then choose Quote Library."); return; } controller.open(); controller.openTabById(this.manifest.id); }
  async openDuplicateReview(): Promise<void> { const groups = this.repository.duplicateGroups(await this.repository.getQuotes()); new DuplicateReviewModal(this.app, this, groups).open(); }
  updateCaches(data: DashboardData): void { this.cachedTopics = data.topics; this.cachedAuthors = unique(data.quotes.map(quote => quote.author).filter(Boolean)); this.cachedSources = unique(data.quotes.map(quote => quote.source).filter(Boolean)); }

  async saveProfile(profile: MigrationProfile): Promise<void> { if (["quote-library-legacy", "common-quote-properties"].includes(profile.id)) throw new Error("Choose an ID that does not belong to a built-in profile."); const index = this.settings.customProfiles.findIndex(item => item.id === profile.id); if (index >= 0) this.settings.customProfiles[index] = profile; else this.settings.customProfiles.push(profile); this.settings.migrationDefaults.profileId = profile.id; this.invalidateMigrationPreview(); await this.saveSettings(); }
  async deleteProfile(id: string): Promise<void> { this.settings.customProfiles = this.settings.customProfiles.filter(item => item.id !== id); if (this.settings.migrationDefaults.profileId === id) this.settings.migrationDefaults.profileId = "quote-library-legacy"; this.invalidateMigrationPreview(); await this.saveSettings(); }
  async excludeMigrationPath(path: string): Promise<void> { if (!this.settings.migrationDefaults.excludedPaths.includes(path)) this.settings.migrationDefaults.excludedPaths.push(path); this.invalidateMigrationPreview(); await this.saveSettings(); }

  async saveQuote(input: QuoteInput): Promise<void> { const result = await this.repository.saveQuote(input); await this.afterMutation(result.created ? "Quote added." : "That quote already exists."); await this.openFile(result.quote.path); }
  async setPinned(quote: QuoteRecord, pinned: boolean): Promise<void> { await this.repository.setPinned(quote, pinned); await this.afterMutation(pinned ? "Quote pinned." : "Quote unpinned."); }
  async setArchived(quote: QuoteRecord, archived: boolean): Promise<void> { await this.repository.setArchived(quote, archived); await this.afterMutation(archived ? "Quote archived." : "Quote restored."); }
  async createTopic(name: string): Promise<void> { await this.repository.createTopic(name); await this.afterMutation("Topic created."); }
  async renameTopic(topic: TopicRecord, name: string): Promise<void> { await this.repository.renameTopic(topic, name); await this.afterMutation("Topic renamed across the library."); }
  async setTopicStatus(topic: TopicRecord, status: TopicStatus): Promise<void> { await this.repository.setTopicStatus(topic, status); await this.afterMutation(status === "archived" ? "Topic archived." : "Topic reactivated."); }
  async keepDuplicates(quotes: QuoteRecord[]): Promise<void> { await this.repository.keepDuplicates(quotes); await this.afterMutation("Both quotes retained."); }
  async mergeDuplicates(primary: QuoteRecord, secondary: QuoteRecord): Promise<void> { await this.migration.backupForMerge([primary, secondary]); await this.repository.mergeDuplicates(primary, secondary); await this.afterMutation("Duplicate merged without deleting either note."); }
  async organizeArchivedDuplicates(): Promise<void> { const count = await this.repository.organizeArchivedDuplicates(); await this.afterMutation(`${count} archived duplicate note${count === 1 ? "" : "s"} moved.`); }
  async normalizeMetadata(): Promise<void> { const count = await this.repository.normalizeMetadata(); await this.afterMutation(`${count} quote note${count === 1 ? "" : "s"} normalized.`); }
  async previewCanonicalUpgrade() { return this.migration.previewCanonicalUpgrade(); }
  async upgradeCanonicalQuotes(): Promise<CanonicalUpgradeResult> { return this.runBulk(async () => { const result = await this.migration.upgradeCanonical(); await this.afterMutation(result.failures.length ? `Canonical upgrade completed with ${result.failures.length} failure${result.failures.length === 1 ? "" : "s"}.` : `${result.upgraded} quote${result.upgraded === 1 ? "" : "s"} upgraded to canonical format.`); return result; }); }
  async previewMigration() { const preview = await this.migration.recordPreview(); new Notice(`Migration previewed: ${preview.candidates} candidates, ${preview.manualReview} requiring review.`); return preview; }
  async runMigration() { return this.runBulk(async () => { const journal = await this.migration.migrateSchema(); const failed = journal.entries.filter(entry => entry.status === "failed").length; await this.afterMutation(`Migration finished with ${failed} failure${failed === 1 ? "" : "s"}.`); return journal; }); }
  async verifyMigration(runId?: string) { const result = await this.migration.verify(runId); new Notice(result.valid ? "Migration verification passed." : `Migration verification found ${result.failures.length} problem(s).`); return result; }
  async modernizeFilenames() { return this.runBulk(async () => { const journal = await this.migration.modernizeFilenames(); const failed = journal.entries.filter(entry => entry.status === "failed").length; await this.afterMutation(`Filename modernization finished with ${failed} failure${failed === 1 ? "" : "s"}.`); return journal; }); }
  async restoreRun(runId: string) { return this.runBulk(async () => { const count = await this.migration.restoreRun(runId); await this.afterMutation(`${count} quote note${count === 1 ? "" : "s"} restored.`); return count; }); }
  async rebuildSummaries(): Promise<void> { try { await this.repository.rebuildSummaries(); await this.refreshDashboard(); } catch (error) { console.error("Quote Library rebuild failed.", error); new Notice("Quote Library summaries could not be rebuilt."); } }
  async refreshDashboard(): Promise<void> { try { const data = await this.repository.dashboard(); this.updateCaches(data); for (const leaf of this.app.workspace.getLeavesOfType(DASHBOARD_VIEW)) if (leaf.view instanceof QuoteLibraryDashboard) await leaf.view.render(); } catch (error) { console.error("Quote Library dashboard refresh failed.", error); } }
  private async afterMutation(notice: string): Promise<void> { await this.refreshDashboard(); new Notice(notice); }
  private handleVaultEvent(path: string): void { if (!this.settings.power.automation.refreshOnFileChange || this.bulkOperation || !sameOrInside(path, this.repository.root)) return; window.clearTimeout(this.refreshTimer); this.refreshTimer = window.setTimeout(() => void this.refreshDashboard(), this.settings.power.automation.summaryDebounceMs); }
  private registerWidgets(): void {
    for (const dispose of this.widgetDisposals) dispose(); this.widgetDisposals = [];
    const definitions: DashboardWidgetDefinition[] = [
      { id: "quote-library.quote-of-day", name: "Quote of the Day", icon: "quote", description: "A deterministic daily quote from the active library.", defaultLayout: { w: 6, mobileW: 12, h: 3, order: 20 }, mobile: "responsive", render: (ctx, container) => void this.renderWidget(ctx.openNote, container, "daily") },
      { id: "quote-library.pinned", name: "Pinned quotes", icon: "pin", description: "Pinned quotations for quick reference.", defaultLayout: { w: 6, mobileW: 12, h: 4, order: 30 }, mobile: "responsive", render: (ctx, container) => void this.renderWidget(ctx.openNote, container, "pinned") },
      { id: "quote-library.recent", name: "Recent quotes", icon: "clock", description: "Recently added active quotations.", defaultLayout: { w: 6, mobileW: 12, h: 4, order: 40 }, mobile: "responsive", render: (ctx, container) => void this.renderWidget(ctx.openNote, container, "recent") }
    ];
    this.widgetDisposals = definitions.map(definition => registerDashboardWidget(this.app, definition));
  }
  private async renderWidget(openNote: (path: string) => Promise<void> | void, container: HTMLElement, kind: "daily" | "pinned" | "recent"): Promise<void> {
    container.empty(); const data = await this.repository.dashboard(); const active = data.quotes.filter(q => !q.archived); let quotes = kind === "pinned" ? data.quotes.filter(q => q.pinned && (this.settings.power.defaults.showArchivedPinned || !q.archived)) : kind === "recent" ? [...active].sort((a, b) => b.created.localeCompare(a.created)) : active.length ? [active[dailyIndex(active.map(q => q.id || q.path), dateKey())]] : [];
    container.createEl("h3", { text: kind === "daily" ? "Quote of the Day" : kind === "pinned" ? "Pinned quotes" : "Recent quotes" }); if (!quotes.length) { container.createEl("p", { text: "No quotes available.", cls: "quote-library-muted" }); return; }
    for (const quote of quotes.slice(0, this.settings.power.defaults.recentCount)) { const card = container.createDiv({ cls: "quote-library-widget-quote" }); card.createEl("blockquote", { text: quote.text }); card.createEl("span", { text: `— ${quote.author}`, cls: "quote-library-muted" }); const button = card.createEl("button", { text: "Open note" }); button.onclick = () => void openNote(quote.path); }
  }
  private async runBulk<T>(action: () => Promise<T>): Promise<T> { this.bulkOperation = true; try { return await action(); } finally { this.bulkOperation = false; } }
}
function unique(values: string[]): string[] { return [...new Set(values)].sort((left, right) => left.localeCompare(right)); }
function message(error: unknown): string { return error instanceof Error ? error.message : "Unknown startup error."; }
export { DASHBOARD_VIEW };
