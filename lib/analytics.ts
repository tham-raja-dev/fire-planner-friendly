export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: Array<Record<string, unknown>>;
  }
}

export function track(event: string, properties: AnalyticsProperties = {}) {
  if (typeof window === "undefined") return;
  const payload = Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
  window.dataLayer = window.dataLayer ?? [];
  window.dataLayer.push({ event, ...payload });
  window.dispatchEvent(new CustomEvent("fire-planner:analytics", { detail: { event, properties: payload } }));
}
