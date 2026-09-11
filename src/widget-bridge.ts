import type { App, Vault } from "obsidian";

export interface DashboardWidgetContext { app: App; vault: Vault; settings: unknown; refresh: () => Promise<void> | void; openNote: (path: string) => Promise<void> | void; notice: (message: string) => void; }
export interface DashboardWidgetDefinition { id: string; name: string; description?: string; icon?: string; defaultLayout: { w: number; mobileW: number; h: number; order?: number }; mobile?: "stack" | "responsive" | "hidden"; render: (ctx: DashboardWidgetContext, container: HTMLElement) => void | Promise<void>; }

/** Optional Red-Beard Dashboard bridge; Quote Library remains fully functional without the host. */
export function registerDashboardWidget(app: App, definition: DashboardWidgetDefinition): () => void {
  const host = (app as App & { plugins?: { getPlugin?: (id: string) => unknown } }).plugins?.getPlugin?.("red-beard-dashboard") as { registerWidget?: (item: DashboardWidgetDefinition) => (() => void) } | undefined;
  if (!host?.registerWidget) return () => undefined; try { return host.registerWidget(definition) ?? (() => undefined); } catch { return () => undefined; }
}
