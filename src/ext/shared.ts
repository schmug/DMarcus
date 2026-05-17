import type { ScanResult } from "../analyzers/types";

export const DMARC_MX_REPORT_BASE = "https://dmarc.mx";

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
