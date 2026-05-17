import type { ScanResult } from "../analyzers/types";
import { scan } from "../orchestrator";
import { normalizeDomain } from "../shared/domain";
import {
  DMARC_MX_REPORT_BASE,
  gradeColor,
  type HistoryEntry,
  type ScanRequest,
  type ScanResponse,
} from "./shared";

/**
 * DMarcus background service worker.
 *
 * Hosts the full scan engine (orchestrator + vendored analyzers + DoH client).
 * No DOM, unrestricted `fetch()` for DoH + MTA-STS/security.txt. Survives
 * popup close so scans complete in the background.
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min — matches the dmarc.mx server cache
const HISTORY_MAX = 50;

interface CacheEnvelope {
  result: ScanResult;
  expires: number;
}

// In-flight scans keyed by domain — dedupes the omnibox/popup/badge all
// racing to scan the same domain at once.
const inFlight = new Map<string, Promise<ScanResult>>();

async function getCached(domain: string): Promise<ScanResult | null> {
  const key = `scan:${domain}`;
  const stored = await chrome.storage.session.get(key);
  const env = stored[key] as CacheEnvelope | undefined;
  if (env && env.expires > Date.now()) return env.result;
  return null;
}

async function putCached(domain: string, result: ScanResult): Promise<void> {
  await chrome.storage.session.set({
    [`scan:${domain}`]: { result, expires: Date.now() + CACHE_TTL_MS },
  });
}

async function pushHistory(result: ScanResult): Promise<void> {
  const { history = [] } = (await chrome.storage.local.get("history")) as {
    history?: HistoryEntry[];
  };
  const next: HistoryEntry[] = [
    { domain: result.domain, grade: result.grade, timestamp: result.timestamp },
    ...history.filter((h) => h.domain !== result.domain),
  ].slice(0, HISTORY_MAX);
  await chrome.storage.local.set({ history: next });
}

/** Cached scan with single-flight dedupe. Throws on scan failure. */
async function scanCached(
  domain: string,
): Promise<{ result: ScanResult; cached: boolean }> {
  const hit = await getCached(domain);
  if (hit) return { result: hit, cached: true };

  let pending = inFlight.get(domain);
  if (!pending) {
    pending = scan(domain);
    inFlight.set(domain, pending);
  }
  try {
    const result = await pending;
    await putCached(domain, result);
    await pushHistory(result);
    return { result, cached: false };
  } finally {
    inFlight.delete(domain);
  }
}

// ---- Popup / message handler -------------------------------------------------

chrome.runtime.onMessage.addListener(
  (msg: ScanRequest, _sender, sendResponse: (r: ScanResponse) => void) => {
    if (msg?.type !== "scan") return false;
    const domain = normalizeDomain(msg.domain);
    if (!domain) {
      sendResponse({
        ok: false,
        error: "Enter a valid domain (e.g. example.com).",
      });
      return false;
    }
    scanCached(domain)
      .then(({ result, cached }) => sendResponse({ ok: true, result, cached }))
      .catch((err: unknown) =>
        sendResponse({
          ok: false,
          error: err instanceof Error ? err.message : "Scan failed.",
        }),
      );
    return true; // async sendResponse
  },
);

// ---- Active-tab grade badge --------------------------------------------------
//
// Needs the `tabs` permission (not just `activeTab`): `activeTab` only grants
// tab URL access after the user explicitly invokes the extension, so it can't
// power a badge that updates passively on tab switch.

function tabDomain(url: string | undefined): string | null {
  if (!url || !/^https?:/.test(url)) return null;
  try {
    return normalizeDomain(new URL(url).hostname);
  } catch {
    return null;
  }
}

async function setBadge(tabId: number, domain: string): Promise<void> {
  try {
    const { result } = await scanCached(domain);
    await chrome.action.setBadgeText({ tabId, text: result.grade });
    await chrome.action.setBadgeBackgroundColor({
      tabId,
      color: gradeColor(result.grade),
    });
    await chrome.action.setTitle({
      tabId,
      title: `${domain}: grade ${result.grade} — click for details`,
    });
  } catch {
    await chrome.action.setBadgeText({ tabId, text: "" });
  }
}

async function refreshBadgeForTab(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    const domain = tabDomain(tab.url);
    if (domain) await setBadge(tabId, domain);
    else await chrome.action.setBadgeText({ tabId, text: "" });
  } catch {
    /* tab gone */
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => refreshBadgeForTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "complete") refreshBadgeForTab(tabId);
});

// ---- Context menu ------------------------------------------------------------

const MENU_ID = "dmarcus-check";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: MENU_ID,
    title: "Check email security with dmarc.mx",
    contexts: ["link", "selection", "page"],
  });
});

function extractDomain(text: string | undefined): string | null {
  if (!text) return null;
  const trimmed = text.trim();
  // Pull the domain out of an email address if one was selected.
  const at = trimmed.lastIndexOf("@");
  return normalizeDomain(at >= 0 ? trimmed.slice(at + 1) : trimmed);
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
  const domain =
    extractDomain(info.selectionText) ||
    extractDomain(info.linkUrl) ||
    tabDomain(info.pageUrl) ||
    tabDomain(tab?.url);
  if (!domain) return;
  // Prewarm the cache, then open the full report on dmarc.mx.
  scanCached(domain).catch(() => {});
  chrome.tabs.create({ url: `${DMARC_MX_REPORT_BASE}/${domain}` });
});

// ---- Omnibox: `dmrc example.com` --------------------------------------------

chrome.omnibox.setDefaultSuggestion({
  description: "Check email security for a domain via dmarc.mx",
});

chrome.omnibox.onInputChanged.addListener((input, suggest) => {
  const domain = normalizeDomain(input);
  if (domain) {
    suggest([
      { content: domain, description: `Check email security for ${domain}` },
    ]);
  }
});

chrome.omnibox.onInputEntered.addListener((input) => {
  const domain = normalizeDomain(input);
  if (!domain) return;
  scanCached(domain).catch(() => {});
  chrome.tabs.create({ url: `${DMARC_MX_REPORT_BASE}/${domain}` });
});
