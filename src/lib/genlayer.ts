import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studionet } from "genlayer-js/chains";
import {
  CalldataAddress,
  TransactionHashVariant,
  TransactionStatus,
  type CalldataEncodable,
  type TransactionHash,
} from "genlayer-js/types";
import { getAddress, hexToBytes, isAddress } from "viem";
import type { ConnectedWallet, ContractInfo, LicenseVersion, PermissionRequest, UseCheck, UseKind, WalletKind, Work } from "../types";
import { CONTRACT_ADDRESS, isContractConfigured, RPC_URL, WALLET_RPC_URL } from "./config";
import { normalizeAssetUrl, parseContractInfo, parseLicense, parsePermission, parseUseCheck, parseWork } from "./records";
import { classifyTransaction, isExplicitWalletRejection } from "./transaction";

const STUDIO_SESSION_KEY = "license-compass:v1:studio-key";
const PENDING_KEY = "license-compass:v1:pending-action";

const chain = { ...studionet, rpcUrls: { default: { http: [RPC_URL] } } } as const;
const readClient = createClient({ chain, endpoint: RPC_URL });
const licenseReads = new Map<string, Promise<LicenseVersion>>();

type ClientConfig = NonNullable<Parameters<typeof createClient>[0]>;
type WalletProvider = NonNullable<ClientConfig["provider"]>;
type ProviderRequest = { method: string; params?: unknown[] };
type InjectedProvider = WalletProvider & { request(args: ProviderRequest): Promise<unknown> };

let activeBrowserProvider: InjectedProvider | undefined;

declare global {
  interface Window { ethereum?: InjectedProvider }
}

export type PendingAction = {
  kind: "publish" | "terms" | "check" | "request" | "respond";
  hash: TransactionHash | "";
  intentId: string;
  createdAt: number;
  functionName: string;
  argsJson: string;
  address: string;
  contractAddress: string;
  reference?: string;
  workId?: number;
  expectedVersion?: number;
  expectedTerms?: string;
  checkId?: number;
  expectedStatus?: "PENDING" | "APPROVED" | "DECLINED";
  expectedNote?: string;
};

export type CompletedAction =
  | { kind: "publish"; hash: string; work: Work }
  | { kind: "terms"; hash: string; license: LicenseVersion }
  | { kind: "check"; hash: string; check: UseCheck }
  | { kind: "request" | "respond"; hash: string; permission: PermissionRequest };

export type ActionPhase = "signing" | "submitted" | "finalizing" | "reading" | "recovering";
type OnUpdate = (phase: ActionPhase, hash?: string) => void;

const METHODS = {
  publish: "publish_work",
  terms: "publish_terms_version",
  check: "check_use",
  request: "request_permission",
  respond: "respond_permission",
} as const;

type StoredArg = { type: "string"; value: string } | { type: "boolean"; value: boolean } | { type: "bigint"; value: string };

function encodeArgs(args: CalldataEncodable[]): string {
  const stored: StoredArg[] = args.map((arg) => {
    if (typeof arg === "string") return { type: "string", value: arg };
    if (typeof arg === "boolean") return { type: "boolean", value: arg };
    if (typeof arg === "bigint") return { type: "bigint", value: arg.toString() };
    throw new Error("Unsupported write argument for safe transaction recovery.");
  });
  return JSON.stringify(stored);
}

function decodeArgs(value: string): CalldataEncodable[] {
  const parsed: unknown = JSON.parse(value);
  if (!Array.isArray(parsed) || parsed.length > 8) throw new Error("Invalid saved transaction arguments.");
  return parsed.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Invalid saved transaction argument.");
    const arg = item as Record<string, unknown>;
    if (arg.type === "string" && typeof arg.value === "string") return arg.value;
    if (arg.type === "boolean" && typeof arg.value === "boolean") return arg.value;
    if (arg.type === "bigint" && typeof arg.value === "string" && /^\d{1,40}$/.test(arg.value)) return BigInt(arg.value);
    throw new Error("Invalid saved transaction argument.");
  });
}

class FinalizedActionError extends Error {}

function address(): `0x${string}` {
  if (!isContractConfigured()) throw new Error("License Compass is not connected to a deployed StudioNet contract yet.");
  return getAddress(CONTRACT_ADDRESS);
}

function asHash(value: unknown): TransactionHash {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(value)) {
    throw new Error("GenLayer did not return a valid transaction ID.");
  }
  return value as TransactionHash;
}

function browserProvider(): InjectedProvider {
  const provider = window.ethereum;
  if (!provider || typeof provider.request !== "function") {
    throw new Error("No browser wallet was found. Use the instant Studio wallet or enable a wallet extension.");
  }
  return provider;
}

async function ensureStudionet(provider: InjectedProvider): Promise<void> {
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (cause) {
    const code = cause && typeof cause === "object" && "code" in cause ? Number((cause as { code?: unknown }).code) : 0;
    if (code === -32_002) throw new Error("A wallet network request is already waiting for approval.");
    if (code !== 4_902) throw cause;
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [{
        chainId,
        chainName: chain.name,
        nativeCurrency: chain.nativeCurrency,
        rpcUrls: [WALLET_RPC_URL],
        blockExplorerUrls: chain.blockExplorers?.default ? [chain.blockExplorers.default.url] : undefined,
      }],
    });
  }
}

function studioAccount(addressToMatch?: string) {
  try {
    const key = window.sessionStorage.getItem(STUDIO_SESSION_KEY);
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) return undefined;
    const account = createAccount(key as `0x${string}`);
    if (addressToMatch && account.address.toLowerCase() !== addressToMatch.toLowerCase()) return undefined;
    return account;
  } catch {
    return undefined;
  }
}

export function restoreStudioWallet(): ConnectedWallet | null {
  if (typeof window === "undefined") return null;
  const account = studioAccount();
  return account ? { kind: "studio", address: account.address.toLowerCase() } : null;
}

export async function connectWallet(kind: WalletKind): Promise<ConnectedWallet> {
  if (kind === "studio") {
    let account = studioAccount();
    if (!account) {
      const key = generatePrivateKey();
      window.sessionStorage.setItem(STUDIO_SESSION_KEY, key);
      account = createAccount(key);
    }
    return { kind, address: account.address.toLowerCase() };
  }
  const provider = browserProvider();
  const accounts = await provider.request({ method: "eth_requestAccounts" });
  if (!Array.isArray(accounts) || typeof accounts[0] !== "string" || !isAddress(accounts[0])) {
    throw new Error("The browser wallet did not return an account.");
  }
  await ensureStudionet(provider);
  activeBrowserProvider = provider;
  return { kind, address: getAddress(accounts[0]) };
}

async function writeClient(wallet: ConnectedWallet) {
  if (wallet.kind === "studio") {
    const account = studioAccount(wallet.address);
    if (!account) throw new Error("This temporary wallet ended with its browser tab. Create a new one to continue.");
    return createClient({ account, chain, endpoint: RPC_URL });
  }
  const provider = activeBrowserProvider ?? browserProvider();
  const accounts = await provider.request({ method: "eth_accounts" });
  if (!Array.isArray(accounts) || !accounts.some((item) => typeof item === "string" && item.toLowerCase() === wallet.address.toLowerCase())) {
    throw new Error("Your browser wallet account changed. Reconnect it before signing.");
  }
  await ensureStudionet(provider);
  activeBrowserProvider = provider;
  return createClient({ account: getAddress(wallet.address), chain, endpoint: RPC_URL, provider });
}

async function read(functionName: string, args: CalldataEncodable[] = []): Promise<unknown> {
  return readClient.readContract({
    address: address(), functionName, args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

function calldataAddress(value: string): CalldataAddress {
  return new CalldataAddress(hexToBytes(getAddress(value)));
}

export async function getContractInfo(): Promise<ContractInfo> {
  return parseContractInfo(await read("get_contract_info"));
}

export async function getRecentWorks(limit = 12): Promise<Work[]> {
  const result = await read("get_recent_works", [BigInt(limit)]);
  if (!Array.isArray(result)) throw new Error("GenLayer returned an invalid work list.");
  return result.map(parseWork);
}

export async function getWork(workId: number): Promise<Work> {
  return parseWork(await read("get_work", [BigInt(workId)]));
}

export async function getLicense(workId: number, version = 0): Promise<LicenseVersion> {
  // Explicit versions are immutable. Share in-flight reads between the workbench
  // and receipt, which otherwise make duplicate RPC calls on a check deep link.
  if (version === 0) return parseLicense(await read("get_license", [BigInt(workId), 0n]));
  const key = `${workId}:${version}`;
  const existing = licenseReads.get(key);
  if (existing) return existing;
  const result = read("get_license", [BigInt(workId), BigInt(version)])
    .then(parseLicense)
    .catch((cause) => { licenseReads.delete(key); throw cause; });
  licenseReads.set(key, result);
  return result;
}

export async function getRecentChecks(limit = 12): Promise<UseCheck[]> {
  const result = await read("get_recent_checks", [BigInt(limit)]);
  if (!Array.isArray(result)) throw new Error("GenLayer returned an invalid check list.");
  return result.map(parseUseCheck);
}

export async function getCheck(checkId: number): Promise<UseCheck> {
  return parseUseCheck(await read("get_check", [BigInt(checkId)]));
}

export async function getPermissionRequest(checkId: number): Promise<PermissionRequest> {
  return parsePermission(await read("get_permission_request", [BigInt(checkId)]));
}

function newReference(prefix: string): string {
  const random = new Uint8Array(8);
  crypto.getRandomValues(random);
  return `${prefix}-${Date.now().toString(36)}-${Array.from(random, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

export function getPendingAction(): PendingAction | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    if (!["publish", "terms", "check", "request", "respond"].includes(String(value.kind)) ||
        typeof value.hash !== "string" || (value.hash !== "" && !/^0x[0-9a-fA-F]{64}$/.test(value.hash)) ||
        typeof value.intentId !== "string" || !/^[A-Za-z0-9_.-]{8,72}$/.test(value.intentId) ||
        !Number.isSafeInteger(value.createdAt) || Number(value.createdAt) < 1 ||
        value.functionName !== METHODS[value.kind as keyof typeof METHODS] ||
        typeof value.argsJson !== "string" || value.argsJson.length > 12_000 ||
        typeof value.address !== "string" || !isAddress(value.address) ||
        typeof value.contractAddress !== "string" || !isAddress(value.contractAddress) ||
        value.contractAddress.toLowerCase() !== CONTRACT_ADDRESS.toLowerCase()) return null;
    const args = decodeArgs(value.argsJson);
    const lengths = { publish: 4, terms: 3, check: 8, request: 2, respond: 3 };
    if (args.length !== lengths[value.kind as keyof typeof lengths]) return null;
    if ((value.kind === "publish" || value.kind === "check") &&
        (typeof value.reference !== "string" || !/^[A-Za-z0-9_.-]{8,72}$/.test(value.reference))) return null;
    if ((value.kind === "publish" || value.kind === "check") && args[0] !== value.reference) return null;
    if (value.kind === "terms" &&
        (!Number.isSafeInteger(value.workId) || Number(value.workId) < 1 ||
         !Number.isSafeInteger(value.expectedVersion) || Number(value.expectedVersion) < 1 ||
         typeof value.expectedTerms !== "string")) return null;
    if (value.kind === "terms" &&
        (args[0] !== BigInt(Number(value.workId)) || args[1] !== BigInt(Number(value.expectedVersion)) ||
         args[2] !== value.expectedTerms)) return null;
    if ((value.kind === "request" || value.kind === "respond") &&
        (!Number.isSafeInteger(value.checkId) || Number(value.checkId) < 1 ||
         typeof value.expectedNote !== "string" ||
         !["PENDING", "APPROVED", "DECLINED"].includes(String(value.expectedStatus)))) return null;
    if ((value.kind === "request" || value.kind === "respond") &&
        (args[0] !== BigInt(Number(value.checkId)) ||
         args[value.kind === "request" ? 1 : 2] !== value.expectedNote)) return null;
    if (value.kind === "request" && value.expectedStatus !== "PENDING") return null;
    if (value.kind === "respond" && value.expectedStatus === "PENDING") return null;
    if (value.kind === "respond" && args[1] !== (value.expectedStatus === "APPROVED")) return null;
    return value as PendingAction;
  } catch {
    return null;
  }
}

function forgetPending(intentId: string): void {
  if (getPendingAction()?.intentId === intentId) window.sessionStorage.removeItem(PENDING_KEY);
}

export function permissionReadbackMatches(
  kind: "request" | "respond", address: string, expectedStatus: string, expectedNote: string,
  permission: PermissionRequest,
): boolean {
  if (kind === "request") {
    // A publisher may answer before the requester resumes a delayed readback.
    // The immutable request note and requester still prove the request landed.
    return permission.status !== "NONE" && permission.requester?.toLowerCase() === address.toLowerCase() &&
      permission.requestNote === expectedNote;
  }
  return permission.publisher?.toLowerCase() === address.toLowerCase() &&
    permission.status === expectedStatus && permission.responseNote === expectedNote;
}

async function successfulFinality(hash: TransactionHash): Promise<void> {
  let waitError: unknown;
  try {
    await readClient.waitForTransactionReceipt({
      hash, interval: 3_000, retries: 400, status: TransactionStatus.FINALIZED,
    });
  } catch (cause) {
    waitError = cause;
  }
  let transaction: Awaited<ReturnType<typeof readClient.getTransaction>>;
  try {
    transaction = await readClient.getTransaction({ hash });
  } catch (cause) {
    throw waitError ?? cause;
  }
  const state = classifyTransaction(transaction);
  if (state === "failed") throw new FinalizedActionError("The transaction finalized without successful contract execution. Nothing was saved.");
  if (state === "pending") throw new Error("StudioNet has not finalized this transaction yet. Resume it instead of submitting again.");
  // On an RPC node that omits normalized execution fields, exact contract readback is still required.
}

async function readCompleted(pending: PendingAction): Promise<CompletedAction> {
  switch (pending.kind) {
    case "publish": {
      const work = parseWork(await read("get_work_by_reference", [calldataAddress(pending.address), pending.reference!]));
      return { kind: "publish", hash: pending.hash, work };
    }
    case "terms": {
      const work = await getWork(pending.workId!);
      if (work.publisher.toLowerCase() !== pending.address.toLowerCase()) {
        throw new Error("This terms version belongs to a different publisher wallet.");
      }
      const license = await getLicense(pending.workId!, pending.expectedVersion! + 1);
      if (JSON.stringify(license.clauses) !== pending.expectedTerms) {
        throw new Error("The finalized terms do not match this submission.");
      }
      return { kind: "terms", hash: pending.hash, license };
    }
    case "check": {
      const check = parseUseCheck(await read("get_check_by_reference", [calldataAddress(pending.address), pending.reference!]));
      return { kind: "check", hash: pending.hash, check: { ...check, transactionHash: pending.hash || undefined } };
    }
    case "request":
    case "respond": {
      const permission = await getPermissionRequest(pending.checkId!);
      if (!permissionReadbackMatches(pending.kind, pending.address, pending.expectedStatus!, pending.expectedNote!, permission)) {
        throw new Error("The permission record does not match this submission yet.");
      }
      return { kind: pending.kind, hash: pending.hash, permission };
    }
  }
}

export async function resumePendingAction(onUpdate?: OnUpdate): Promise<CompletedAction> {
  const pending = getPendingAction();
  if (!pending) throw new Error("No pending StudioNet action was found in this browser tab.");
  if (pending.hash) {
    onUpdate?.("finalizing", pending.hash);
    try {
      await successfulFinality(pending.hash);
    } catch (cause) {
      if (cause instanceof FinalizedActionError) {
        // A retry may lose the one-shot state transition to the first broadcast.
        // Accept only exact finalized readback, never the failed retry receipt alone.
        try {
          const completed = await readCompleted({ ...pending, hash: "" });
          forgetPending(pending.intentId);
          return completed;
        } catch { /* No matching finalized first submission was found. */ }
        forgetPending(pending.intentId);
      }
      throw cause;
    }
    onUpdate?.("reading", pending.hash);
  } else {
    onUpdate?.("recovering");
  }
  let result: CompletedAction | undefined;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      result = await readCompleted(pending);
      break;
    } catch {
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1_500));
    }
  }
  if (!result) throw new Error(pending.hash
    ? "The transaction finalized, but readback is delayed. Resume it; do not submit again."
    : "The network did not confirm a transaction hash or a finalized record. Wait, then check again before retrying the identical submission.");
  forgetPending(pending.intentId);
  return result;
}

export async function retryUncertainAction(wallet: ConnectedWallet, onUpdate?: OnUpdate): Promise<CompletedAction> {
  const pending = getPendingAction();
  if (!pending || pending.hash) throw new Error("There is no hashless submission to retry.");
  if (wallet.address.toLowerCase() !== pending.address.toLowerCase()) {
    throw new Error("Reconnect the wallet that made the original submission.");
  }
  onUpdate?.("recovering");
  try {
    const completed = await readCompleted(pending);
    forgetPending(pending.intentId);
    return completed;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (pending.kind === "publish" && !/WORK_NOT_FOUND/.test(message)) throw cause;
    if (pending.kind === "check" && !/CHECK_NOT_FOUND/.test(message)) throw cause;
    if (pending.kind === "terms" && !/LICENSE_VERSION_NOT_FOUND/.test(message)) throw cause;
    if (pending.kind === "request" || pending.kind === "respond") {
      const permission = await getPermissionRequest(pending.checkId!);
      const canRetry = pending.kind === "request"
        ? permission.status === "NONE"
        : permission.status === "PENDING";
      if (!canRetry) throw new Error("The permission record changed. Do not retry this action without reviewing it.");
    }
  }
  if (Date.now() - pending.createdAt < 120_000) {
    throw new Error("Wait at least two minutes for the first submission to settle, then retry this same reference.");
  }
  const client = await writeClient(wallet);
  onUpdate?.("signing");
  const hash = asHash(await client.writeContract({
    address: address(), functionName: pending.functionName, args: decodeArgs(pending.argsJson),
    leaderOnly: false, value: 0n,
  }));
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...pending, hash }));
  onUpdate?.("submitted", hash);
  return resumePendingAction(onUpdate);
}

async function submitAction(
  wallet: ConnectedWallet,
  pending: Omit<PendingAction, "hash" | "address" | "contractAddress" | "intentId" | "createdAt" | "functionName" | "argsJson">,
  functionName: string,
  args: CalldataEncodable[],
  onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  if (getPendingAction()) throw new Error("A transaction is already pending. Resume it before starting another.");
  if (functionName !== METHODS[pending.kind]) throw new Error("Incorrect method for this action.");
  const client = await writeClient(wallet);
  const action: PendingAction = {
    ...pending, hash: "", intentId: newReference("intent"), createdAt: Date.now(),
    functionName, argsJson: encodeArgs(args), address: wallet.address, contractAddress: address(),
  };
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify(action));
  onUpdate?.("signing");
  let hash: TransactionHash;
  try {
    hash = asHash(await client.writeContract({
      address: address(), functionName, args, leaderOnly: false, value: 0n,
    }));
  } catch (cause) {
    if (isExplicitWalletRejection(cause)) forgetPending(action.intentId);
    throw cause;
  }
  window.sessionStorage.setItem(PENDING_KEY, JSON.stringify({ ...action, hash }));
  onUpdate?.("submitted", hash);
  return resumePendingAction(onUpdate);
}

export async function publishWork(
  wallet: ConnectedWallet,
  input: { title: string; assetUrl: string; clauses: string[] },
  onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  const reference = newReference("publish");
  return submitAction(wallet, { kind: "publish", reference }, "publish_work", [
    reference, input.title.trim(), normalizeAssetUrl(input.assetUrl), JSON.stringify(input.clauses),
  ], onUpdate);
}

export async function publishTermsVersion(
  wallet: ConnectedWallet,
  work: Work,
  clauses: string[],
  onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  return submitAction(wallet, {
    kind: "terms", workId: work.workId, expectedVersion: work.currentVersion,
    expectedTerms: JSON.stringify(clauses),
  }, "publish_terms_version", [BigInt(work.workId), BigInt(work.currentVersion), JSON.stringify(clauses)], onUpdate);
}

export async function submitUseCheck(
  wallet: ConnectedWallet,
  work: Work,
  input: { useKind: UseKind; isModified: boolean; willCredit: boolean; channel: string; description: string },
  onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  const reference = newReference("check");
  return submitAction(wallet, { kind: "check", reference }, "check_use", [
    reference, BigInt(work.workId), BigInt(work.currentVersion), input.useKind,
    input.isModified, input.willCredit, input.channel.trim(), input.description.trim(),
  ], onUpdate);
}

export async function requestPermission(
  wallet: ConnectedWallet, checkId: number, note: string, onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  const expectedNote = note.trim().replace(/\s+/g, " ");
  return submitAction(wallet, { kind: "request", checkId, expectedStatus: "PENDING", expectedNote }, "request_permission", [BigInt(checkId), expectedNote], onUpdate);
}

export async function respondPermission(
  wallet: ConnectedWallet, checkId: number, approve: boolean, note: string, onUpdate?: OnUpdate,
): Promise<CompletedAction> {
  const expectedNote = note.trim().replace(/\s+/g, " ");
  return submitAction(wallet, {
    kind: "respond", checkId, expectedStatus: approve ? "APPROVED" : "DECLINED", expectedNote,
  }, "respond_permission", [BigInt(checkId), approve, expectedNote], onUpdate);
}
