import { analyzeBimi, prefetchBimiDns } from "./analyzers/bimi";
import { analyzeDkim } from "./analyzers/dkim";
import { analyzeDmarc } from "./analyzers/dmarc";
import { analyzeMtaSts } from "./analyzers/mta-sts";
import { analyzeMx } from "./analyzers/mx";
import { checkMxMtaStsConsistency } from "./analyzers/mx-mta-sts-consistency";
import { analyzeSecurityTxt } from "./analyzers/security-txt";
import { analyzeSpf } from "./analyzers/spf";
import { analyzeTlsRpt } from "./analyzers/tls-rpt";
import type { ScanResult } from "./analyzers/types";
import { queryTxt } from "./dns/client";
import { computeGradeBreakdown } from "./shared/scoring";

/**
 * Scan orchestrator — a Sentry-free clone of dmarcheck's `src/orchestrator.ts`.
 * The scan logic (concurrency model, S-grade easter egg, MX/MTA-STS
 * cross-check) is preserved verbatim; only Sentry breadcrumbs are removed.
 */

async function buildScanResult(
  domain: string,
  protocols: ScanResult["protocols"],
): Promise<ScanResult> {
  // Cross-check MX hosts against MTA-STS policy patterns (RFC 8461 §3.4)
  const consistencyValidations = checkMxMtaStsConsistency(
    protocols.mx,
    protocols.mta_sts,
  );
  if (consistencyValidations.length > 0) {
    protocols.mta_sts.validations.push(...consistencyValidations);
    // Re-derive status in case new warn validations were added
    const hasFailure = protocols.mta_sts.validations.some(
      (v) => v.status === "fail",
    );
    const hasWarn = protocols.mta_sts.validations.some(
      (v) => v.status === "warn",
    );
    protocols.mta_sts.status = hasFailure ? "fail" : hasWarn ? "warn" : "pass";
  }

  const breakdown = computeGradeBreakdown(protocols);

  // Easter egg: S grade for A+ domains advertising dmarc.mx
  if (breakdown.grade === "A+") {
    try {
      const txt = await queryTxt(domain);
      if (txt?.entries.some((e) => e.toLowerCase().includes("dmarc.mx"))) {
        breakdown.grade = "S";
      }
    } catch {
      // Silently ignore — don't downgrade the experience for a DNS hiccup
    }
  }

  const dkimFound = Object.values(protocols.dkim.selectors).filter(
    (s) => s.found,
  ).length;
  const dmarcPolicy = protocols.dmarc.tags?.p?.toLowerCase() ?? null;

  return {
    domain,
    timestamp: new Date().toISOString(),
    grade: breakdown.grade,
    breakdown,
    summary: {
      mx_records: protocols.mx.records.length,
      mx_providers: protocols.mx.providers.map((p) => p.name),
      dmarc_policy: dmarcPolicy,
      spf_result: protocols.spf.status,
      spf_lookups: `${protocols.spf.lookups_used}/${protocols.spf.lookup_limit}`,
      dkim_selectors_found: dkimFound,
      bimi_enabled: protocols.bimi.status === "pass",
      mta_sts_mode: protocols.mta_sts.policy?.mode ?? null,
    },
    protocols,
  };
}

export async function scan(
  domain: string,
  customSelectors: string[] = [],
): Promise<ScanResult> {
  // Fire all independent DNS queries immediately
  const dmarcPromise = analyzeDmarc(domain);
  const spfPromise = analyzeSpf(domain);
  const mtaStsPromise = analyzeMtaSts(domain);
  const bimiDnsPromise = prefetchBimiDns(domain);
  const mxPromise = analyzeMx(domain);
  const securityTxtPromise = analyzeSecurityTxt(domain);
  const tlsRptPromise = analyzeTlsRpt(domain);

  // Chain DKIM off MX so it starts as soon as MX resolves
  // without blocking on unrelated queries
  const dkimPromise = mxPromise.then((mxResult) => {
    const providerNames = mxResult.providers.map((p) => p.name);
    return analyzeDkim(domain, customSelectors, providerNames);
  });

  const bimiPromise = Promise.all([dmarcPromise, bimiDnsPromise]).then(
    ([dmarcResult, bimiDns]) => {
      const dmarcPolicy = dmarcResult.tags?.p?.toLowerCase() ?? null;
      return analyzeBimi(domain, dmarcPolicy, bimiDns);
    },
  );

  const [
    dmarcResult,
    spfResult,
    dkimResult,
    mtaStsResult,
    bimiResult,
    mxResult,
    securityTxtResult,
    tlsRptResult,
  ] = await Promise.all([
    dmarcPromise,
    spfPromise,
    dkimPromise,
    mtaStsPromise,
    bimiPromise,
    mxPromise,
    securityTxtPromise,
    tlsRptPromise,
  ]);

  return await buildScanResult(domain, {
    mx: mxResult,
    dmarc: dmarcResult,
    spf: spfResult,
    dkim: dkimResult,
    bimi: bimiResult,
    mta_sts: mtaStsResult,
    security_txt: securityTxtResult,
    tls_rpt: tlsRptResult,
  });
}
