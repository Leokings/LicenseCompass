import { afterEach, describe, expect, it, vi } from "vitest";
import { CONTRACT_ADDRESS } from "./config";
import { getPendingAction, permissionReadbackMatches } from "./genlayer";

const base = {
  kind: "terms",
  hash: `0x${"1".repeat(64)}`,
  intentId: "intent-recovery-test-001",
  createdAt: 1_791_473_000_000,
  functionName: "publish_terms_version",
  argsJson: JSON.stringify([
    { type: "bigint", value: "3" },
    { type: "bigint", value: "1" },
    { type: "string", value: JSON.stringify(["This is a bounded clause."]) },
  ]),
  address: `0x${"2".repeat(40)}`,
  contractAddress: CONTRACT_ADDRESS,
  workId: 3,
  expectedVersion: 1,
  expectedTerms: JSON.stringify(["This is a bounded clause."]),
};

function stored(value: unknown) {
  vi.stubGlobal("window", { sessionStorage: { getItem: () => JSON.stringify(value) } });
}

afterEach(() => vi.unstubAllGlobals());

describe("pending StudioNet readback", () => {
  it("resumes only a transaction pinned to this contract and exact terms", () => {
    stored(base);
    expect(getPendingAction()).toMatchObject(base);
    stored({ ...base, contractAddress: `0x${"3".repeat(40)}` });
    expect(getPendingAction()).toBeNull();
    stored({ ...base, expectedTerms: undefined });
    expect(getPendingAction()).toBeNull();
  });

  it("requires a concrete permission response for recovery", () => {
    const response = { ...base, kind: "respond", functionName: "respond_permission", argsJson: JSON.stringify([
      { type: "bigint", value: "4" }, { type: "boolean", value: true },
      { type: "string", value: "Approved for the described use." },
    ]), checkId: 4, expectedStatus: "APPROVED", expectedNote: "Approved for the described use." };
    stored(response);
    expect(getPendingAction()?.kind).toBe("respond");
    stored({ ...response, expectedNote: undefined });
    expect(getPendingAction()).toBeNull();
  });

  it("retains a pre-broadcast intent when the RPC returns no hash", () => {
    stored({ ...base, hash: "" });
    expect(getPendingAction()?.hash).toBe("");
  });

  it("recognizes a request even after the publisher answers it", () => {
    const permission = {
      checkId: 4, status: "APPROVED" as const,
      requester: base.address, publisher: `0x${"4".repeat(40)}`,
      requestNote: "Please approve this exact use.", responseNote: "Approved for this use.",
      requestedAt: 10, respondedAt: 20,
    };
    expect(permissionReadbackMatches("request", base.address, "PENDING", "Please approve this exact use.", permission)).toBe(true);
    expect(permissionReadbackMatches("request", base.address, "PENDING", "A different request.", permission)).toBe(false);
    expect(permissionReadbackMatches("request", `0x${"5".repeat(40)}`, "PENDING", permission.requestNote, permission)).toBe(false);
    expect(permissionReadbackMatches("respond", permission.publisher, "APPROVED", permission.responseNote, permission)).toBe(true);
    expect(permissionReadbackMatches("respond", permission.publisher, "DECLINED", permission.responseNote, permission)).toBe(false);
  });
});
