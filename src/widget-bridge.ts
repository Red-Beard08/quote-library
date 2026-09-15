import type { App, Vault } from "obsidian";

export interface DashboardWidgetContext { app: App; vault: Vault; settings: unknown; refresh: () => Promise<void> | void; openNote: (path: string) => Promise<void> | void; notice: (message: string) => void; }
export interface DashboardWidgetDefinition { id: string; name: string; description?: string; icon?: string; defaultLayout: { w: number; mobileW: number; h: number; order?: number }; mobile?: "stack" | "responsive" | "hidden"; render: (ctx: DashboardWidgetContext, container: HTMLElement) => void | Promise<void>; }
export interface DashboardModuleDefinition { id: string; name: string; command: string; icon?: string; description?: string; order?: number; }

function registerWithRetry<T>(app: App, method: "registerWidget" | "registerModule", definition: T): () => void {
  let dispose: () => void = () => undefined; let timer: number | undefined; let attempts = 0;
  const attempt = () => { const host = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("red-beard-dashboard") as Record<string, ((value: T) => (() => void)) | undefined> | undefined; const fn = host?.[method]; if (fn) { try { dispose = fn(definition) ?? (() => undefined); } catch { /* host unavailable */ } if (timer !== undefined) window.clearTimeout(timer); return; } if (attempts++ < 20) timer = window.setTimeout(attempt, 250); };
  attempt(); return () => { if (timer !== undefined) window.clearTimeout(timer); dispose(); };
}

/** Optional Red-Beard Dashboard bridge; Quote Library remains fully functional without the host. */
export function registerDashboardWidget(app: App, definition: DashboardWidgetDefinition): () => void {
  return registerWithRetry(app, "registerWidget", definition);
}

export function registerDashboardModule(app: App, definition: DashboardModuleDefinition): () => void {
  return registerWithRetry(app, "registerModule", definition);
}
