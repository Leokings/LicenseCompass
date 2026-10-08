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
