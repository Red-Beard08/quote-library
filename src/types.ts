/* Defines settings, records, migration journals, and form contracts for Quote Library. */

export type TopicStatus = "active" | "archived";
export type MigrationPhase = "none" | "previewed" | "schema-migrated" | "verified" | "filenames-modernized";

export interface QuoteLibrarySettings {
  rootFolder: string;
  backupFolder: string;
  preferPinnedForDaily: boolean;
  migrationPhase: MigrationPhase;
  latestJournalPath: string;
  previewSignature: string;
}

export const DEFAULT_SETTINGS: QuoteLibrarySettings = {
  rootFolder: "Quote Library",
  backupFolder: "Quote Library Backups",
  preferPinnedForDaily: true,
  migrationPhase: "none",
  latestJournalPath: "",
  previewSignature: ""
};

export interface QuoteInput {
  text: string;
  author: string;
  source: string;
  topics: string[];
  pinned: boolean;
  archived: boolean;
  notes: string;
}

export interface QuoteRecord extends QuoteInput {
  id: string;
  path: string;
  aliases: string[];
  created: string;
  updated: string;
  legacy: boolean;
  duplicateOf: string;
  duplicateKept: boolean;
}

export interface TopicRecord {
  id: string;
  name: string;
  status: TopicStatus;
  aliases: string[];
  path: string;
  created: string;
  updated: string;
}

export interface DuplicateGroup { key: string; quotes: QuoteRecord[]; }
export interface DashboardData { quotes: QuoteRecord[]; topics: TopicRecord[]; duplicates: DuplicateGroup[]; unreadablePaths: string[]; }

export interface MigrationIssue { path: string; issues: string[]; proposedId: string; bodyConvertible: boolean; }
export interface MigrationPreview {
  generated: string;
  signature: string;
  total: number;
  missingSource: number;
  missingTimestamp: number;
  missingId: number;
  missingType: number;
  pinnedArchived: number;
  duplicateGroups: number;
  convertibleBodies: number;
  manualReview: number;
  unreadable: number;
  items: MigrationIssue[];
}

export interface MigrationJournalEntry {
  sourcePath: string;
  backupPath: string;
  originalHash: string;
  backupHash: string;
  proposedId: string;
  originalText: string;
  originalAuthor: string;
  status: "backed-up" | "migrated" | "renamed" | "failed" | "restored";
  destinationPath?: string;
  error?: string;
}

export interface MigrationJournal {
  version: 1;
  phase: "schema" | "filenames" | "duplicate-merge";
  created: string;
  rootFolder: string;
  backupRoot: string;
  entries: MigrationJournalEntry[];
}

export interface VerificationResult { valid: boolean; checks: string[]; failures: string[]; }
