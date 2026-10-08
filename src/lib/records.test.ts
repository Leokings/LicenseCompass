import { describe, expect, it } from "vitest";
import { normalizeAssetUrl, parseLicense, parseUseCheck } from "./records";

describe("record parsing", () => {
  it("normalizes a public HTTPS work URL", () => {
    expect(normalizeAssetUrl("Example.com/work")).toBe("https://example.com/work");
    expect(() => normalizeAssetUrl("http://example.com/work")).toThrow(/HTTPS/);
    expect(() => normalizeAssetUrl("https://example.local/work")).toThrow(/public/);
  });

  it("preserves numbered clauses and their digest", () => {
    const license = parseLicense({
      work_id: 1n, version: 2n, clauses_json: '["Credit the maker."]',
      terms_digest: "abc", published_at: 10n,
    });
    expect(license.version).toBe(2);
    expect(license.clauses).toEqual(["Credit the maker."]);
  });

  it("rejects unknown or malformed decisions", () => {
    const raw = {
      check_id: 1, request_reference: "check-001", work_id: 1,
      license_version: 1, terms_digest: "abc", requester: "0x1",
      use_kind: "COMMERCIAL", is_modified: false, will_credit: true,
      channel: "Website", description: "A paid ad for my product",
      outcome: "WITHIN_TERMS", rationale: "It is allowed.",
      clause_ids_json: "[1]", conditions_json: "[]", check_digest: "def", created_at: 10,
    };
    expect(parseUseCheck(raw).outcome).toBe("WITHIN_TERMS");
    expect(() => parseUseCheck({ ...raw, outcome: "LEGAL_APPROVAL" })).toThrow(/unknown/);
    expect(() => parseUseCheck({ ...raw, clause_ids_json: "[99, false]" })).toThrow(/invalid clause/);
  });
});
