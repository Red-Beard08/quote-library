/* Pinned Red-Beard Foundation 0.2.0 adapters vendored for clean standalone builds. */

import type { Modal, TFile, Vault } from "obsidian";

export function normalizeVaultPath(value: string): string {
  const trimmed = value.trim(); if (/^[/\\]{2}/.test(trimmed)) return "";
  const raw = trimmed.replace(/[\\]+/g, "/").replace(/^\/+/, ""); if (!raw || /^[A-Za-z]:\//.test(raw)) return "";
  const segments = raw.split("/").filter(segment => segment && segment !== "."); if (segments.some(segment => segment === "..")) return ""; return segments.join("/");
}

export function replaceManagedBlockIfChanged(text: string, markers: { start: string; end: string }, body: string): { text: string; changed: boolean } {
  const replacement = `${markers.start}\n${body.trimEnd()}\n${markers.end}`; const start = text.indexOf(markers.start);
  let next: string; if (start >= 0) { const bodyStart = start + markers.start.length; const end = text.indexOf(markers.end, bodyStart); next = end >= 0 ? `${text.slice(0, start)}${replacement}${text.slice(end + markers.end.length)}` : `${text.trimEnd()}\n\n${replacement}\n`; } else next = text.trimEnd() ? `${text.trimEnd()}\n\n${replacement}\n` : `${replacement}\n`;
  return { text: next, changed: next !== text };
}

export async function hashText(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text); const digest = await crypto.subtle.digest("SHA-256", bytes); return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function writeTextIfChanged(vault: Vault, file: TFile, next: string): Promise<boolean> {
  const current = await vault.cachedRead(file); if (current === next) return false; await vault.process(file, () => next); return true;
}

export function prepareMobileModal(modal: Modal, extraClass?: string): void {
  modal.modalEl.addClass("rb-addon-modal"); if (extraClass) modal.modalEl.addClass(extraClass); modal.contentEl.addClass("rb-addon-modal-content"); modal.contentEl.setAttr("tabindex", "-1");
}
