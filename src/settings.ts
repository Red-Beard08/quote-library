/* Renders portable Quote Library storage, daily-selection, and migration settings. */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type QuoteLibraryPlugin from "./main";

export class QuoteLibrarySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QuoteLibraryPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty(); new Setting(containerEl).setName("Library storage").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: "Quotes remain ordinary Markdown. New installations default to Quote Library; an existing vault can adopt another folder without moving files." });
    new Setting(containerEl).setName("Library root").setDesc("Vault-relative folder containing quote notes.").addText(text => text.setPlaceholder("Quote Library").setValue(this.plugin.settings.rootFolder).onChange(async value => { const normalized = clean(value); if (!normalized) return; if (normalized !== this.plugin.settings.rootFolder) { this.plugin.settings.rootFolder = normalized; this.plugin.settings.migrationPhase = "none"; this.plugin.settings.previewSignature = ""; this.plugin.settings.latestJournalPath = ""; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Backup folder").setDesc("Vault-relative folder used for verified migration backups and journals.").addText(text => text.setPlaceholder("Quote Library Backups").setValue(this.plugin.settings.backupFolder).onChange(async value => { const normalized = clean(value); if (normalized) { this.plugin.settings.backupFolder = normalized; await this.plugin.saveSettings(); } }));
    new Setting(containerEl).setName("Prefer pinned daily quotes").setDesc("When active pinned quotes exist, choose Quote of the Day from them first.").addToggle(toggle => toggle.setValue(this.plugin.settings.preferPinnedForDaily).onChange(async value => { this.plugin.settings.preferPinnedForDaily = value; await this.plugin.saveSettings(); await this.plugin.refreshDashboard(); }));
    new Setting(containerEl).setName("Migration").setHeading();
    new Setting(containerEl).setName("Current phase").setDesc(this.plugin.settings.migrationPhase).addButton(button => button.setButtonText("Open migration tools").onClick(() => this.plugin.openMigrationTools()));
    new Setting(containerEl).setName("Rebuild summaries").setDesc("Refresh the managed index and topic-note quote lists.").addButton(button => button.setButtonText("Rebuild").onClick(async () => { await this.plugin.rebuildSummaries(); new Notice("Quote Library summaries rebuilt."); }));
  }
}
function clean(value: string): string { const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); return normalized.split("/").some(part => !part || part === "." || part === "..") ? "" : normalized; }
