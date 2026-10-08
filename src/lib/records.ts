import type { ContractInfo, LicenseVersion, Outcome, PermissionRequest, UseCheck, UseKind, Work } from "../types";

const OUTCOMES = new Set<Outcome>(["WITHIN_TERMS", "OUTSIDE_TERMS", "UNCLEAR"]);
const USE_KINDS = new Set<UseKind>(["PERSONAL", "EDITORIAL", "COMMERCIAL"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (value instanceof Map) return Object.fromEntries(value.entries());
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`GenLayer returned invalid ${label}.`);
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`GenLayer returned invalid ${label}.`);
  return value;
}

function number(value: unknown, label: string): number {
  let parsed: bigint;
  if (typeof value === "bigint") parsed = value;
  else if (typeof value === "number" && Number.isSafeInteger(value)) parsed = BigInt(value);
  else if (typeof value === "string" && /^\d+$/.test(value)) parsed = BigInt(value);
  else throw new Error(`GenLayer returned invalid ${label}.`);
  const result = Number(parsed);
  if (!Number.isSafeInteger(result) || result < 0) throw new Error(`GenLayer returned out-of-range ${label}.`);
  return result;
}

function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`GenLayer returned invalid ${label}.`);
  return value;
}

function jsonArray(value: unknown, label: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text(value, label));
  } catch {
    throw new Error(`GenLayer returned malformed ${label}.`);
  }
  if (!Array.isArray(parsed)) throw new Error(`GenLayer returned invalid ${label}.`);
  return parsed;
}

function stringArray(value: unknown, label: string, maximum: number): string[] {
  const items = jsonArray(value, label);
  if (items.length > maximum || items.some((item) => typeof item !== "string")) {
    throw new Error(`GenLayer returned invalid ${label}.`);
  }
  return items as string[];
}

export function parseContractInfo(value: unknown): ContractInfo {
  const item = record(value, "contract information");
  return {
    contractVersion: text(item.contract_version, "contract version"),
    decisionPolicy: text(item.decision_policy, "decision policy"),
    termsFormat: text(item.terms_format, "terms format"),
    workCount: number(item.work_count, "work count"),
    checkCount: number(item.check_count, "check count"),
    configDigest: text(item.config_digest, "configuration digest"),
  };
}

export function parseWork(value: unknown): Work {
  const item = record(value, "work");
  return {
    workId: number(item.work_id, "work ID"),
    publishReference: text(item.publish_reference, "publication reference"),
    publisher: text(item.publisher, "publisher"),
    title: text(item.title, "title"),
    assetUrl: text(item.asset_url, "asset URL"),
    currentVersion: number(item.current_version, "license version"),
    createdAt: number(item.created_at, "creation time"),
  };
}

export function parseLicense(value: unknown): LicenseVersion {
  const item = record(value, "license");
  const clauses = stringArray(item.clauses_json, "license clauses", 8);
  if (clauses.length === 0) throw new Error("GenLayer returned an empty license.");
  return {
    workId: number(item.work_id, "work ID"),
    version: number(item.version, "license version"),
    clauses,
    termsDigest: text(item.terms_digest, "terms digest"),
    publishedAt: number(item.published_at, "license publication time"),
  };
}

export function parseUseCheck(value: unknown): UseCheck {
  const item = record(value, "use check");
  const outcome = text(item.outcome, "outcome") as Outcome;
  const useKind = text(item.use_kind, "use kind") as UseKind;
  if (!OUTCOMES.has(outcome) || !USE_KINDS.has(useKind)) throw new Error("GenLayer returned an unknown decision.");
  const clauseIds = jsonArray(item.clause_ids_json, "clause IDs");
  if (clauseIds.length > 3 || clauseIds.some((id) => !Number.isSafeInteger(id) || Number(id) < 1)) {
    throw new Error("GenLayer returned invalid clause IDs.");
  }
  return {
    checkId: number(item.check_id, "check ID"),
    requestReference: text(item.request_reference, "check reference"),
    workId: number(item.work_id, "work ID"),
    licenseVersion: number(item.license_version, "license version"),
    termsDigest: text(item.terms_digest, "terms digest"),
    requester: text(item.requester, "requester"),
    useKind,
    isModified: boolean(item.is_modified, "modification flag"),
    willCredit: boolean(item.will_credit, "credit flag"),
    channel: text(item.channel, "channel"),
    description: text(item.description, "description"),
    outcome,
    rationale: text(item.rationale, "rationale"),
    clauseIds: clauseIds as number[],
    conditions: stringArray(item.conditions_json, "conditions", 3),
    checkDigest: text(item.check_digest, "check digest"),
    createdAt: number(item.created_at, "check time"),
  };
}

export function parsePermission(value: unknown): PermissionRequest {
  const item = record(value, "permission request");
  const status = text(item.status, "permission status") as PermissionRequest["status"];
  if (!["NONE", "PENDING", "APPROVED", "DECLINED"].includes(status)) {
    throw new Error("GenLayer returned an unknown permission status.");
  }
  const checkId = number(item.check_id, "check ID");
  if (status === "NONE") return { checkId, status };
  return {
    checkId,
    status,
    requester: text(item.requester, "permission requester"),
    publisher: text(item.publisher, "permission publisher"),
    requestNote: text(item.request_note, "request note"),
    responseNote: text(item.response_note, "response note"),
    requestedAt: number(item.requested_at, "request time"),
    respondedAt: number(item.responded_at, "response time"),
  };
}

export function normalizeAssetUrl(input: string): string {
  const raw = input.trim();
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  if (/[\s@#\\]/.test(withScheme)) {
    throw new Error("Use a public HTTPS link without spaces, login details, or a fragment.");
  }
  let parsed: URL;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error("Enter a valid public work URL.");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port) {
    throw new Error("The work URL must use HTTPS without credentials or a custom port.");
  }
  if (!/^[a-z0-9.-]+$/.test(parsed.hostname) || parsed.hostname.split(".").length < 2 ||
      /\.(local|localhost|internal|invalid|test)$/.test(parsed.hostname)) {
    throw new Error("Use a public domain name for the work URL.");
  }
  if (parsed.href.length > 1200) throw new Error("The work URL is too long.");
  return parsed.href;
}
