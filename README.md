---
title: Quote Library
version: 1.3.0
tags:
  - obsidian
  - quotes
  - plugin
---

# Quote Library

Quote Library is a mobile-compatible Obsidian plugin for capturing, organizing, and safely importing quotations stored as ordinary Markdown. Its responsive dashboard works without Dataview, Templater, network access, or another community plugin.

## Features

- Overview, Topics, Authors, Sources, and Archive dashboard tabs
- Stable Quote of the Day with optional pinned-quote preference
- Per-quote explanations for every Needs attention item
- Search across quote text, author, source, topics, and personal notes
- Add and edit forms with existing-value suggestions and freeform entry
- Pin, archive, restore, copy, and open-note actions
- Configurable root, quote, topic, index, and backup locations
- Managed topic notes and a Markdown library index
- Duplicate review with non-destructive merging
- Shared Red-Beard Foundation path, managed-block, hashing, mobile-modal, and dashboard-widget contracts
- Data quality preview for incomplete, legacy, ambiguous, duplicate, invalid, and out-of-root records
- Optional Quote of the Day, pinned, and recent widgets for Red-Beard Dashboard
- Reusable migration profiles with JSON import and export
- Frontmatter mapping plus optional body extraction
- Previewed, backed-up, journaled copy or in-place migrations
- Per-run verification, history, and rollback
- Responsive desktop and iOS layouts

## Installation

### Release installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release.
2. Create `.obsidian/plugins/quote-library/` inside the target vault.
3. Copy all three files into that folder.
4. Reload Obsidian and enable **Quote Library** under Community plugins.

On iOS, allow all three files to finish syncing before enabling or reloading the plugin.

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
  Quotes/
  Topics/
```

The settings page can change every managed location. Folder paths are vault-relative and must not begin with `/`, contain `..`, or use a drive letter. Changing a path does not move existing files.

An existing installation is upgraded without relocating its library. In particular, an older flat library remains flat until its owner deliberately changes the layout.

### Add and edit quotes

1. Select **Add quote**.
2. Enter the quotation and author.
3. Choose or enter a source.
4. Select existing topics or enter new comma-separated topics.
5. Optionally pin, archive, or add personal notes.
6. Save.

Quote text and author are required for normal entry. A normalized text-and-author collision opens the existing record. Text-only collisions appear under duplicate review.

### Browse the dashboard

- **Overview** shows metrics, Quote of the Day, incomplete records, pinned quotes, and recent additions.
- **View All** shows the complete active library; archived records remain in the separate Archive tab.
- **Topics** groups quotes by managed topics.
- **Authors** and **Sources** derive reports directly from quote metadata.
- **Archive** shows archived records with Restore actions.

Every quote card supports Edit, Copy, Pin or Unpin, Archive or Restore, and Open note. The dashboard has no permanent-delete action. When duplicates are merged, the secondary note is retained and moved into the configured duplicate archive subfolder. Records in that duplicate archive folder are excluded from dashboard totals, search, Quote of the Day, topics, authors, sources, managed summaries, and duplicate detection. The Archive tab continues to show ordinary library records whose archive flag is enabled.

The dashboard header keeps Add quote visible and places maintenance controls in an expandable **Settings** panel. That panel provides an Issue list with per-quote reasons, topic management, duplicate review, canonical upgrade, migration tools, summary rebuilding, index access, and a shortcut to Quote Library's Obsidian settings. On wider desktop panes, the Overview places pinned quotes in the left column and recently added quotes in the right column. Pinned quotes remain visible there even when archived, while Recently added contains active quotes only. Those sections stack on mobile and narrow panes. Quote cards display the creation date without the stored time component.

**Data quality** is a preview-first tool available from the dashboard Settings panel or command palette. It reports incomplete records, legacy notes, ambiguous author/source variants, duplicate text groups, invalid or repeated IDs, and paths outside the configured quote folder. Author/source normalization is a separate confirmed action; it does not guess at attribution.

## Markdown Schema

```yaml
type: quote-library-quote
id: QTE-A7F2
quote_text: "The quotation"
quote_author: Author Name
quote_source: Source
topics:
  - Topic
quote_pin: false
quote_archive: false
tags:
  - quote
aliases:
  - "Short description — Author Name"
created: YYYY-MM-DDTHH:mm
updated: YYYY-MM-DDTHH:mm
```

Quote IDs use `QTE-XXXX`, where `XXXX` is a four-character base-36 hash. The plugin checks proposed IDs against the library and deterministically retries on collision. New filenames use `QTE-XXXX - Short quote excerpt.md`; the short ID remains the permanent identity if descriptive metadata later changes.

The rendered and copied quote contains only the quote text and author. `quote_source` remains searchable metadata and powers the Sources report, but is not appended to the quotation. The rendered quote is bounded by managed markers. Personal writing belongs under **Personal notes** and remains outside managed content.

## Import and Migration

### Upgrade Legacy quotes in the current library

Use **Upgrade Legacy quotes** on the dashboard, **Upgrade quotes to canonical format** in the command palette, or **Open canonical upgrade** in settings. The preview lists only notes currently marked Legacy; canonical notes are not rewritten.

The dedicated upgrade tool provides three portable options:

- **Include archived duplicates:** include Legacy notes beneath the configured duplicate archive folder.
- **Remove known legacy display:** remove only the recognized inline-Dataview display and body `#quote` marker after backup. Other body content is preserved.
- **Modernize filenames:** optionally rename upgraded notes to `QTE-XXXX - Short excerpt.md`. This is disabled by default.

Before changing a note, the plugin creates and hash-verifies a byte-for-byte backup beneath the configured backup folder. The run is journaled in Migration history and can be verified or restored there. Upgrading supplies the canonical `type`, a collision-checked short ID, normalized fields, managed display markers, and a Personal notes section. It does not infer missing authors, sources, or topics.

Migration is optional and never runs automatically. Open **Migration tools** from the dashboard or command palette.

### Choose a mode

- **Copy** is the default. Source notes remain unchanged and canonical Quote Library notes are created in the configured Quotes folder. This is best for importing another collection or testing a mapping.
- **In-place** updates candidate notes where they are. Every candidate is backed up and hash-verified first. If the source is an external folder, that folder becomes the active flat library after migration.

Copy mode requires different source and target folders. Backup storage must be outside both source and target trees.

### Map another quote format

Migration profiles map source frontmatter to Quote Library's fixed public schema. The built-in profiles cover legacy `quote_*` fields and several common property names. A custom profile can configure, in priority order:

- Quote text, author, source, topics, pinned, archived, created, updated, aliases, and tags
- Required source tags or type values
- No body extraction, the first Markdown blockquote, or a blockquote under a named heading
- Optional dash-separated attribution extraction from the body

Use **Migration profiles** in settings to duplicate a built-in profile, edit it, or paste a JSON profile exported from another vault. Built-in profiles are read-only. The canonical output fields are not customizable, which keeps dashboards and future upgrades portable.

Missing or ambiguous authors are not guessed. Those candidates enter the preview's manual-review queue and must be corrected in the source or excluded before migration. Unmatched notes are reported but not changed.

### Safe workflow

1. Configure source folder, recursion, mode, and profile.
2. Run **Preview migration**. Preview is non-mutating and lists every candidate, exclusion, unreadable file, and manual-review item.
3. Resolve or explicitly exclude every manual-review item.
4. Run **Run migration**. The plugin requires the source to still match the saved preview, creates byte-for-byte backups, verifies hashes, and journals each result.
5. Run **Verify** for that migration history entry.
6. Optionally run **Modernize filenames** after verification unlocks it.

Migration history retains recent run summaries. Each journaled run can be verified or restored independently. In copy mode, rollback removes only generated notes that still match their journaled hash; edited copies are left in place for manual review. In-place restoration verifies backups before restoring them. Filename modernization and duplicate merging create separate rollback points.

Migration preserves pinned and archived as independent fields, does not infer topics, does not automatically merge duplicates, and skips unchanged canonical output where possible.

## Settings Reference

- **Library root:** parent folder for a clean structured library
- **Quotes folder:** quote-note location relative to the root; blank means the root itself
- **Topics folder:** managed topic-note location relative to the root
- **Duplicate archive subfolder:** location beneath Quotes for merged secondary records
- **Index file:** managed Markdown filename stored at the library root
- **Backup folder:** vault-relative migration backup location
- **Prefer pinned Quote of the Day:** uses active pinned quotes when available
- **Power-user naming:** quote/topic prefixes, filename template, excerpt length, and collision policy for future records
- **Power-user taxonomy:** conservative author/source normalization and archived-topic entry behavior
- **Power-user defaults:** initial pin/archive state, recent-card count, archived pinned visibility, and Quote of the Day preference
- **Power-user dashboard:** startup preference, compact density, card columns, and automatic refresh policy
- **Power-user automation:** refresh-on-change, debounce, and background-notice preferences
- **Power-user privacy:** ordinary Markdown reminder visibility
- **Migration source:** vault-relative folder to scan
- **Include subfolders:** controls recursive discovery
- **Migration mode:** Copy or In-place
- **Migration profile:** built-in or custom mapping
- **Migration profiles:** create, edit, import, export, and delete custom mappings

## Mobile Support

Quote Library uses Obsidian's vault, file-manager, settings, modal, and clipboard-compatible browser APIs. It does not use Node.js, Electron, shell commands, external networking, or absolute filesystem paths. Dashboard actions wrap on narrow screens, and migration tools use the same mobile-compatible dialogs as quote entry.

### Dashboard widget integration

When Red-Beard Dashboard is installed, Quote Library registers optional widgets for Quote of the Day, pinned quotes, and recent quotes. The integration is capability-based: removing Red-Beard Dashboard does not affect Quote Library, its notes, or its own dashboard. The shared Foundation adapters are vendored at a pinned revision so clean public checkouts do not depend on a machine-specific package path.

Large migrations are safer to preview and run while the device is awake and Obsidian remains in the foreground. Allow cloud sync to finish before opening the same vault on another device.

## Limitations

- Topic assignment and author verification are manual; the plugin does not infer meaning or confirm attribution.
- Authors and sources are metadata facets rather than separate note collections.
- Body extraction is deliberately conservative and supports blockquotes, not arbitrary prose or every callout format.
- A migration profile maps one source convention at a time; heterogeneous collections may need multiple runs.
- The plugin does not provide OCR, browser capture, analytics, encryption, cloud sync, or permanent deletion.
- Backups live inside the vault so rollback remains mobile-compatible; the configured backup folder should be included in the user's normal vault backup policy.
- Native filesystem links outside Obsidian cannot be updated during filename modernization.

## Validation

```bash
npm ci
npm run typecheck
npm run build
npm test
node scripts/detect-desktop-dependencies.mjs
node scripts/validate-version.mjs 1.3.0
```

## License

Quote Library is released under the MIT License.
