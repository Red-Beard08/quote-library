/* Renders portable storage, migration defaults, profile, history, and dashboard settings. */

import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import { cleanFolder, cleanMarkdownFile, cleanOptionalFolder, validateLayout, validateMigration } from "./config";
import type QuoteLibraryPlugin from "./main";
import { profiles } from "./profiles";

export class QuoteLibrarySettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: QuoteLibraryPlugin) { super(app, plugin); }
  display(): void {
    const { containerEl } = this; containerEl.empty(); new Setting(containerEl).setName("Library layout").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: "All locations are vault-relative. Changing a location does not move existing notes." });
    this.layoutText("Library root", "Top-level managed folder.", "rootFolder", cleanFolder);
    this.layoutText("Quotes subfolder", "Relative to the library root; leave blank for a flat existing library.", "quotesFolder", cleanOptionalFolder);
    this.layoutText("Topics subfolder", "Relative to the library root.", "topicsFolder", cleanFolder);
    this.layoutText("Index filename", "Markdown filename stored at the library root.", "indexFile", cleanMarkdownFile);
    this.layoutText("Backup folder", "Vault-relative folder outside the Quotes location.", "backupFolder", cleanFolder);
    const layoutFailures = validateLayout(this.plugin.settings.layout); if (layoutFailures.length) containerEl.createEl("p", { cls: "quote-library-setting-error", text: layoutFailures.join(" ") });

    new Setting(containerEl).setName("Migration defaults").setHeading();
    this.migrationText("Source folder", "Vault-relative folder containing notes to import. Blank uses the configured Quotes location.", "sourceFolder");
    new Setting(containerEl).setName("Include subfolders").setDesc("Scan the migration source recursively.").addToggle(toggle => toggle.setValue(this.plugin.settings.migrationDefaults.recursive).onChange(async value => { this.plugin.settings.migrationDefaults.recursive = value; await this.changedMigration(); }));
    new Setting(containerEl).setName("Default migration mode").setDesc("Copy leaves source notes untouched; in-place adopts and converts the source folder.").addDropdown(dropdown => dropdown.addOption("copy", "Copy into library").addOption("in-place", "Backed-up in-place conversion").setValue(this.plugin.settings.migrationDefaults.mode).onChange(async value => { this.plugin.settings.migrationDefaults.mode = value === "in-place" ? "in-place" : "copy"; await this.changedMigration(); }));
    new Setting(containerEl).setName("Mapping profile").setDesc("Controls source properties, filters, and optional body extraction.").addDropdown(dropdown => { for (const profile of profiles(this.plugin.settings.customProfiles)) dropdown.addOption(profile.id, profile.name); dropdown.setValue(this.plugin.settings.migrationDefaults.profileId).onChange(async value => { this.plugin.settings.migrationDefaults.profileId = value; await this.changedMigration(); }); }).addButton(button => button.setButtonText("Manage profiles").onClick(() => this.plugin.openProfileManager()));
    const migrationFailures = validateMigration(this.plugin.settings.layout, this.plugin.settings.migrationDefaults); if (migrationFailures.length) containerEl.createEl("p", { cls: "quote-library-setting-error", text: migrationFailures.join(" ") });

    new Setting(containerEl).setName("Migration history").setHeading();
    new Setting(containerEl).setName("Saved runs").setDesc(`${this.plugin.settings.migrationHistory.length} journaled migration run${this.plugin.settings.migrationHistory.length === 1 ? "" : "s"}.`).addButton(button => button.setButtonText("Open migration tools").onClick(() => this.plugin.openMigrationTools()));

    new Setting(containerEl).setName("Dashboard").setHeading();
    new Setting(containerEl).setName("Prefer pinned daily quotes").setDesc("When active pinned quotes exist, choose Quote of the Day from them first.").addToggle(toggle => toggle.setValue(this.plugin.settings.preferPinnedForDaily).onChange(async value => { this.plugin.settings.preferPinnedForDaily = value; await this.plugin.saveSettings(); await this.plugin.refreshDashboard(); }));
    new Setting(containerEl).setName("Rebuild summaries").setDesc("Refresh the managed index and topic-note quote lists.").addButton(button => button.setButtonText("Rebuild").onClick(async () => { await this.plugin.rebuildSummaries(); new Notice("Quote Library summaries rebuilt."); }));
  }

  private layoutText(name: string, description: string, key: "rootFolder" | "quotesFolder" | "topicsFolder" | "indexFile" | "backupFolder", clean: (value: string) => string): void {
    new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(this.plugin.settings.layout[key]).onChange(async value => { try { const normalized = clean(value); if (normalized === this.plugin.settings.layout[key]) return; this.plugin.settings.layout[key] = normalized; this.plugin.invalidateMigrationPreview(); await this.plugin.saveSettings(); } catch { /* Keep the last valid value while the user types. */ } }));
  }
  private migrationText(name: string, description: string, key: "sourceFolder"): void { new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(this.plugin.settings.migrationDefaults[key]).onChange(async value => { try { this.plugin.settings.migrationDefaults[key] = cleanOptionalFolder(value); await this.changedMigration(); } catch { /* Keep the last valid value while the user types. */ } })); }
  private async changedMigration(): Promise<void> { this.plugin.invalidateMigrationPreview(); await this.plugin.saveSettings(); }
}
