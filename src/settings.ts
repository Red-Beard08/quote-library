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
    this.layoutText("Duplicate archive subfolder", "Relative to the Quotes location. Merged secondary notes are moved here.", "duplicateArchiveFolder", cleanFolder);
    this.layoutText("Index filename", "Markdown filename stored at the library root.", "indexFile", cleanMarkdownFile);
    this.layoutText("Backup folder", "Vault-relative folder outside the Quotes location.", "backupFolder", cleanFolder);
    const layoutFailures = validateLayout(this.plugin.settings.layout); if (layoutFailures.length) containerEl.createEl("p", { cls: "quote-library-setting-error", text: layoutFailures.join(" ") });

    new Setting(containerEl).setName("Canonical upgrade").setHeading();
    containerEl.createEl("p", { cls: "setting-item-description", text: "Preview and upgrade notes marked Legacy using verified backups and the current Quote Library schema." });
    new Setting(containerEl).setName("Include archived duplicates").setDesc("Include Legacy notes in the duplicate archive folder.").addToggle(toggle => toggle.setValue(this.plugin.settings.canonicalUpgrade.includeArchivedDuplicates).onChange(async value => { this.plugin.settings.canonicalUpgrade.includeArchivedDuplicates = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Remove known legacy display").setDesc("Remove only the recognized older Dataview display after backup.").addToggle(toggle => toggle.setValue(this.plugin.settings.canonicalUpgrade.cleanupKnownLegacyBody).onChange(async value => { this.plugin.settings.canonicalUpgrade.cleanupKnownLegacyBody = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Modernize upgraded filenames").setDesc("Optionally rename upgraded notes to their short QTE ID and excerpt.").addToggle(toggle => toggle.setValue(this.plugin.settings.canonicalUpgrade.modernizeFilenames).onChange(async value => { this.plugin.settings.canonicalUpgrade.modernizeFilenames = value; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Upgrade tool").setDesc("Preview the exact notes before changing anything.").addButton(button => button.setButtonText("Open canonical upgrade").setCta().onClick(() => this.plugin.openCanonicalUpgrade()));

    new Setting(containerEl).setName("Migration defaults").setHeading();
    this.migrationText("Source folder", "Vault-relative folder containing notes to import. Blank uses the configured Quotes location.", "sourceFolder");
    new Setting(containerEl).setName("Include subfolders").setDesc("Scan the migration source recursively.").addToggle(toggle => toggle.setValue(this.plugin.settings.migrationDefaults.recursive).onChange(async value => { this.plugin.settings.migrationDefaults.recursive = value; await this.changedMigration(); }));
    new Setting(containerEl).setName("Default migration mode").setDesc("Copy leaves source notes untouched; in-place adopts and converts the source folder.").addDropdown(dropdown => dropdown.addOption("copy", "Copy into library").addOption("in-place", "Backed-up in-place conversion").setValue(this.plugin.settings.migrationDefaults.mode).onChange(async value => { this.plugin.settings.migrationDefaults.mode = value === "in-place" ? "in-place" : "copy"; await this.changedMigration(); }));
    new Setting(containerEl).setName("Mapping profile").setDesc("Controls source properties, filters, and optional body extraction.").addDropdown(dropdown => { for (const profile of profiles(this.plugin.settings.customProfiles)) dropdown.addOption(profile.id, profile.name); dropdown.setValue(this.plugin.settings.migrationDefaults.profileId).onChange(async value => { this.plugin.settings.migrationDefaults.profileId = value; await this.changedMigration(); }); }).addButton(button => button.setButtonText("Manage profiles").onClick(() => this.plugin.openProfileManager()));
    const migrationFailures = validateMigration(this.plugin.settings.layout, this.plugin.settings.migrationDefaults); if (migrationFailures.length) containerEl.createEl("p", { cls: "quote-library-setting-error", text: migrationFailures.join(" ") });

    new Setting(containerEl).setName("Migration history").setHeading();
    new Setting(containerEl).setName("Saved runs").setDesc(`${this.plugin.settings.migrationHistory.length} journaled migration run${this.plugin.settings.migrationHistory.length === 1 ? "" : "s"}.`).addButton(button => button.setButtonText("Open migration tools").onClick(() => this.plugin.openMigrationTools()));

    new Setting(containerEl).setName("Dashboard").setHeading();
    new Setting(containerEl).setName("Power-user defaults").setHeading();
    this.powerText("Quote ID prefix", "Stable IDs for new quote notes.", this.plugin.settings.power.naming.quoteIdPrefix, value => { this.plugin.settings.power.naming.quoteIdPrefix = value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 20) || "QTE"; });
    this.powerText("Topic ID prefix", "Stable IDs for new topic notes.", this.plugin.settings.power.naming.topicIdPrefix, value => { this.plugin.settings.power.naming.topicIdPrefix = value.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 20) || "TPC"; });
    this.powerText("Filename template", "Use {id} and {excerpt}; changing this does not rename existing notes.", this.plugin.settings.power.naming.filenameTemplate, value => { this.plugin.settings.power.naming.filenameTemplate = value.trim() || "{id} - {excerpt}"; });
    this.powerNumber("Excerpt length", "Maximum descriptive filename excerpt for future notes.", this.plugin.settings.power.naming.excerptLength, 20, 120, value => { this.plugin.settings.power.naming.excerptLength = value; });
    new Setting(containerEl).setName("Normalize authors on save").setDesc("Trim surrounding quotes and collapse repeated spaces.").addToggle(toggle => toggle.setValue(this.plugin.settings.power.taxonomy.normalizeAuthors).onChange(value => { this.plugin.settings.power.taxonomy.normalizeAuthors = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Normalize sources on save").setDesc("Apply the same conservative metadata cleanup to sources.").addToggle(toggle => toggle.setValue(this.plugin.settings.power.taxonomy.normalizeSources).onChange(value => { this.plugin.settings.power.taxonomy.normalizeSources = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Allow archived topics in entry forms").setDesc("Keep archived topics selectable for historical edits.").addToggle(toggle => toggle.setValue(this.plugin.settings.power.taxonomy.allowArchivedTopics).onChange(value => { this.plugin.settings.power.taxonomy.allowArchivedTopics = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("New quotes start pinned").addToggle(toggle => toggle.setValue(this.plugin.settings.power.defaults.defaultPinned).onChange(value => { this.plugin.settings.power.defaults.defaultPinned = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("New quotes start archived").addToggle(toggle => toggle.setValue(this.plugin.settings.power.defaults.defaultArchived).onChange(value => { this.plugin.settings.power.defaults.defaultArchived = value; void this.plugin.saveSettings(); }));
    this.powerNumber("Recent quote count", "How many recent and pinned cards appear on the overview.", this.plugin.settings.power.defaults.recentCount, 1, 50, value => { this.plugin.settings.power.defaults.recentCount = value; });
    new Setting(containerEl).setName("Show archived pinned quotes").setDesc("Keep pinned quotes visible in the pinned overview even when archived.").addToggle(toggle => toggle.setValue(this.plugin.settings.power.defaults.showArchivedPinned).onChange(value => { this.plugin.settings.power.defaults.showArchivedPinned = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Dashboard density").addDropdown(dropdown => dropdown.addOption("comfortable", "Comfortable").addOption("compact", "Compact").setValue(this.plugin.settings.power.dashboard.compact ? "compact" : "comfortable").onChange(async value => { this.plugin.settings.power.dashboard.compact = value === "compact"; await this.plugin.saveSettings(); await this.plugin.refreshDashboard(); }));
    new Setting(containerEl).setName("Dashboard card columns").addDropdown(dropdown => dropdown.addOption("1", "One").addOption("2", "Two").setValue(String(this.plugin.settings.power.dashboard.cardColumns)).onChange(async value => { this.plugin.settings.power.dashboard.cardColumns = value === "1" ? 1 : 2; await this.plugin.saveSettings(); await this.plugin.refreshDashboard(); }));
    new Setting(containerEl).setName("Refresh on vault changes").addToggle(toggle => toggle.setValue(this.plugin.settings.power.automation.refreshOnFileChange).onChange(value => { this.plugin.settings.power.automation.refreshOnFileChange = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Show privacy reminder").setDesc("Explain that quote records are ordinary Markdown notes.").addToggle(toggle => toggle.setValue(this.plugin.settings.power.privacy.showReminder).onChange(value => { this.plugin.settings.power.privacy.showReminder = value; void this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Rebuild summaries").setDesc("Refresh the managed index and topic-note quote lists.").addButton(button => button.setButtonText("Rebuild").onClick(async () => { await this.plugin.rebuildSummaries(); new Notice("Quote Library summaries rebuilt."); }));
  }

  private layoutText(name: string, description: string, key: "rootFolder" | "quotesFolder" | "topicsFolder" | "duplicateArchiveFolder" | "indexFile" | "backupFolder", clean: (value: string) => string): void {
    new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(this.plugin.settings.layout[key]).onChange(async value => { try { const normalized = clean(value); if (normalized === this.plugin.settings.layout[key]) return; this.plugin.settings.layout[key] = normalized; this.plugin.invalidateMigrationPreview(); await this.plugin.saveSettings(); } catch { /* Keep the last valid value while the user types. */ } }));
  }
  private migrationText(name: string, description: string, key: "sourceFolder"): void { new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(this.plugin.settings.migrationDefaults[key]).onChange(async value => { try { this.plugin.settings.migrationDefaults[key] = cleanOptionalFolder(value); await this.changedMigration(); } catch { /* Keep the last valid value while the user types. */ } })); }
  private powerText(name: string, description: string, value: string, assign: (value: string) => void): void { new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(value).onChange(async next => { assign(next); await this.plugin.saveSettings(); })); }
  private powerNumber(name: string, description: string, value: number, min: number, max: number, assign: (value: number) => void): void { new Setting(this.containerEl).setName(name).setDesc(description).addText(text => text.setValue(String(value)).setPlaceholder(String(value)).onChange(async next => { const parsed = Number(next); if (!Number.isFinite(parsed)) return; assign(Math.min(max, Math.max(min, Math.round(parsed)))); await this.plugin.saveSettings(); })); }
  private async changedMigration(): Promise<void> { this.plugin.invalidateMigrationPreview(); await this.plugin.saveSettings(); }
}
