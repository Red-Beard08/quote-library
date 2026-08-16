/* Renders the responsive Quote Library overview and topic, author, source, and archive reports. */

import { ItemView, Notice, WorkspaceLeaf } from "obsidian";
import type QuoteLibraryPlugin from "./main";
import type { QuoteRecord, TopicRecord } from "./types";
import { dailyIndex, dateKey, quoteAttentionReasons, quoteClipboardText, topicKey } from "./utils";

export const DASHBOARD_VIEW = "quote-library-dashboard";
type Tab = "overview" | "topics" | "authors" | "sources" | "archive";
type Report = { kind: "topic" | "author" | "source"; value: string };

export class QuoteLibraryDashboard extends ItemView {
  private tab: Tab = "overview"; private report: Report | null = null; private query = ""; private dailyOffset = 0;
  constructor(leaf: WorkspaceLeaf, private plugin: QuoteLibraryPlugin) { super(leaf); }
  getViewType(): string { return DASHBOARD_VIEW; } getDisplayText(): string { return "Quote Library"; } getIcon(): string { return "quote"; }
  async onOpen(): Promise<void> { await this.render(); }

  async render(): Promise<void> {
    const root = this.containerEl.children[1] as HTMLElement; root.empty(); root.addClass("quote-library-dashboard"); const data = await this.plugin.repository.dashboard();
    this.plugin.updateCaches(data);
    const hero = root.createDiv({ cls: "quote-library-hero" }); hero.createEl("div", { text: "MARKDOWN-FIRST QUOTATION LIBRARY", cls: "quote-library-eyebrow" }); hero.createEl("h1", { text: "Quote Library" }); hero.createEl("p", { text: "Capture, organize, revisit, and preserve quotations from one mobile-friendly dashboard." });
    const actions = hero.createDiv({ cls: "quote-library-actions" }); this.button(actions, "Add quote", () => this.plugin.openQuoteModal(), true); this.button(actions, "Manage topics", () => this.plugin.openTopicManager()); this.button(actions, "Migration tools", () => this.plugin.openMigrationTools()); this.button(actions, "Open index", () => void this.plugin.openFile(this.plugin.repository.indexPath));
    this.tabs(root);
    if (this.report) { this.renderReport(root, this.report, data.quotes, data.topics); return; }
    this.search(root, data.quotes);
    if (this.tab === "overview") this.overview(root, data.quotes, data.duplicates.length, data.unreadablePaths);
    else if (this.tab === "topics") this.facets(root, "topic", data.quotes, data.topics.filter(t => t.status === "active").map(t => t.name));
    else if (this.tab === "authors") this.facets(root, "author", data.quotes, unique(data.quotes.map(q => q.author).filter(Boolean)));
    else if (this.tab === "sources") this.facets(root, "source", data.quotes, unique(data.quotes.map(q => q.source).filter(Boolean)));
    else this.quoteList(root, data.quotes.filter(q => q.archived), "Archived quotes");
  }

  private tabs(root: HTMLElement): void { const tabs = root.createDiv({ cls: "quote-library-tabs", attr: { role: "tablist" } }); for (const [tab, label] of [["overview", "Overview"], ["topics", "Topics"], ["authors", "Authors"], ["sources", "Sources"], ["archive", "Archive"]] as [Tab, string][]) { const button = tabs.createEl("button", { text: label, cls: this.tab === tab ? "is-active" : "", attr: { role: "tab", "aria-selected": String(this.tab === tab) } }); button.onclick = () => { this.tab = tab; this.report = null; void this.render(); }; } }
  private search(root: HTMLElement, quotes: QuoteRecord[]): void { const input = root.createEl("input", { cls: "quote-library-search", attr: { type: "search", placeholder: "Search text, author, source, topics, or notes", "aria-label": "Search Quote Library" } }); input.value = this.query; const slot = root.createDiv({ cls: "quote-library-search-results" }); input.oninput = () => { this.query = input.value; this.searchResults(slot, quotes); }; if (this.query) this.searchResults(slot, quotes); }
  private searchResults(slot: HTMLElement, quotes: QuoteRecord[]): void { slot.empty(); const query = this.query.trim().toLocaleLowerCase(); if (!query) return; const matches = quotes.filter(q => `${q.text} ${q.author} ${q.source} ${q.topics.join(" ")} ${q.notes}`.toLocaleLowerCase().includes(query)); this.quoteList(slot, matches, `Search results (${matches.length})`); }

  private overview(root: HTMLElement, quotes: QuoteRecord[], duplicateCount: number, unreadablePaths: string[]): void {
    const active = quotes.filter(q => !q.archived); const metrics = root.createDiv({ cls: "quote-library-metrics" }); this.metric(metrics, String(quotes.length), "Total"); this.metric(metrics, String(active.length), "Active"); this.metric(metrics, String(quotes.filter(q => q.pinned).length), "Pinned"); this.metric(metrics, String(quotes.filter(q => q.archived).length), "Archived"); this.metric(metrics, String(quotes.filter(incomplete).length), "Needs attention");
    const dailyPool = this.plugin.settings.preferPinnedForDaily && active.some(q => q.pinned) ? active.filter(q => q.pinned) : active; const index = dailyIndex(dailyPool.map(q => q.id || q.path), dateKey(), this.dailyOffset); root.createEl("h2", { text: "Quote of the day" }); if (index >= 0) { const card = root.createDiv({ cls: "quote-library-daily" }); this.card(card, dailyPool[index]); const actions = card.createDiv({ cls: "quote-library-actions" }); this.button(actions, "Show another", () => { this.dailyOffset++; void this.render(); }); } else root.createDiv({ cls: "quote-library-empty", text: "Add an active quote to begin." });
    if (duplicateCount) { const alert = root.createDiv({ cls: "quote-library-alert" }); alert.createEl("strong", { text: `${duplicateCount} duplicate group${duplicateCount === 1 ? "" : "s"} need review.` }); this.button(alert, "Review duplicates", () => void this.plugin.openDuplicateReview()); }
    if (unreadablePaths.length) { const alert = root.createDiv({ cls: "quote-library-alert" }); alert.createEl("strong", { text: `${unreadablePaths.length} quote note${unreadablePaths.length === 1 ? " is" : "s are"} unavailable on this device.` }); alert.createEl("span", { text: "Make cloud-synced files available offline before running migration.", cls: "quote-library-muted" }); }
    const incompleteQuotes = quotes.filter(incomplete); if (incompleteQuotes.length) this.quoteList(root, incompleteQuotes.slice(0, 8), "Needs attention", true);
    this.quoteList(root, quotes.filter(q => q.pinned).slice(0, 8), "Pinned quotes"); this.quoteList(root, [...quotes].sort((a, b) => b.created.localeCompare(a.created)).slice(0, 8), "Recently added");
  }

  private facets(root: HTMLElement, kind: Report["kind"], quotes: QuoteRecord[], values: string[]): void {
    root.createEl("h2", { text: kind === "topic" ? "Topics" : kind === "author" ? "Authors" : "Sources" }); const list = root.createDiv({ cls: "quote-library-facet-list" }); if (!values.length) list.createDiv({ cls: "quote-library-empty", text: `No ${kind}s yet.` });
    for (const value of values.sort((a, b) => a.localeCompare(b))) { const matching = filter(quotes, { kind, value }); const row = list.createDiv({ cls: "quote-library-facet-row" }); const identity = row.createDiv(); identity.createEl("strong", { text: value }); identity.createEl("span", { text: `${matching.length} quote${matching.length === 1 ? "" : "s"}`, cls: "quote-library-muted" }); const actions = row.createDiv({ cls: "quote-library-actions" }); this.button(actions, "View report", () => { this.report = { kind, value }; void this.render(); }, true); }
  }
  private renderReport(root: HTMLElement, report: Report, quotes: QuoteRecord[], topics: TopicRecord[]): void { const matching = filter(quotes, report); const heading = root.createDiv({ cls: "quote-library-report-heading" }); const title = heading.createDiv(); title.createEl("div", { text: `${report.kind.toLocaleUpperCase()} REPORT`, cls: "quote-library-eyebrow" }); title.createEl("h2", { text: report.value }); const topicCount = new Set(matching.flatMap(q => q.topics.map(topicKey))).size; const sourceCount = new Set(matching.map(q => q.source).filter(Boolean)).size; title.createEl("p", { text: `${matching.length} quotes · ${topicCount} topics · ${sourceCount} sources` }); const actions = heading.createDiv({ cls: "quote-library-actions" }); this.button(actions, `All ${report.kind}s`, () => { this.report = null; void this.render(); }, true); if (report.kind === "topic") { const topic = topics.find(t => topicKey(t.name) === topicKey(report.value)); if (topic) this.button(actions, "Open topic note", () => void this.plugin.openFile(topic.path)); } this.quoteList(root, matching, "Quotes"); }

  private quoteList(parent: HTMLElement, quotes: QuoteRecord[], title: string, showAttentionReasons = false): void { parent.createEl("h2", { text: title }); const list = parent.createDiv({ cls: "quote-library-quote-list" }); if (!quotes.length) list.createDiv({ cls: "quote-library-empty", text: "No quotes in this section." }); for (const quote of quotes) { const card = list.createDiv({ cls: "quote-library-card" }); this.card(card, quote, showAttentionReasons); } }
  private card(card: HTMLElement, quote: QuoteRecord, showAttentionReasons = false): void { card.createEl("blockquote", { text: quote.text }); const byline = card.createDiv({ cls: "quote-library-byline" }); byline.createEl("strong", { text: `— ${quote.author}` }); if (showAttentionReasons) { const reasons = quoteAttentionReasons(quote); if (reasons.length) { const warning = card.createDiv({ cls: "quote-library-attention-reasons" }); warning.createEl("strong", { text: "Needs attention:" }); const list = warning.createEl("ul"); for (const reason of reasons) list.createEl("li", { text: reason }); } } if (quote.topics.length) card.createEl("div", { text: quote.topics.join(" · "), cls: "quote-library-topics" }); const meta = card.createDiv({ cls: "quote-library-meta" }); meta.createSpan({ text: quote.archived ? "Archived" : "Active" }); if (quote.pinned) meta.createSpan({ text: "Pinned" }); if (quote.legacy) meta.createSpan({ text: "Legacy" }); meta.createSpan({ text: quote.created || "Unknown date" }); const actions = card.createDiv({ cls: "quote-library-actions" }); this.button(actions, "Edit", () => this.plugin.openQuoteEditor(quote), true); this.button(actions, "Copy", () => void copyQuote(quote)); this.button(actions, quote.pinned ? "Unpin" : "Pin", () => void this.plugin.setPinned(quote, !quote.pinned)); this.button(actions, quote.archived ? "Restore" : "Archive", () => void this.plugin.setArchived(quote, !quote.archived)); this.button(actions, "Open note", () => void this.plugin.openFile(quote.path)); }
  private button(parent: HTMLElement, label: string, action: () => void, cta = false): void { const button = parent.createEl("button", { text: label, cls: cta ? "mod-cta" : "" }); button.onclick = action; }
  private metric(parent: HTMLElement, value: string, label: string): void { const metric = parent.createDiv({ cls: "quote-library-metric" }); metric.createEl("strong", { text: value }); metric.createEl("span", { text: label }); }
}

function filter(quotes: QuoteRecord[], report: Report): QuoteRecord[] { return quotes.filter(q => report.kind === "topic" ? q.topics.some(t => topicKey(t) === topicKey(report.value)) : report.kind === "author" ? q.author === report.value : q.source === report.value); }
function unique(values: string[]): string[] { return [...new Set(values)]; }
function incomplete(quote: QuoteRecord): boolean { return quoteAttentionReasons(quote).length > 0; }
async function copyQuote(quote: QuoteRecord): Promise<void> { try { await navigator.clipboard.writeText(quoteClipboardText(quote.text, quote.author)); new Notice("Quote copied."); } catch { new Notice("The quote could not be copied on this device."); } }
