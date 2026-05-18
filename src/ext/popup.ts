import type { ScanResult } from "../analyzers/types";
import { normalizeDomain } from "../shared/domain";
import {
  gradeColor,
  type HistoryEntry,
  reportUrl,
  type ScanResponse,
} from "./shared";

const form = document.getElementById("scan-form") as HTMLFormElement;
const input = document.getElementById("domain") as HTMLInputElement;
const btn = document.getElementById("scan-btn") as HTMLButtonElement;
const resultEl = document.getElementById("result") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;
const historyWrap = document.getElementById("history-wrap") as HTMLElement;
const historyEl = document.getElementById("history") as HTMLUListElement;

const PROTOCOLS: { key: string; label: string }[] = [
  { key: "mx", label: "MX" },
  { key: "dmarc", label: "DMARC" },
  { key: "spf", label: "SPF" },
  { key: "dkim", label: "DKIM" },
  { key: "bimi", label: "BIMI" },
  { key: "mta_sts", label: "MTA-STS" },
  { key: "tls_rpt", label: "TLS-RPT" },
  { key: "security_txt", label: "security.txt" },
];

// All dynamic values below (domain, DMARC p= tag, provider names, etc.) are
// DNS-derived and therefore attacker-controllable. They are inserted via
// `textContent` / element construction only — never `innerHTML` — so a hostile
// record cannot inject markup into the popup document.
function el(
  tag: string,
  opts: { class?: string; text?: string; style?: string } = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (opts.class) node.className = opts.class;
  if (opts.text != null) node.textContent = opts.text;
  if (opts.style) node.setAttribute("style", opts.style);
  return node;
}

function setStatus(text: string, isError = false): void {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
  statusEl.hidden = !text;
}

function protoDetail(key: string, result: ScanResult): string {
  const s = result.summary;
  switch (key) {
    case "mx":
      return s.mx_providers.join(", ") || `${s.mx_records} record(s)`;
    case "dmarc":
      return s.dmarc_policy ? `p=${s.dmarc_policy}` : "no policy";
    case "spf":
      return `${s.spf_lookups} lookups`;
    case "dkim":
      return `${s.dkim_selectors_found} selector(s)`;
    case "bimi":
      return s.bimi_enabled ? "enabled" : "";
    case "mta_sts":
      return s.mta_sts_mode ? `mode=${s.mta_sts_mode}` : "";
    default:
      return "";
  }
}

function render(result: ScanResult, cached: boolean): void {
  const color = gradeColor(result.grade);
  resultEl.replaceChildren();

  const row = el("div", { class: "grade-row" });
  row.append(
    el("div", {
      class: "grade",
      text: result.grade,
      style: `background:${color}`,
    }),
  );
  const meta = el("div", { class: "grade-meta" });
  meta.append(el("strong", { text: result.domain }));
  const scoreLine = el("div", { text: result.breakdown.tierReason });
  if (cached) scoreLine.append(el("span", { class: "cached", text: "cached" }));
  meta.append(scoreLine);
  row.append(meta);
  resultEl.append(row);

  const list = el("ul", { class: "protocols" });
  for (const { key, label } of PROTOCOLS) {
    const p = (
      result.protocols as Record<string, { status?: string } | undefined>
    )[key];
    if (!p?.status) continue;
    const li = el("li");
    li.append(
      el("span", { class: "proto-name", text: label }),
      el("span", { class: "proto-detail", text: protoDetail(key, result) }),
      el("span", { class: `pill ${p.status}`, text: p.status }),
    );
    list.append(li);
  }
  resultEl.append(list);

  const link = el("a", {
    class: "report-link",
    text: "View full report on dmarc.mx →",
  }) as HTMLAnchorElement;
  link.href = reportUrl(result.domain);
  link.target = "_blank";
  link.rel = "noopener";
  resultEl.append(link);

  resultEl.hidden = false;
}

async function runScan(raw: string): Promise<void> {
  const domain = normalizeDomain(raw);
  if (!domain) {
    setStatus("Enter a valid domain (e.g. example.com).", true);
    return;
  }
  input.value = domain;
  resultEl.hidden = true;
  btn.disabled = true;
  setStatus(`Scanning ${domain}…`);
  try {
    const resp: ScanResponse = await chrome.runtime.sendMessage({
      type: "scan",
      domain,
    });
    if (resp.ok) {
      setStatus("");
      render(resp.result, resp.cached);
    } else {
      setStatus(resp.error, true);
    }
  } catch (err) {
    setStatus(
      err instanceof Error ? err.message : "Could not reach the scanner.",
      true,
    );
  } finally {
    btn.disabled = false;
    void loadHistory();
  }
}

async function loadHistory(): Promise<void> {
  const { history = [] } = (await chrome.storage.local.get("history")) as {
    history?: HistoryEntry[];
  };
  if (history.length === 0) {
    historyWrap.hidden = true;
    return;
  }
  historyEl.replaceChildren();
  for (const h of history.slice(0, 8)) {
    const li = el("li");
    li.append(
      el("span", {
        class: "hist-grade",
        text: h.grade,
        style: `background:${gradeColor(h.grade)}`,
      }),
      el("span", { text: h.domain }),
    );
    li.addEventListener("click", () => void runScan(h.domain));
    historyEl.append(li);
  }
  historyWrap.hidden = false;
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  void runScan(input.value);
});

// Prefill with the active tab's domain for one-click scanning.
(async () => {
  void loadHistory();
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.url) {
      const d = normalizeDomain(new URL(tab.url).hostname);
      if (d) input.value = d;
    }
  } catch {
    /* no tab access — leave input empty */
  }
})();
