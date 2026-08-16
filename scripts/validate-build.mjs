/* Validates compiled release identity, mobile styling, workflows, and required migration features. */
import { readFile, stat } from "node:fs/promises";
const manifest = JSON.parse(await readFile("manifest.json", "utf8")); const pkg = JSON.parse(await readFile("package.json", "utf8")); const versions = JSON.parse(await readFile("versions.json", "utf8")); const main = await readFile("main.js", "utf8"); const css = await readFile("styles.css", "utf8"); const failures = [];
if (manifest.id !== "quote-library" || manifest.name !== "Quote Library") failures.push("Unexpected plugin identity.");
if (manifest.version !== "1.2.1" || pkg.version !== manifest.version || versions[manifest.version] !== manifest.minAppVersion) failures.push("Release versions are inconsistent.");
if (manifest.isDesktopOnly !== false) failures.push("Plugin is not mobile compatible."); if ((await stat("main.js")).size < 30000) failures.push("main.js appears unexpectedly small.");
for (const marker of ["quote-library-dashboard", "add-quote", "Preview migration", "Modernize filenames", "Migration profiles", "copy", "quote-library:quote:start", "Quote of the day", "Review duplicates"]) if (!main.includes(marker)) failures.push(`main.js is missing ${marker}.`);
for (const marker of [".quote-library-dashboard", ".quote-library-tabs", ".quote-library-topic-selector", "100dvh", "safe-area-inset-bottom", "@media (max-width: 520px)"]) if (!css.includes(marker)) failures.push(`styles.css is missing ${marker}.`);
if (/require\(["'](?:fs|path|electron|os|child_process)["']\)/.test(main)) failures.push("main.js contains a desktop-only runtime import.");
if (failures.length) throw new Error(failures.join("\n")); console.log("Validated Quote Library release files.");
