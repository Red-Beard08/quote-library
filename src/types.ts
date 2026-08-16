/* Defines portable settings, records, import profiles, migration runs, and journal contracts. */

export type TopicStatus = "active" | "archived";
export type MigrationMode = "copy" | "in-place";
export type BodyExtractionStrategy = "off" | "first-blockquote" | "heading-blockquote";
export type MigrationRunStatus = "previewed" | "migrated" | "verified" | "filenames-modernized" | "restored" | "failed";

export interface LibraryLayoutSettings { rootFolder: string; quotesFolder: string; topicsFolder: string; indexFile: string; backupFolder: string; }
export interface MigrationFieldMap { text: string[]; author: string[]; source: string[]; topics: string[]; pinned: string[]; archived: string[]; created: string[]; updated: string[]; aliases: string[]; tags: string[]; }
export interface BodyExtractionRule { strategy: BodyExtractionStrategy; heading: string; attributionLine: boolean; cleanupKnownLegacyBody: boolean; }
export interface MigrationProfile { version: 1; id: string; name: string; builtIn?: boolean; fields: MigrationFieldMap; requiredTags: string[]; requiredTypes: string[]; body: BodyExtractionRule; }
export interface MigrationDefaults { sourceFolder: string; recursive: boolean; mode: MigrationMode; profileId: string; excludedPaths: string[]; }
export interface MigrationRunSummary { id: string; created: string; status: MigrationRunStatus; mode: MigrationMode; sourceFolder: string; targetFolder: string; profileName: string; previewSignature: string; journalPath: string; total: number; failures: number; }
export interface QuoteLibrarySettings { settingsVersion: 2; layout: LibraryLayoutSettings; preferPinnedForDaily: boolean; migrationDefaults: MigrationDefaults; customProfiles: MigrationProfile[]; activeMigrationRunId: string; migrationHistory: MigrationRunSummary[]; }

export const DEFAULT_LAYOUT: LibraryLayoutSettings = { rootFolder: "Quote Library", quotesFolder: "Quotes", topicsFolder: "Topics", indexFile: "Quote Library Index.md", backupFolder: "Quote Library Backups" };
export const DEFAULT_SETTINGS: QuoteLibrarySettings = { settingsVersion: 2, layout: DEFAULT_LAYOUT, preferPinnedForDaily: true, migrationDefaults: { sourceFolder: "Quote Imports", recursive: true, mode: "copy", profileId: "quote-library-legacy", excludedPaths: [] }, customProfiles: [], activeMigrationRunId: "", migrationHistory: [] };

export interface QuoteInput { text: string; author: string; source: string; topics: string[]; pinned: boolean; archived: boolean; notes: string; }
export interface QuoteRecord extends QuoteInput { id: string; path: string; aliases: string[]; created: string; updated: string; legacy: boolean; duplicateOf: string; duplicateKept: boolean; }
export interface TopicRecord { id: string; name: string; status: TopicStatus; aliases: string[]; path: string; created: string; updated: string; }
export interface DuplicateGroup { key: string; quotes: QuoteRecord[]; }
export interface DashboardData { quotes: QuoteRecord[]; topics: TopicRecord[]; duplicates: DuplicateGroup[]; unreadablePaths: string[]; }

export interface MigrationIssue { path: string; issues: string[]; proposedId: string; destinationPath: string; bodyConvertible: boolean; confidence: "high" | "manual"; }
export interface MigrationPreview { runId: string; generated: string; signature: string; total: number; candidates: number; excluded: number; missingSource: number; missingTimestamp: number; missingId: number; missingType: number; pinnedArchived: number; duplicateGroups: number; convertibleBodies: number; manualReview: number; unreadable: number; items: MigrationIssue[]; }

export interface MigrationJournalEntry { sourcePath: string; backupPath: string; originalHash: string; backupHash: string; proposedId: string; originalText: string; originalAuthor: string; status: "backed-up" | "migrated" | "copied" | "renamed" | "failed" | "restored" | "skipped"; destinationPath?: string; destinationHash?: string; error?: string; }
export interface MigrationJournalV1 { version: 1; phase: "schema" | "filenames" | "duplicate-merge"; created: string; rootFolder: string; backupRoot: string; entries: MigrationJournalEntry[]; }
export interface MigrationJournalV2 { version: 2; runId: string; phase: "schema" | "filenames" | "duplicate-merge"; mode: MigrationMode; created: string; sourceFolder: string; targetFolder: string; backupRoot: string; profile: MigrationProfile; entries: MigrationJournalEntry[]; }
export type MigrationJournal = MigrationJournalV1 | MigrationJournalV2;
export interface VerificationResult { valid: boolean; checks: string[]; failures: string[]; }
