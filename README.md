---
title: Quote Library
version: 1.1.0
tags:
  - obsidian
  - quotes
  - plugin
---

# Quote Library

Quote Library is a mobile-compatible Obsidian plugin for capturing, organizing, revisiting, and safely migrating quotations stored as ordinary Markdown notes. It provides a responsive dashboard without requiring Dataview, Templater, or another community plugin.

## Features

- Overview, Topics, Authors, Sources, and Archive dashboard tabs
- Deterministic Quote of the Day with active-pinned preference
- Search across text, author, source, topics, and notes
- Add and edit forms with existing-value selection and freeform entry
- Pin, archive, restore, copy, and native-note actions
- Managed topic notes and a Markdown library index
- Duplicate review with non-destructive merging
- Read-only compatibility with legacy `quote_*` frontmatter
- Previewed, backed-up, journaled schema migration
- Separately verified filename modernization and journal-based rollback
- Responsive desktop and iOS layouts

## Installation

### Release installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create `.obsidian/plugins/quote-library/` inside the target vault.
3. Copy all three files into that folder.
4. Reload Obsidian and enable **Quote Library** under Community plugins.

On iOS, wait for all three files to finish syncing before enabling or reloading the plugin.

### Development

```bash
npm ci
npm test
```

Copy `main.js`, `manifest.json`, and `styles.css` into a plugin folder named `quote-library`.

## How to Use

### Start a library

Open the ribbon icon or run **Quote Library: Open dashboard**. A clean installation creates:

```text
Quote Library/
  Quote Library Index.md
  Topics/
```

Change the library root in settings before adding quotes. Changing the setting does not move existing notes.

### Add and edit quotes

1. Select **Add quote**.
2. Enter the quotation and author.
3. Choose or enter a source.
4. Select existing topics or enter new comma-separated topics.
5. Optionally pin, archive, or add personal notes.
6. Save.

Quote text and author are required. A normalized text-and-author collision opens the existing record. Text-only collisions appear under duplicate review.

### Browse the dashboard

- **Overview** shows metrics, Quote of the Day, incomplete records, pinned quotes, and recent additions.
- **Topics** groups quotes by managed topics.
- **Authors** and **Sources** derive reports directly from quote metadata.
- **Archive** shows archived records with Restore actions.

Every card supports Edit, Copy, Pin or Unpin, Archive or Restore, and Open note. Quote Library never permanently deletes a quote through the dashboard.

## Markdown Schema

```yaml
type: quote-library-quote
id: QTE-550E8400-E29B-41D4-A716-446655440000
quote_text: "The quotation"
quote_author: Author Name
quote_source: Source
quote_pin: false
quote_archive: false
topics:
  - Topic
tags:
  - quote
aliases:
  - "Short description — Author Name"
created: YYYY-MM-DDTHH:mm
updated: YYYY-MM-DDTHH:mm
```

Quote IDs use `QTE-<GUID>` and contain no dates, times, authors, or quote text. New quotes receive a random GUID. Migration converts the former timestamp-based IDs to deterministic GUIDs so repeated previews propose the same identity. Modernized filenames use `QTE-<GUID> - Short quote excerpt.md`; the GUID remains the permanent identity if descriptive metadata later changes.

The quote display is bounded by managed markers. Personal writing belongs under **Personal notes** and is preserved outside managed content.

## Legacy Compatibility and Migration

Quote Library can read notes containing `quote_text`, `quote_author`, `quote_source`, `quote_pin`, and `quote_archive` before those notes are migrated. Installation never automatically migrates existing notes.

The staged workflow is:

1. **Preview migration** produces a non-mutating inventory and signature.
2. **Run schema migration** requires an unchanged preview, copies every source note into the configured backup folder, verifies SHA-256 hashes, writes a journal, then migrates each note independently.
3. **Verify migration** confirms backups, record counts, IDs, paths, text, and authors. Filename modernization remains locked until verification passes.
4. **Modernize filenames** creates a second backup and renames notes through Obsidian's file manager.
5. **Restore latest backup** verifies backup hashes before restoring journaled records.

Migration preserves pinned and archived as independent fields, does not infer topics, does not automatically merge duplicates, and leaves failed files readable in compatibility mode.

Duplicate review offers **Keep both** or a non-destructive merge. A merged secondary record is archived and linked to the canonical quote rather than deleted.

## Limitations

- Topic assignment is manual; the plugin does not infer meaning from quote text.
- Author and source reports are metadata facets rather than separate note collections.
- Quote Library does not verify quotations or attribution accuracy.
- It does not provide OCR, browser capture, analytics, encryption, or cloud sync.
- Backup folders are stored inside the vault so the workflow remains mobile-compatible.
- Native filesystem links outside Obsidian cannot be updated during filename modernization.

## Validation

```bash
npm ci
npm run typecheck
npm run build
npm test
node scripts/detect-desktop-dependencies.mjs
node scripts/validate-version.mjs 1.1.0
```

## License

Quote Library is released under the MIT License.
