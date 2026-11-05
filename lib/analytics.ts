export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (command: "event", eventName: string, properties?: AnalyticsProperties) => void;
  }
}

export function track(event: string, properties: AnalyticsProperties = {}) {
  if (typeof window === "undefined") return;
  const payload = Object.fromEntries(Object.entries(properties).filter(([, value]) => value !== undefined));
  window.dataLayer = window.dataLayer ?? [];
  // Match Google's official gtag queue shape: it stores the function's Arguments object.
  // eslint-disable-next-line prefer-rest-params
  window.gtag = window.gtag ?? function gtag() { window.dataLayer?.push(arguments); };
  window.gtag("event", event, payload);
  window.dispatchEvent(new CustomEvent("fire-planner:analytics", { detail: { event, properties: payload } }));
}
