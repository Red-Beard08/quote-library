/* Detects Node/Electron runtime imports that would prevent Obsidian mobile use. */
import fs from "node:fs"; import path from "node:path"; const failures = [];
walk("src"); if (failures.length) throw new Error(failures.join("\n")); console.log("No desktop-only source dependencies found.");
function walk(root) { for (const entry of fs.readdirSync(root, { withFileTypes: true })) { const full = path.join(root, entry.name); if (entry.isDirectory()) walk(full); else if (/\.ts$/.test(full)) { const content = fs.readFileSync(full, "utf8"); if (/from ["'](?:fs|path|electron|os|child_process)["']|require\(["'](?:fs|path|electron|os|child_process)["']\)/.test(content)) failures.push(`${full} contains a desktop-only import.`); } } }
