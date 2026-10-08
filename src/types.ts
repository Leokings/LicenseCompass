export type WalletKind = "studio" | "browser";

export type ConnectedWallet = {
  address: string;
  kind: WalletKind;
};

export type Outcome = "WITHIN_TERMS" | "OUTSIDE_TERMS" | "UNCLEAR";
export type UseKind = "PERSONAL" | "EDITORIAL" | "COMMERCIAL";

export type ContractInfo = {
  contractVersion: string;
  decisionPolicy: string;
  termsFormat: string;
  workCount: number;
  checkCount: number;
  configDigest: string;
};

export type Work = {
  workId: number;
  publishReference: string;
  publisher: string;
  title: string;
  assetUrl: string;
  currentVersion: number;
  createdAt: number;
};

export type LicenseVersion = {
  workId: number;
  version: number;
  clauses: string[];
  termsDigest: string;
  publishedAt: number;
};

export type UseCheck = {
  checkId: number;
  requestReference: string;
  workId: number;
  licenseVersion: number;
  termsDigest: string;
  requester: string;
  useKind: UseKind;
  isModified: boolean;
  willCredit: boolean;
  channel: string;
  description: string;
  outcome: Outcome;
  rationale: string;
  clauseIds: number[];
  conditions: string[];
  checkDigest: string;
  createdAt: number;
  transactionHash?: string;
};

export type PermissionRequest = {
  checkId: number;
  status: "NONE" | "PENDING" | "APPROVED" | "DECLINED";
  requester?: string;
  publisher?: string;
  requestNote?: string;
  responseNote?: string;
  requestedAt?: number;
  respondedAt?: number;
};
