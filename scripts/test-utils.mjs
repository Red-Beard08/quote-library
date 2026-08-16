/* Exercises Quote Library normalization, legacy parsing, managed blocks, filenames, and daily selection. */
import esbuild from "esbuild";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const directory = path.join(os.tmpdir(), `quote-library-tests-${process.pid}`); fs.mkdirSync(directory, { recursive: true });
await esbuild.build({ entryPoints: ["src/utils.ts", "src/config.ts", "src/profiles.ts"], outdir: directory, bundle: true, format: "esm", platform: "node", entryNames: "[name]", outExtension: { ".js": ".mjs" } });
const utils = await import(`${pathToFileURL(path.join(directory, "utils.mjs")).href}?v=${Date.now()}`);
const config = await import(`${pathToFileURL(path.join(directory, "config.mjs")).href}?v=${Date.now()}`);
const profileTools = await import(`${pathToFileURL(path.join(directory, "profiles.mjs")).href}?v=${Date.now()}`);
const fixture = name => fs.readFileSync(path.join("tests", "fixtures", name), "utf8");

if (utils.normalizeName('  " Example Source" ') !== "Example Source") throw new Error("Author/source normalization failed.");
if (utils.normalizeQuoteText(" ‘Faith’  — Hope ") !== "'faith' - hope") throw new Error("Quote normalization failed.");
if (utils.quoteDisplayBody("A quote.", "Author").includes("Source") || utils.quoteDisplayBody("A quote.", "Author") !== "> A quote.\n>\n> — **Author**") throw new Error("Visible quote rendering failed.");
if (utils.quoteClipboardText("A quote.", "Author") !== "“A quote.” — Author") throw new Error("Copied quote rendering failed.");
if (utils.duplicateKey("Same quote.", "Author") !== utils.duplicateKey(" Same  quote. ", "author")) throw new Error("Duplicate normalization failed.");
if (utils.safeFilename('A / quote?') !== "A - quote-") throw new Error("Safe filename failed.");
const shortId = utils.deterministicRecordId("QTE", "2026-08-16T13:05:20:quote");
if (!/^QTE-[A-Z0-9]{4}$/.test(shortId) || shortId !== utils.deterministicRecordId("QTE", "2026-08-16T13:05:20:quote")) throw new Error("Short deterministic ID format failed.");
const collisionSafe = utils.availableRecordId("QTE", "2026-08-16T13:05:20:quote", new Set([shortId]));
if (collisionSafe === shortId || !utils.isShortRecordId(collisionSafe) || utils.isShortRecordId("QTE-20260816-130520-A7F2")) throw new Error("Short ID collision handling failed.");
if (utils.dailyIndex(["a", "b", "c"], "2026-08-16") !== utils.dailyIndex(["a", "b", "c"], "2026-08-16")) throw new Error("Daily selection is not deterministic.");
if (utils.dailyIndex(["a", "b", "c"], "2026-08-16", 1) === utils.dailyIndex(["a", "b", "c"], "2026-08-16", 0)) throw new Error("Show-another offset failed.");

const legacy = utils.parseNote(fixture("legacy-uppercase.md"));
if (legacy.frontmatter.quote_text !== "A concise quotation used only for testing." || legacy.frontmatter.Tags !== "quote" || !utils.knownLegacyBody(legacy.body)) throw new Error("Legacy uppercase-tag fixture failed.");
const block = utils.parseNote(fixture("legacy-block.md"));
if (!String(block.frontmatter.quote_text).includes("Second line") || block.frontmatter.quote_pin !== true || utils.normalizeName(String(block.frontmatter.quote_source)) !== "Example Source") throw new Error("Block-scalar fixture failed.");
const cleaned = utils.removeKnownLegacyBody(legacy.body); if (cleaned.includes("#quote") || cleaned.includes("this.quote_text")) throw new Error("Known legacy body cleanup failed.");
const original = "# Quote\n\nUser introduction.\n"; const once = utils.replaceManagedBlock(original, utils.QUOTE_START, utils.QUOTE_END, "> Quote"); const twice = utils.replaceManagedBlock(once, utils.QUOTE_START, utils.QUOTE_END, "> Quote");
if (once !== twice || !twice.includes("User introduction.")) throw new Error("Managed block idempotence or preservation failed.");
if ((await utils.sha256(fixture("legacy-uppercase.md"))).length !== 64) throw new Error("SHA-256 helper failed.");

const clean = config.upgradeSettings(null); if (clean.layout.quotesFolder !== "Quotes" || clean.layout.rootFolder !== "Quote Library") throw new Error("Clean-install layout defaults failed.");
if (clean.migrationDefaults.mode !== "copy" || clean.migrationDefaults.sourceFolder !== "Quote Imports" || config.validateMigration(clean.layout, clean.migrationDefaults).length) throw new Error("Clean-install migration defaults failed.");
const upgraded = config.upgradeSettings({ rootFolder: "Existing Quotes", backupFolder: "Existing Backups", migrationPhase: "verified", latestJournalPath: "Existing Backups/run/Migration Journal.json" });
if (upgraded.layout.rootFolder !== "Existing Quotes" || upgraded.layout.quotesFolder !== "" || upgraded.migrationHistory[0]?.status !== "verified") throw new Error("Legacy settings upgrade failed.");
if (!config.validateLayout({ ...clean.layout, backupFolder: "Quote Library/Quotes/Backups" }).length) throw new Error("Overlapping backup validation failed.");
for (const invalid of ["C:\\Users\\Example", "/absolute/path", "Folder/../Other"]) { let rejected = false; try { config.cleanFolder(invalid); } catch { rejected = true; } if (!rejected) throw new Error(`Unsafe path was accepted: ${invalid}`); }

const legacyCandidate = profileTools.extractCandidate(fixture("legacy-uppercase.md"), profileTools.LEGACY_PROFILE, "Legacy/example.md", Date.now(), Date.now());
if (!legacyCandidate || legacyCandidate.record.author !== "Example Author" || !legacyCandidate.bodyConvertible) throw new Error("Legacy profile extraction failed.");
const bodyCandidate = profileTools.extractCandidate(fixture("body-blockquote.md"), profileTools.COMMON_PROFILE, "Imports/body.md", Date.now(), Date.now());
if (!bodyCandidate || bodyCandidate.record.text !== "A body-extracted quotation for testing." || bodyCandidate.record.author !== "Body Author" || bodyCandidate.confidence !== "high") throw new Error("Body extraction failed.");
const manualCandidate = profileTools.extractCandidate("> A quotation without attribution.\n", profileTools.COMMON_PROFILE, "Imports/manual.md", Date.now(), Date.now());
if (!manualCandidate || manualCandidate.confidence !== "manual" || !manualCandidate.issues.includes("missing-author")) throw new Error("Manual-review classification failed.");
const ambiguousCandidate = profileTools.extractCandidate("---\nquote: Conflicting attribution.\nauthor: First Author\nspeaker: Second Author\n---\n", profileTools.COMMON_PROFILE, "Imports/ambiguous.md", Date.now(), Date.now());
if (!ambiguousCandidate || ambiguousCandidate.confidence !== "manual" || !ambiguousCandidate.issues.includes("ambiguous-author")) throw new Error("Ambiguous-author classification failed.");
const headingProfile = profileTools.validateProfile({ ...profileTools.COMMON_PROFILE, id: "heading-example", name: "Heading example", requiredTags: ["quotation"], fields: { ...profileTools.COMMON_PROFILE.fields, text: [], author: [] }, body: { strategy: "heading-blockquote", heading: "Selection", attributionLine: true, cleanupKnownLegacyBody: false } });
const headingCandidate = profileTools.extractCandidate("---\ntags: [quotation]\n---\n\n## Notes\n\n> Ignore this.\n> — Wrong Author\n\n## Selection\n\n> Selected quotation.\n> — Right Author\n", headingProfile, "Imports/heading.md", Date.now(), Date.now());
if (!headingCandidate || headingCandidate.record.text !== "Selected quotation." || headingCandidate.record.author !== "Right Author") throw new Error("Heading-scoped extraction or required-tag matching failed.");
if (profileTools.extractCandidate("---\ntags: [other]\n---\n\n> Excluded quotation.\n> — Author\n", headingProfile, "Imports/excluded.md", Date.now(), Date.now()) !== null) throw new Error("Required-tag filtering failed.");
const exported = { ...profileTools.COMMON_PROFILE, id: "custom-example", name: "Custom example", builtIn: undefined }; if (profileTools.validateProfile(exported).id !== "custom-example") throw new Error("Custom profile validation failed.");
for (const malformed of [null, { ...exported, id: "Invalid ID" }, { ...exported, fields: { ...exported.fields, text: ["bad property"] } }]) { let rejected = false; try { profileTools.validateProfile(malformed); } catch { rejected = true; } if (!rejected) throw new Error("Malformed migration profile was accepted."); }

fs.rmSync(directory, { recursive: true, force: true }); console.log("Validated Quote Library utilities and legacy fixtures.");
