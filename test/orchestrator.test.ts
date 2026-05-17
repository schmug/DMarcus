import { afterEach, describe, expect, it, vi } from "vitest";
import { scan } from "../src/orchestrator";

// End-to-end smoke test: drives the full vendored analyzer pipeline through
// the DoH client with a routing fetch mock. Proves the Sentry-free
// orchestrator + DoH adapter produce a coherent ScanResult.

function dohJson(body: object) {
  return { ok: true, json: async () => body } as Response;
}

function nameOf(url: string): string {
  return new URL(url).searchParams.get("name") ?? "";
}

afterEach(() => vi.restoreAllMocks());

describe("scan() integration", () => {
  it("produces a graded result for a DMARC+SPF+MX domain", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        // Non-DoH fetches (MTA-STS policy, security.txt) → not published.
        if (!url.includes("dns-query") && !url.includes("dns.google")) {
          return { ok: false, status: 404, type: "basic" } as Response;
        }
        const name = nameOf(url);
        const type = new URL(url).searchParams.get("type");
        if (name === "_dmarc.example.com" && type === "16") {
          return dohJson({
            Status: 0,
            Answer: [
              {
                name,
                type: 16,
                data: "v=DMARC1; p=reject; rua=mailto:dmarc@example.com",
              },
            ],
          });
        }
        if (name === "example.com" && type === "16") {
          return dohJson({
            Status: 0,
            Answer: [{ name, type: 16, data: "v=spf1 -all" }],
          });
        }
        if (name === "example.com" && type === "15") {
          return dohJson({
            Status: 0,
            Answer: [{ name, type: 15, data: "10 mx.example.com." }],
          });
        }
        // Everything else (DKIM selectors, BIMI, TLS-RPT, …) → NXDOMAIN.
        return dohJson({ Status: 3 });
      }),
    );

    const result = await scan("example.com");

    expect(result.domain).toBe("example.com");
    expect(typeof result.grade).toBe("string");
    expect(result.grade.length).toBeGreaterThan(0);
    expect(result.protocols.dmarc.status).toBe("pass");
    expect(result.protocols.dmarc.tags?.p).toBe("reject");
    expect(result.protocols.mx.records.length).toBe(1);
    expect(result.summary.dmarc_policy).toBe("reject");
  });
});
