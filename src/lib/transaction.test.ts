import { describe, expect, it } from "vitest";
import { classifyTransaction } from "./transaction";

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
