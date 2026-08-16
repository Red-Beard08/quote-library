/* Provides mobile-friendly quote entry, topic management, migration, and duplicate-review dialogs. */

import { App, Modal, Notice, Setting } from "obsidian";
import type QuoteLibraryPlugin from "./main";
import type { DuplicateGroup, MigrationPreview, QuoteInput, QuoteRecord, TopicRecord } from "./types";
import { normalizeName, stableNames } from "./utils";

export class QuoteModal extends Modal {
  private text = ""; private author = ""; private source = ""; private newAuthor = ""; private newSource = ""; private newTopics = "";
  private selectedTopics = new Set<string>(); private pinned = false; private archived = false; private notes = "";
  constructor(app: App, private plugin: QuoteLibraryPlugin, private submitQuote: (input: QuoteInput) => Promise<void>, private existing?: QuoteRecord) {
    super(app); if (existing) { this.text = existing.text; this.author = existing.author; this.source = existing.source; this.selectedTopics = new Set(existing.topics); this.pinned = existing.pinned; this.archived = existing.archived; this.notes = existing.notes; }
  }
  onOpen(): void {
    this.modalEl.addClass("quote-library-modal"); this.contentEl.createEl("h2", { text: this.existing ? "Edit quote" : "Add quote" });
    new Setting(this.contentEl).setName("Quote text").addTextArea(c => { c.setPlaceholder("Enter the complete quotation.").setValue(this.text).onChange(v => { this.text = v; }); c.inputEl.rows = 8; });
    this.personSetting("Author", this.plugin.cachedAuthors, this.author, value => { this.author = value; }, value => { this.newAuthor = value; });
    this.personSetting("Source", this.plugin.cachedSources, this.source, value => { this.source = value; }, value => { this.newSource = value; });
    this.topicSelector();
    new Setting(this.contentEl).setName("Add new topics").setDesc("Comma-separated; new topic notes are created automatically.").addText(c => c.setPlaceholder("Faith, Courage").onChange(v => { this.newTopics = v; }));
    new Setting(this.contentEl).setName("Pinned").addToggle(c => c.setValue(this.pinned).onChange(v => { this.pinned = v; }));
    new Setting(this.contentEl).setName("Archived").addToggle(c => c.setValue(this.archived).onChange(v => { this.archived = v; }));
    new Setting(this.contentEl).setName("Personal notes").addTextArea(c => { c.setValue(this.notes).onChange(v => { this.notes = v; }); c.inputEl.rows = 5; });
    new Setting(this.contentEl).addButton(b => b.setButtonText(this.existing ? "Save changes" : "Save quote").setCta().onClick(() => void this.submit()));
  }
  onClose(): void { this.contentEl.empty(); }
  private personSetting(label: string, options: string[], selected: string, choose: (value: string) => void, enter: (value: string) => void): void {
    const setting = new Setting(this.contentEl).setName(label).setDesc(`Choose an existing ${label.toLocaleLowerCase()} or enter a new one.`);
    setting.addDropdown(dropdown => { dropdown.addOption("", "Enter new…"); for (const option of options) dropdown.addOption(option, option); dropdown.setValue(options.includes(selected) ? selected : "").onChange(choose); });
    setting.addText(text => text.setPlaceholder(selected && !options.includes(selected) ? selected : `New ${label.toLocaleLowerCase()}`).setValue(selected && !options.includes(selected) ? selected : "").onChange(enter));
  }
  private topicSelector(): void {
    const setting = new Setting(this.contentEl).setName("Existing topics").setDesc("Select every topic that applies."); setting.controlEl.empty();
    const available = [...this.plugin.cachedTopics.filter(topic => topic.status === "active")];
    for (const name of this.selectedTopics) if (!available.some(topic => normalizeName(topic.name).toLocaleLowerCase() === normalizeName(name).toLocaleLowerCase())) available.push({ id: "", name, status: "archived", aliases: [], path: "", created: "", updated: "" });
    const selector = setting.controlEl.createDiv({ cls: "quote-library-topic-selector" }); if (!available.length) selector.createSpan({ text: "No existing topics yet.", cls: "quote-library-muted" });
    for (const topic of available) { const label = selector.createEl("label", { cls: `quote-library-topic-option${topic.status === "archived" ? " is-archived" : ""}` }); const checkbox = label.createEl("input", { attr: { type: "checkbox" } }); checkbox.checked = [...this.selectedTopics].some(name => normalizeName(name).toLocaleLowerCase() === normalizeName(topic.name).toLocaleLowerCase()); checkbox.onchange = () => { if (checkbox.checked) this.selectedTopics.add(topic.name); else for (const value of this.selectedTopics) if (normalizeName(value).toLocaleLowerCase() === normalizeName(topic.name).toLocaleLowerCase()) this.selectedTopics.delete(value); }; label.createSpan({ text: topic.status === "archived" ? `${topic.name} (archived)` : topic.name }); }
  }
  private async submit(): Promise<void> {
    const input: QuoteInput = { text: this.text, author: normalizeName(this.newAuthor || this.author), source: normalizeName(this.newSource || this.source), topics: stableNames([...this.selectedTopics, ...this.newTopics.split(",")]), pinned: this.pinned, archived: this.archived, notes: this.notes };
    if (!input.text.trim() || !input.author) { new Notice("Quote text and author are required."); return; }
    try { await this.submitQuote(input); this.close(); } catch (error) { new Notice(message(error)); }
  }
}

export class TopicManagerModal extends Modal {
  constructor(app: App, private plugin: QuoteLibraryPlugin) { super(app); }
  onOpen(): void { this.modalEl.addClass("quote-library-modal"); void this.render(); }
  onClose(): void { this.contentEl.empty(); }
  private async render(): Promise<void> {
    this.contentEl.empty(); this.contentEl.createEl("h2", { text: "Manage topics" }); let name = "";
    new Setting(this.contentEl).setName("Create topic").addText(c => c.setPlaceholder("Topic name").onChange(v => { name = v; })).addButton(b => b.setButtonText("Create").setCta().onClick(async () => { try { await this.plugin.createTopic(name); await this.render(); } catch (error) { new Notice(message(error)); } }));
    const topics = await this.plugin.repository.getTopics();
    for (const status of ["active", "archived"] as const) { this.contentEl.createEl("h3", { text: status === "active" ? "Active topics" : "Archived topics" }); const matches = topics.filter(t => t.status === status); if (!matches.length) this.contentEl.createEl("p", { text: `No ${status} topics.`, cls: "quote-library-muted" }); for (const topic of matches) this.row(topic); }
  }
  private row(topic: TopicRecord): void { const row = this.contentEl.createDiv({ cls: "quote-library-manager-row" }); row.createEl("strong", { text: topic.name }); const actions = row.createDiv({ cls: "quote-library-actions" }); button(actions, "Open note", () => void this.plugin.openFile(topic.path)); button(actions, "Rename", () => new RenameTopicModal(this.app, topic.name, async name => { await this.plugin.renameTopic(topic, name); await this.render(); }).open()); button(actions, topic.status === "active" ? "Archive" : "Reactivate", () => void (async () => { await this.plugin.setTopicStatus(topic, topic.status === "active" ? "archived" : "active"); await this.render(); })()); }
}

class RenameTopicModal extends Modal {
  private value: string; constructor(app: App, current: string, private rename: (name: string) => Promise<void>) { super(app); this.value = current; }
  onOpen(): void { this.contentEl.createEl("h2", { text: "Rename topic" }); new Setting(this.contentEl).setName("Name").addText(c => { c.setValue(this.value).onChange(v => { this.value = v; }); c.inputEl.select(); }); new Setting(this.contentEl).addButton(b => b.setButtonText("Rename everywhere").setCta().onClick(async () => { try { await this.rename(this.value); this.close(); } catch (error) { new Notice(message(error)); } })); }
}

export class MigrationModal extends Modal {
  constructor(app: App, private plugin: QuoteLibraryPlugin) { super(app); }
  onOpen(): void { this.modalEl.addClass("quote-library-modal"); void this.render(); }
  private async render(): Promise<void> {
    this.contentEl.empty(); this.contentEl.createEl("h2", { text: "Quote migration" }); this.contentEl.createEl("p", { text: `Current phase: ${this.plugin.settings.migrationPhase}` });
    const actions = this.contentEl.createDiv({ cls: "quote-library-actions" });
    button(actions, "Preview migration", () => void this.run(async () => this.showPreview(await this.plugin.previewMigration())), true);
    button(actions, "Run schema migration", () => void this.confirm("Back up and migrate all compatible quote notes now?", () => this.plugin.runMigration()));
    button(actions, "Verify migration", () => void this.run(async () => { const result = await this.plugin.verifyMigration(); this.showLines(result.valid ? "Verification passed" : "Verification failed", [...result.checks, ...result.failures]); }));
    button(actions, "Modernize filenames", () => void this.confirm("Create a second backup and rename verified quote notes now?", () => this.plugin.modernizeFilenames()));
    button(actions, "Restore latest backup", () => void this.confirm("Restore every note from the latest migration journal?", () => this.plugin.restoreLatest()));
  }
  private showPreview(p: MigrationPreview): void { this.showLines("Migration preview", [`${p.total} quote files`, `${p.unreadable} unreadable files`, `${p.missingId} missing IDs`, `${p.missingType} missing type`, `${p.missingSource} missing source`, `${p.missingTimestamp} missing timestamps`, `${p.pinnedArchived} pinned and archived`, `${p.duplicateGroups} duplicate groups`, `${p.convertibleBodies} known legacy bodies`, `${p.manualReview} manual-review records`]); }
  private showLines(title: string, lines: string[]): void { this.contentEl.querySelector(".quote-library-result")?.remove(); const result = this.contentEl.createDiv({ cls: "quote-library-result" }); result.createEl("h3", { text: title }); const list = result.createEl("ul"); for (const line of lines) list.createEl("li", { text: line }); }
  private async run(action: () => Promise<void>): Promise<void> { try { await action(); } catch (error) { new Notice(message(error)); } }
  private confirm(prompt: string, action: () => Promise<unknown>): void { new ConfirmActionModal(this.app, prompt, async () => { try { await action(); await this.render(); } catch (error) { new Notice(message(error)); } }).open(); }
}

export class DuplicateReviewModal extends Modal {
  private index = 0; constructor(app: App, private plugin: QuoteLibraryPlugin, private groups: DuplicateGroup[]) { super(app); }
  onOpen(): void { this.modalEl.addClass("quote-library-modal"); this.render(); }
  private render(): void {
    this.contentEl.empty(); this.contentEl.createEl("h2", { text: "Review duplicates" }); const group = this.groups[this.index]; if (!group) { this.contentEl.createEl("p", { text: "No duplicate groups need review." }); return; }
    this.contentEl.createEl("p", { text: `Group ${this.index + 1} of ${this.groups.length}` });
    for (const quote of group.quotes) { const card = this.contentEl.createDiv({ cls: "quote-library-duplicate-card" }); card.createEl("blockquote", { text: quote.text }); card.createEl("strong", { text: quote.author }); card.createEl("span", { text: quote.source || "No source", cls: "quote-library-muted" }); }
    const actions = this.contentEl.createDiv({ cls: "quote-library-actions" }); button(actions, "Keep both", () => void this.act(async () => this.plugin.keepDuplicates(group.quotes)), true);
    if (group.quotes.length >= 2) { button(actions, "Merge into oldest", () => void this.act(async () => this.plugin.mergeDuplicates(group.quotes[0], group.quotes[1]))); button(actions, "Merge into newest", () => void this.act(async () => this.plugin.mergeDuplicates(group.quotes[1], group.quotes[0]))); }
  }
  private async act(action: () => Promise<void>): Promise<void> { try { await action(); this.groups = this.plugin.repository.duplicateGroups(await this.plugin.repository.getQuotes()); this.index = Math.min(this.index, Math.max(0, this.groups.length - 1)); this.render(); } catch (error) { new Notice(message(error)); } }
}

class ConfirmActionModal extends Modal { constructor(app: App, private prompt: string, private action: () => Promise<void>) { super(app); } onOpen(): void { this.contentEl.createEl("h2", { text: "Confirm action" }); this.contentEl.createEl("p", { text: this.prompt }); const actions = this.contentEl.createDiv({ cls: "quote-library-actions" }); button(actions, "Cancel", () => this.close()); button(actions, "Continue", () => void (async () => { this.close(); await this.action(); })(), true); } }
function button(parent: HTMLElement, label: string, action: () => void, cta = false): void { const element = parent.createEl("button", { text: label, cls: cta ? "mod-cta" : "" }); element.onclick = action; }
function message(error: unknown): string { return error instanceof Error ? error.message : "Quote Library could not complete that action."; }
