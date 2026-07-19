"use client";

import { useEffect } from "react";

export type MarketingEventName =
  | "primary_audit_cta_click"
  | "secondary_how_it_works_click"
  | "audit_form_start"
  | "audit_form_submit"
  | "booking_cta_click"
  | "agency_cta_click"
  | "enterprise_cta_click"
  | "pricing_audience_toggle"
  | "pricing_billing_toggle"
  | "pricing_work_mode_toggle"
  | "business_plan_selection"
  | "agency_plan_selection";

export function trackMarketingEvent(event: MarketingEventName, context?: Record<string, string>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("hdseo:marketing", { detail: { event, context, occurredAt: new Date().toISOString() } }));
}

export default function MarketingAnalytics() {
  useEffect(() => {
    const trackClick = (click: MouseEvent) => {
      const target = click.target instanceof Element ? click.target.closest<HTMLElement>("[data-analytics-event]") : null;
      const event = target?.dataset.analyticsEvent as MarketingEventName | undefined;
      if (target && event) trackMarketingEvent(event, { placement: target.dataset.analyticsPlacement ?? "unknown" });
    };
    document.addEventListener("click", trackClick);
    return () => document.removeEventListener("click", trackClick);
  }, []);
  return null;
}
