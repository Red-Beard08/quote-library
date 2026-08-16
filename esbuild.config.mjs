/* Builds Quote Library into the mobile-compatible bundle loaded by Obsidian. */
import esbuild from "esbuild";
import process from "process";
import builtins from "builtin-modules";

const production = process.argv[2] === "production";
const context = await esbuild.context({
  banner: { js: "/* Quote Library: Markdown-first quotation management for Obsidian. */" },
  entryPoints: ["src/main.ts"], bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*", ...builtins],
  format: "cjs", target: "es2018", logLevel: "info", sourcemap: production ? false : "inline",
  treeShaking: true, outfile: "main.js"
});
if (production) { await context.rebuild(); await context.dispose(); } else await context.watch();
