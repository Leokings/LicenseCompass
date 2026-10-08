export type TransactionState = {
  statusName?: string;
  resultName?: string;
  result_name?: string;
  txExecutionResultName?: string;
  consensus_data?: { leader_receipt?: Array<{ execution_result?: string }> };
};

export function classifyTransaction(value: TransactionState): "pending" | "failed" | "succeeded" | "unknown" {
  if (value.statusName !== "FINALIZED") return "pending";
  const decision = value.resultName ?? value.result_name;
  const execution = value.txExecutionResultName ?? value.consensus_data?.leader_receipt?.[0]?.execution_result;
  if (decision && decision !== "MAJORITY_AGREE") return "failed";
  if (execution && execution !== "SUCCESS" && execution !== "FINISHED_WITH_RETURN") return "failed";
  return decision === "MAJORITY_AGREE" && execution ? "succeeded" : "unknown";
}

// EIP-1193 code 4001 means the wallet rejected signing before broadcasting.
// Network errors and missing transaction hashes must keep their saved intent.
export function isExplicitWalletRejection(value: unknown): boolean {
  let current: unknown = value;
  for (let depth = 0; depth < 4; depth += 1) {
    if (!current || typeof current !== "object") return false;
    const error = current as { code?: unknown; cause?: unknown; error?: unknown };
    if (error.code === 4001) return true;
    current = error.cause ?? error.error;
  }
  return false;
}
