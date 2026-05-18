import type { ScanResult } from "../analyzers/types";

export const DMARC_MX_REPORT_BASE = "https://dmarc.mx";

/**
 * Canonical dmarc.mx report URL for a domain. dmarcheck serves the report at
 * `/check?domain=<domain>` (see dmarcheck src/index.ts sitemap + views/html.ts);
 * a bare `/<domain>` path 404s. Always go through this helper so the path and
 * encoding stay consistent across popup, context menu, and omnibox.
 */
export function reportUrl(domain: string): string {
  return `${DMARC_MX_REPORT_BASE}/check?domain=${encodeURIComponent(domain)}`;
}

export interface ScanRequest {
  type: "scan";
  domain: string;
}

export interface ScanResponseOk {
  ok: true;
  result: ScanResult;
  cached: boolean;
}

export interface ScanResponseErr {
  ok: false;
  error: string;
}

export type ScanResponse = ScanResponseOk | ScanResponseErr;

export interface HistoryEntry {
  domain: string;
  grade: string;
  timestamp: string;
}

/** Badge background color for a grade. Mirrors the dmarc.mx grade palette. */
export function gradeColor(grade: string): string {
  const g = grade.toUpperCase();
  if (g === "S") return "#7c3aed"; // dmarc.mx easter-egg purple
  if (g.startsWith("A")) return "#16a34a"; // green
  if (g === "B") return "#65a30d"; // lime
  if (g === "C") return "#ca8a04"; // amber
  if (g === "D") return "#ea580c"; // orange
  return "#dc2626"; // E / F / unknown — red
}
