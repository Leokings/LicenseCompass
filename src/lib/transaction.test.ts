import { describe, expect, it } from "vitest";
import { classifyTransaction, isExplicitWalletRejection } from "./transaction";

describe("transaction finality", () => {
  it("does not confuse finality with successful execution", () => {
    expect(classifyTransaction({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "ERROR" })).toBe("failed");
    expect(classifyTransaction({ statusName: "FINALIZED", resultName: "MAJORITY_DISAGREE" })).toBe("failed");
    expect(classifyTransaction({ statusName: "FINALIZED", resultName: "MAJORITY_AGREE", txExecutionResultName: "SUCCESS" })).toBe("succeeded");
    expect(classifyTransaction({ statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: { leader_receipt: [{ execution_result: "SUCCESS" }] } })).toBe("succeeded");
    expect(classifyTransaction({ statusName: "FINALIZED", result_name: "MAJORITY_AGREE", consensus_data: { leader_receipt: [{ execution_result: "ERROR" }] } })).toBe("failed");
    expect(classifyTransaction({ statusName: "ACCEPTED" })).toBe("pending");
  });
});

describe("wallet rejection recovery", () => {
  it("clears only an explicit pre-broadcast wallet rejection", () => {
    expect(isExplicitWalletRejection({ code: 4001, message: "User rejected" })).toBe(true);
    expect(isExplicitWalletRejection({ cause: { code: 4001 } })).toBe(true);
    expect(isExplicitWalletRejection({ code: -32000, message: "RPC unavailable" })).toBe(false);
    expect(isExplicitWalletRejection(new Error("No transaction hash"))).toBe(false);
  });
});
