import { afterEach, describe, expect, it, vi } from "vitest";
import { DnsLookupError, queryMx, queryTxt } from "../src/dns/client";

function mockFetch(
  handler: (url: string) => { Status: number; Answer?: unknown[] } | "throw",
) {
  return vi.fn(async (url: string) => {
    const r = handler(url);
    if (r === "throw") throw new TypeError("network down");
    return { ok: true, json: async () => r } as Response;
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("queryTxt", () => {
  it("returns a single unquoted record (Google style)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        Status: 0,
        Answer: [{ name: "x", type: 16, data: "v=spf1 -all" }],
      })),
    );
    const r = await queryTxt("example.com");
    expect(r).toEqual({ entries: ["v=spf1 -all"], raw: "v=spf1 -all" });
  });

  it("concatenates quoted split character-strings (Cloudflare style)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        Status: 0,
        Answer: [{ name: "x", type: 16, data: '"part-one " "part-two"' }],
      })),
    );
    const r = await queryTxt("example.com");
    expect(r?.raw).toBe("part-one part-two");
  });

  it("unescapes backslash and octal escapes", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        Status: 0,
        Answer: [{ name: "x", type: 16, data: '"a\\"b\\\\c\\032d"' }],
      })),
    );
    const r = await queryTxt("example.com");
    expect(r?.entries[0]).toBe('a"b\\c d');
  });

  it("returns null on NXDOMAIN (Status 3)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ Status: 3 })),
    );
    expect(await queryTxt("nope.example")).toBeNull();
  });

  it("returns null on NODATA (Status 0, no matching answers)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        Status: 0,
        Answer: [{ name: "x", type: 5, data: "cname.example." }],
      })),
    );
    expect(await queryTxt("example.com")).toBeNull();
  });

  it("throws DnsLookupError on SERVFAIL (Status 2)", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ Status: 2 })),
    );
    await expect(queryTxt("example.com")).rejects.toBeInstanceOf(
      DnsLookupError,
    );
  });
});

describe("queryMx", () => {
  it("parses priority/exchange and strips the trailing dot", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({
        Status: 0,
        Answer: [
          { name: "x", type: 15, data: "10 smtp.google.com." },
          { name: "x", type: 15, data: "20 alt.google.com." },
        ],
      })),
    );
    const r = await queryMx("google.com");
    expect(r).toEqual([
      { priority: 10, exchange: "smtp.google.com" },
      { priority: 20, exchange: "alt.google.com" },
    ]);
  });

  it("returns null when MX is absent", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(() => ({ Status: 3 })),
    );
    expect(await queryMx("no-mx.example")).toBeNull();
  });
});

describe("provider fallback", () => {
  it("falls back to Google when Cloudflare network-fails", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("cloudflare-dns.com")) throw new TypeError("blocked");
      return {
        ok: true,
        json: async () => ({
          Status: 0,
          Answer: [{ name: "x", type: 16, data: "v=DMARC1; p=reject" }],
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await queryTxt("example.com");
    expect(r?.raw).toContain("DMARC1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws ESERVFAIL when every provider fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("network down");
      }),
    );
    await expect(queryTxt("example.com")).rejects.toMatchObject({
      code: "ESERVFAIL",
    });
  });
});
