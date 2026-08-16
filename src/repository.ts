/* Stores canonical and legacy quote records as ordinary Markdown beneath a configurable root. */

import { App, normalizePath, TFile } from "obsidian";
import type { DashboardData, DuplicateGroup, QuoteInput, QuoteLibrarySettings, QuoteRecord, TopicRecord, TopicStatus } from "./types";
import { bool, bodySection, duplicateKey, INDEX_END, INDEX_START, isoMinute, knownLegacyBody, normalizeName, parseNote, QUOTE_END, QUOTE_START, removeKnownLegacyBody, replaceManagedBlock, safeFilename, scalar, shortExcerpt, stableNames, strings, textDuplicateKey, timestampId, TOPIC_END, TOPIC_START, topicKey, yamlList, yamlString } from "./utils";

export class QuoteRepository {
  private unreadablePaths: string[] = [];
  constructor(private app: App, private settings: QuoteLibrarySettings) {}
  updateSettings(settings: QuoteLibrarySettings): void { this.settings = settings; }
  get root(): string { return normalizePath(cleanRoot(this.settings.rootFolder)); }
  get topicsFolder(): string { return normalizePath(`${this.root}/Topics`); }
  get indexPath(): string { return normalizePath(`${this.root}/Quote Library Index.md`); }

  async initialize(): Promise<void> {
    await this.ensureFolder(this.root); await this.ensureFolder(this.topicsFolder);
    if (!this.file(this.indexPath)) await this.app.vault.create(this.indexPath, this.renderIndex([], []));
  }

  async dashboard(): Promise<DashboardData> {
    await this.initialize();
    const [quotes, topics] = await Promise.all([this.getQuotes(), this.getTopics()]);
    return { quotes, topics, duplicates: this.duplicateGroups(quotes), unreadablePaths: this.getUnreadablePaths() };
  }

  async getQuotes(): Promise<QuoteRecord[]> {
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${this.root}/`) && !file.path.startsWith(`${this.topicsFolder}/`) && file.path !== this.indexPath);
    this.unreadablePaths = [];
    const records = await Promise.all(files.map(async file => { try { return await this.readQuote(file); } catch (error) { console.warn(`Quote Library could not read ${file.path}.`, error); this.unreadablePaths.push(file.path); return null; } }));
    return records.filter((record): record is QuoteRecord => Boolean(record)).sort((a, b) => b.created.localeCompare(a.created) || a.path.localeCompare(b.path));
  }
  getUnreadablePaths(): string[] { return [...this.unreadablePaths].sort(); }

  async getTopics(): Promise<TopicRecord[]> {
    const files = this.app.vault.getMarkdownFiles().filter(file => file.path.startsWith(`${this.topicsFolder}/`));
    const records = await Promise.all(files.map(file => this.readTopic(file)));
    return records.filter((record): record is TopicRecord => Boolean(record)).sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveQuote(input: QuoteInput): Promise<{ quote: QuoteRecord; created: boolean }> {
    await this.initialize(); const normalized = normalizeInput(input);
    if (!normalized.text || !normalized.author) throw new Error("Quote text and author are required.");
    const exact = (await this.getQuotes()).find(quote => duplicateKey(quote.text, quote.author) === duplicateKey(normalized.text, normalized.author));
    if (exact) return { quote: exact, created: false };
    for (const topic of normalized.topics) await this.ensureTopic(topic);
    const id = timestampId(); const now = isoMinute();
    const path = await this.availablePath(`${id} - ${shortExcerpt(normalized.text)}`);
    const quote: QuoteRecord = { ...normalized, id, path, aliases: [aliasFor(normalized)], created: now, updated: now, legacy: false, duplicateOf: "", duplicateKept: false };
    await this.app.vault.create(path, this.renderQuote(quote)); await this.rebuildSummaries();
    return { quote: (await this.quoteByPath(path))!, created: true };
  }

  async editQuote(path: string, input: QuoteInput): Promise<QuoteRecord> {
    const current = await this.quoteByPath(path); if (!current) throw new Error("The quote note could not be found.");
    const normalized = normalizeInput(input); if (!normalized.text || !normalized.author) throw new Error("Quote text and author are required.");
    const collision = (await this.getQuotes()).find(quote => quote.path !== path && duplicateKey(quote.text, quote.author) === duplicateKey(normalized.text, normalized.author));
    if (collision) throw new Error("That quote and author already exist. Open the existing quote instead.");
    for (const topic of normalized.topics) await this.ensureTopic(topic);
    const next: QuoteRecord = { ...current, ...normalized, aliases: [aliasFor(normalized)], updated: isoMinute() };
    await this.writeQuote(next); await this.rebuildSummaries(); return (await this.quoteByPath(path)) ?? next;
  }

  async setPinned(quote: QuoteRecord, pinned: boolean): Promise<void> { await this.editState(quote, { pinned }); }
  async setArchived(quote: QuoteRecord, archived: boolean): Promise<void> { await this.editState(quote, { archived }); }

  async createTopic(name: string): Promise<TopicRecord> {
    const normalized = normalizeName(name); if (!normalized) throw new Error("Topic name is required.");
    const existing = (await this.getTopics()).find(topic => topicKey(topic.name) === topicKey(normalized));
    if (existing) throw new Error(`The topic “${existing.name}” already exists.`);
    return this.ensureTopic(normalized);
  }

  async renameTopic(topic: TopicRecord, name: string): Promise<void> {
    const normalized = normalizeName(name); if (!normalized) throw new Error("Topic name is required.");
    const collision = (await this.getTopics()).find(item => item.id !== topic.id && topicKey(item.name) === topicKey(normalized));
    if (collision) throw new Error(`The topic “${collision.name}” already exists.`);
    const file = this.file(topic.path); if (!file) throw new Error("The topic note could not be found.");
    const destination = normalizePath(`${this.topicsFolder}/${safeFilename(normalized)}.md`);
    if (destination !== file.path && this.app.vault.getAbstractFileByPath(destination)) throw new Error("A file already uses that topic name.");
    if (destination !== file.path) await this.app.fileManager.renameFile(file, destination);
    const renamed = this.file(destination); if (!renamed) throw new Error("The renamed topic note could not be found.");
    await this.app.fileManager.processFrontMatter(renamed, fm => { fm.name = normalized; fm.aliases = stableNames([...strings(fm.aliases), topic.name]); fm.updated = isoMinute(); });
    for (const quote of await this.getQuotes()) {
      if (!quote.topics.some(value => topicKey(value) === topicKey(topic.name))) continue;
      quote.topics = stableNames(quote.topics.map(value => topicKey(value) === topicKey(topic.name) ? normalized : value)); await this.writeQuote(quote);
    }
    await this.rebuildSummaries();
  }

  async setTopicStatus(topic: TopicRecord, status: TopicStatus): Promise<void> {
    const file = this.file(topic.path); if (!file) throw new Error("The topic note could not be found.");
    await this.app.fileManager.processFrontMatter(file, fm => { fm.status = status; fm.updated = isoMinute(); }); await this.rebuildSummaries();
  }

  duplicateGroups(quotes: QuoteRecord[]): DuplicateGroup[] {
    const groups = new Map<string, QuoteRecord[]>();
    for (const quote of quotes.filter(item => !item.duplicateOf && !item.duplicateKept)) {
      const key = textDuplicateKey(quote.text); const group = groups.get(key) ?? []; group.push(quote); groups.set(key, group);
    }
    return [...groups.entries()].filter(([, items]) => items.length > 1).map(([key, items]) => ({ key, quotes: items.sort((a, b) => a.created.localeCompare(b.created)) }));
  }

  async mergeDuplicates(primary: QuoteRecord, secondary: QuoteRecord): Promise<void> {
    primary.topics = stableNames([...primary.topics, ...secondary.topics]); primary.notes = [primary.notes, secondary.notes].filter(Boolean).join("\n\n");
    primary.source = primary.source || secondary.source; primary.created = [primary.created, secondary.created].filter(Boolean).sort()[0] ?? primary.created; await this.writeQuote(primary);
    const secondaryFile = this.file(secondary.path); if (!secondaryFile) throw new Error("The duplicate note could not be found.");
    await this.app.fileManager.processFrontMatter(secondaryFile, fm => { fm.quote_archive = true; fm.quote_duplicate_of = `[[${primary.path.slice(0, -3)}]]`; fm.updated = isoMinute(); });
    await this.rebuildSummaries();
  }

  async keepDuplicates(quotes: QuoteRecord[]): Promise<void> {
    for (const quote of quotes) { const file = this.file(quote.path); if (file) await this.app.fileManager.processFrontMatter(file, fm => { fm.quote_duplicate_keep = true; fm.updated = isoMinute(); }); }
  }

  async rebuildSummaries(): Promise<void> {
    await this.initialize(); const quotes = await this.getQuotes(); const topics = await this.getTopics();
    await this.processIfChanged(this.indexPath, content => replaceManagedBlock(content, INDEX_START, INDEX_END, this.indexBody(quotes, topics)));
    for (const topic of topics) {
      const matching = quotes.filter(quote => quote.topics.some(name => topicKey(name) === topicKey(topic.name)));
      await this.processIfChanged(topic.path, content => replaceManagedBlock(content, TOPIC_START, TOPIC_END, this.topicBody(topic, matching)));
    }
  }

  async writeQuote(record: QuoteRecord): Promise<void> {
    const file = this.file(record.path); if (!file) throw new Error("The quote note could not be found.");
    if (!record.id) record.id = timestampId(); if (!record.aliases.length) record.aliases = [aliasFor(record)]; record.legacy = false;
    await this.app.fileManager.processFrontMatter(file, fm => {
      fm.type = "quote-library-quote"; fm.id = record.id; fm.quote_text = record.text; fm.quote_author = record.author; fm.quote_source = record.source;
      fm.quote_pin = record.pinned; fm.quote_archive = record.archived; fm.topics = record.topics; fm.tags = ["quote"]; fm.aliases = record.aliases;
      fm.created = record.created; fm.updated = record.updated; if (record.duplicateOf) fm.quote_duplicate_of = record.duplicateOf; else delete fm.quote_duplicate_of;
      if (record.duplicateKept) fm.quote_duplicate_keep = true; else delete fm.quote_duplicate_keep;
      delete fm.Tags; delete fm.last_updated;
    });
    await this.app.vault.process(file, content => {
      const parsed = parseNote(content); const managed = this.quoteBody(record); const preserved = knownLegacyBody(parsed.body) ? removeKnownLegacyBody(parsed.body) : parsed.body; let body = replaceManagedBlock(preserved, QUOTE_START, QUOTE_END, managed);
      body = replaceNotes(body, record.notes); return `${content.slice(0, content.length - parsed.body.length)}${body}`;
    });
  }

  async readQuote(file: TFile): Promise<QuoteRecord | null> {
    const parsed = parseNote(await this.app.vault.cachedRead(file)); const fm = parsed.frontmatter;
    const text = scalar(fm.quote_text); if (!text || (scalar(fm.type) && scalar(fm.type) !== "quote-library-quote")) return null;
    const created = scalar(fm.created) || isoMinute(new Date(file.stat.ctime));
    return {
      id: scalar(fm.id), path: file.path, text, author: normalizeName(scalar(fm.quote_author)), source: normalizeName(scalar(fm.quote_source)),
      pinned: bool(fm.quote_pin), archived: bool(fm.quote_archive), topics: stableNames(strings(fm.topics)), aliases: strings(fm.aliases),
      created, updated: scalar(fm.updated) || scalar(fm.last_updated) || isoMinute(new Date(file.stat.mtime)), notes: bodySection(parsed.body, "Personal notes"),
      legacy: scalar(fm.type) !== "quote-library-quote" || !scalar(fm.id), duplicateOf: scalar(fm.quote_duplicate_of), duplicateKept: bool(fm.quote_duplicate_keep)
    };
  }

  private async editState(quote: QuoteRecord, change: Partial<Pick<QuoteRecord, "pinned" | "archived">>): Promise<void> {
    await this.writeQuote({ ...quote, ...change, updated: isoMinute() }); await this.rebuildSummaries();
  }
  private async ensureTopic(name: string): Promise<TopicRecord> {
    await this.initialize(); const normalized = normalizeName(name); const existing = (await this.getTopics()).find(topic => topicKey(topic.name) === topicKey(normalized)); if (existing) return existing;
    const now = isoMinute(); const topic: TopicRecord = { id: timestampId().replace("QTE", "TPC"), name: normalized, status: "active", aliases: [], path: normalizePath(`${this.topicsFolder}/${safeFilename(normalized)}.md`), created: now, updated: now };
    if (this.app.vault.getAbstractFileByPath(topic.path)) topic.path = normalizePath(`${this.topicsFolder}/${safeFilename(normalized)}-${topic.id.slice(-4)}.md`);
    await this.app.vault.create(topic.path, this.renderTopic(topic)); return topic;
  }
  private async readTopic(file: TFile): Promise<TopicRecord | null> {
    const fm = parseNote(await this.app.vault.cachedRead(file)).frontmatter; if (scalar(fm.type) !== "quote-library-topic") return null;
    return { id: scalar(fm.id), name: scalar(fm.name) || file.basename, status: scalar(fm.status) === "archived" ? "archived" : "active", aliases: strings(fm.aliases), path: file.path, created: scalar(fm.created), updated: scalar(fm.updated) };
  }
  private renderQuote(record: QuoteRecord): string {
    return `---\ntype: quote-library-quote\nid: ${yamlString(record.id)}\nquote_text: ${yamlString(record.text)}\nquote_author: ${yamlString(record.author)}\nquote_source: ${yamlString(record.source)}\nquote_pin: ${record.pinned}\nquote_archive: ${record.archived}\ntopics:\n${yamlList(record.topics)}\ntags:\n  - quote\naliases:\n${yamlList(record.aliases)}\ncreated: ${record.created}\nupdated: ${record.updated}\n---\n\n${QUOTE_START}\n${this.quoteBody(record)}\n${QUOTE_END}\n\n## Personal notes\n\n${record.notes}\n`;
  }
  private quoteBody(record: Pick<QuoteRecord, "text" | "author" | "source">): string { return `> ${record.text.replace(/\n/g, "\n> ")}\n>\n> — **${record.author}**${record.source ? `, _${record.source}_` : ""}`; }
  private renderTopic(topic: TopicRecord): string { return `---\ntype: quote-library-topic\nid: ${yamlString(topic.id)}\nname: ${yamlString(topic.name)}\nstatus: ${topic.status}\naliases:\n${yamlList(topic.aliases)}\ncreated: ${topic.created}\nupdated: ${topic.updated}\n---\n\n# ${topic.name}\n\n${TOPIC_START}\n_No quotes are assigned yet._\n${TOPIC_END}\n\n## Topic notes\n\n`; }
  private renderIndex(quotes: QuoteRecord[], topics: TopicRecord[]): string { return `---\ntype: quote-library-index\ncreated: ${isoMinute()}\n---\n\n# Quote Library\n\n${INDEX_START}\n${this.indexBody(quotes, topics)}\n${INDEX_END}\n\n## Library notes\n\n`; }
  private indexBody(quotes: QuoteRecord[], topics: TopicRecord[]): string {
    const lines = ["## Overview", "", `- ${quotes.length} quotes`, `- ${quotes.filter(q => !q.archived).length} active`, `- ${quotes.filter(q => q.pinned).length} pinned`, `- ${quotes.filter(q => q.archived).length} archived`, "", "## Topics", ""];
    lines.push(...(topics.length ? topics.filter(t => t.status === "active").map(topic => `- [[${topic.path.slice(0, -3)}|${topic.name}]] - ${quotes.filter(q => q.topics.some(name => topicKey(name) === topicKey(topic.name))).length}`) : ["_No topics yet._"])); return lines.join("\n");
  }
  private topicBody(topic: TopicRecord, quotes: QuoteRecord[]): string { return ["## Quotes", "", ...(quotes.length ? quotes.map(q => `- [[${q.path.slice(0, -3)}|${shortExcerpt(q.text)}]] — ${q.author}`) : ["_No quotes are assigned to this topic._"]), "", `_${quotes.length} quote${quotes.length === 1 ? "" : "s"} · ${topic.status}_`].join("\n"); }
  private async processIfChanged(path: string, transform: (content: string) => string): Promise<void> { const file = this.file(path); if (!file) return; const current = await this.app.vault.cachedRead(file); const next = transform(current); if (next !== current) await this.app.vault.process(file, transform); }
  private async quoteByPath(path: string): Promise<QuoteRecord | null> { const file = this.file(path); return file ? this.readQuote(file) : null; }
  private file(path: string): TFile | null { const item = this.app.vault.getAbstractFileByPath(normalizePath(path)); return item instanceof TFile ? item : null; }
  private async ensureFolder(path: string): Promise<void> { let current = ""; for (const segment of normalizePath(path).split("/")) { current = normalizePath(current ? `${current}/${segment}` : segment); if (!this.app.vault.getAbstractFileByPath(current)) await this.app.vault.createFolder(current); } }
  private async availablePath(base: string): Promise<string> { let path = normalizePath(`${this.root}/${safeFilename(base)}.md`); let i = 2; while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${this.root}/${safeFilename(base)}-${i++}.md`); return path; }
}

function normalizeInput(input: QuoteInput): QuoteInput { return { ...input, text: input.text.trim(), author: normalizeName(input.author), source: normalizeName(input.source), topics: stableNames(input.topics), notes: input.notes.trim() }; }
function aliasFor(input: Pick<QuoteInput, "text" | "author">): string { return `${shortExcerpt(input.text, 56)} — ${input.author}`; }
function cleanRoot(value: string): string { const root = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""); if (!root || root.split("/").some(part => !part || part === "." || part === "..")) throw new Error("Choose a normal vault-relative library folder."); return root; }
function replaceNotes(body: string, notes: string): string { const heading = "## Personal notes"; const start = body.indexOf(heading); if (start < 0) return `${body.trimEnd()}\n\n${heading}\n\n${notes}\n`; return `${body.slice(0, start)}${heading}\n\n${notes}\n`; }
