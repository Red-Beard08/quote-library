/* Ensures requested, manifest, package, and compatibility-map versions agree. */
import fs from "node:fs"; const expected = process.argv[2]; const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8")); const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")); const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
if (!expected || manifest.version !== expected || pkg.version !== expected || versions[expected] !== manifest.minAppVersion) throw new Error("Release version metadata is inconsistent."); console.log(`Validated release version ${expected}.`);
