import type { MxRecord, TxtRecord } from "./types";

/**
 * DNS-over-HTTPS adapter for the DMarcus Chrome extension.
 *
 * Drop-in replacement for dmarcheck's `node:dns` based `src/dns/client.ts`.
 * The export surface (`DnsLookupError`, `queryTxt`, `queryMx`) is kept
 * byte-identical so every vendored analyzer compiles and behaves unchanged:
 * `null` means the record is genuinely absent (NXDOMAIN / NODATA); a thrown
 * `DnsLookupError` means the query itself failed (SERVFAIL / timeout / network)
 * and should be surfaced to the user rather than read as "not configured".
 *
 * Primary resolver is Cloudflare's JSON DoH API, with Google as fallback.
 */

export class DnsLookupError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DnsLookupError";
  }
}

const DNS_TIMEOUT_MS = 3000;

// RFC 1035 record type numbers.
const TYPE_TXT = 16;
const TYPE_MX = 15;

interface DohAnswer {
  name: string;
  type: number;
  TTL?: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

const PROVIDERS = [
  "https://cloudflare-dns.com/dns-query",
  "https://dns.google/resolve",
] as const;

async function fetchDoh(name: string, type: number): Promise<DohResponse> {
  const params = `name=${encodeURIComponent(name)}&type=${type}`;
  let lastErr: unknown;

  for (const base of PROVIDERS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DNS_TIMEOUT_MS);
    try {
      const resp = await fetch(`${base}?${params}`, {
        headers: { Accept: "application/dns-json" },
        signal: controller.signal,
      });
      if (!resp.ok) {
        lastErr = new Error(`DoH HTTP ${resp.status}`);
        continue;
      }
      return (await resp.json()) as DohResponse;
    } catch (err) {
      lastErr = err;
      // Try the next provider on network error / timeout / abort.
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastErr instanceof Error && lastErr.name === "AbortError") {
    throw new DnsLookupError("DNS_TIMEOUT", "DNS query timed out");
  }
  throw new DnsLookupError(
    "ESERVFAIL",
    `All DoH providers failed: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }`,
  );
}

/**
 * Map a DoH `Status` to our absent/error model.
 * 0 = NOERROR (caller checks Answer length for NODATA), 3 = NXDOMAIN → absent.
 * 2 = SERVFAIL and any other non-zero status → query failure.
 */
function checkStatus(status: number): "absent" | "ok" | "error" {
  if (status === 3) return "absent"; // NXDOMAIN
  if (status === 0) return "ok"; // NOERROR
  return "error"; // SERVFAIL (2) and friends
}

/**
 * Decode a TXT rdata string from the DoH JSON API into its logical value.
 *
 * Cloudflare returns each character-string already wrapped in double quotes,
 * concatenated for split records (`"part1" "part2"`). Google returns short
 * records unquoted. This handles both: quoted runs are unescaped (`\"`, `\\`,
 * `\DDD` octal) and concatenated; unquoted data is returned as-is.
 */
function decodeTxtData(data: string): string {
  if (!data.startsWith('"')) return data;

  let out = "";
  let i = 0;
  while (i < data.length) {
    if (data[i] !== '"') {
      i++; // skip whitespace between adjacent character-strings
      continue;
    }
    i++; // opening quote
    while (i < data.length && data[i] !== '"') {
      if (data[i] === "\\") {
        const next = data[i + 1];
        if (next >= "0" && next <= "9") {
          out += String.fromCharCode(
            Number.parseInt(data.slice(i + 1, i + 4), 10),
          );
          i += 4;
        } else {
          out += next;
          i += 2;
        }
      } else {
        out += data[i];
        i++;
      }
    }
    i++; // closing quote
  }
  return out;
}

export async function queryTxt(name: string): Promise<TxtRecord | null> {
  const resp = await fetchDoh(name, TYPE_TXT);
  const state = checkStatus(resp.Status);
  if (state === "absent") return null;
  if (state === "error") {
    throw new DnsLookupError("ESERVFAIL", "DNS server failure (SERVFAIL)");
  }

  const entries = (resp.Answer ?? [])
    .filter((a) => a.type === TYPE_TXT)
    .map((a) => decodeTxtData(a.data));

  if (entries.length === 0) return null; // NODATA
  return { entries, raw: entries.join(" ") };
}

export async function queryMx(name: string): Promise<MxRecord[] | null> {
  const resp = await fetchDoh(name, TYPE_MX);
  const state = checkStatus(resp.Status);
  if (state === "absent") return null;
  if (state === "error") {
    throw new DnsLookupError("ESERVFAIL", "DNS server failure (SERVFAIL)");
  }

  const records = (resp.Answer ?? [])
    .filter((a) => a.type === TYPE_MX)
    .map((a) => {
      // rdata: "<priority> <exchange>" e.g. "10 smtp.google.com."
      const sep = a.data.indexOf(" ");
      const priority = Number.parseInt(a.data.slice(0, sep), 10);
      const exchange = a.data.slice(sep + 1).replace(/\.$/, "");
      return { priority, exchange };
    });

  if (records.length === 0) return null; // NODATA
  return records;
}
