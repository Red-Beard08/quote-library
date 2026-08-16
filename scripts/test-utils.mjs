/* Exercises Quote Library normalization, legacy parsing, managed blocks, filenames, and daily selection. */
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = path.join(os.tmpdir(), `quote-library-tests-${process.pid}`); fs.mkdirSync(directory, { recursive: true });
await esbuild.build({ entryPoints: ["src/utils.ts"], outdir: directory, bundle: true, format: "esm", platform: "node", entryNames: "[name]", outExtension: { ".js": ".mjs" } });
const utils = await import(`${pathToFileURL(path.join(directory, "utils.mjs")).href}?v=${Date.now()}`);
const fixture = name => fs.readFileSync(path.join("tests", "fixtures", name), "utf8");

if (utils.normalizeName('  " Church" ') !== "Church") throw new Error("Author/source normalization failed.");
if (utils.normalizeQuoteText(" ‘Faith’  — Hope ") !== "'faith' - hope") throw new Error("Quote normalization failed.");
if (utils.duplicateKey("Same quote.", "Author") !== utils.duplicateKey(" Same  quote. ", "author")) throw new Error("Duplicate normalization failed.");
if (utils.safeFilename('A / quote?') !== "A - quote-") throw new Error("Safe filename failed.");
const shortId = utils.deterministicRecordId("QTE", "2026-08-16T13:05:20:quote");
if (!/^QTE-[A-Z0-9]{4}$/.test(shortId) || shortId !== utils.deterministicRecordId("QTE", "2026-08-16T13:05:20:quote")) throw new Error("Short deterministic ID format failed.");
const collisionSafe = utils.availableRecordId("QTE", "2026-08-16T13:05:20:quote", new Set([shortId]));
if (collisionSafe === shortId || !utils.isShortRecordId(collisionSafe) || utils.isShortRecordId("QTE-20260816-130520-A7F2")) throw new Error("Short ID collision handling failed.");
if (utils.dailyIndex(["a", "b", "c"], "2026-08-16") !== utils.dailyIndex(["a", "b", "c"], "2026-08-16")) throw new Error("Daily selection is not deterministic.");
if (utils.dailyIndex(["a", "b", "c"], "2026-08-16", 1) === utils.dailyIndex(["a", "b", "c"], "2026-08-16", 0)) throw new Error("Show-another offset failed.");

const legacy = utils.parseNote(fixture("legacy-uppercase.md"));
if (legacy.frontmatter.quote_text !== "Sin is more contagious than holiness." || legacy.frontmatter.Tags !== "quote" || !utils.knownLegacyBody(legacy.body)) throw new Error("Legacy uppercase-tag fixture failed.");
const block = utils.parseNote(fixture("legacy-block.md"));
if (!String(block.frontmatter.quote_text).includes("A good wife") || block.frontmatter.quote_pin !== true || utils.normalizeName(String(block.frontmatter.quote_source)) !== "Church") throw new Error("Block-scalar fixture failed.");
const cleaned = utils.removeKnownLegacyBody(legacy.body); if (cleaned.includes("#quote") || cleaned.includes("this.quote_text")) throw new Error("Known legacy body cleanup failed.");
const original = "# Quote\n\nUser introduction.\n"; const once = utils.replaceManagedBlock(original, utils.QUOTE_START, utils.QUOTE_END, "> Quote"); const twice = utils.replaceManagedBlock(once, utils.QUOTE_START, utils.QUOTE_END, "> Quote");
if (once !== twice || !twice.includes("User introduction.")) throw new Error("Managed block idempotence or preservation failed.");
if ((await utils.sha256(fixture("legacy-uppercase.md"))).length !== 64) throw new Error("SHA-256 helper failed.");

fs.rmSync(directory, { recursive: true, force: true }); console.log("Validated Quote Library utilities and legacy fixtures.");
