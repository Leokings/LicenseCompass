const DEFAULT_RPC_URL = "https://studio.genlayer.com/api";
const DEFAULT_CONTRACT_ADDRESS = "0xc7e4B4015dC4759Fc47ec78172a96b84f6ce2Ac0";

export const WALLET_RPC_URL = DEFAULT_RPC_URL;
export const RPC_URL = import.meta.env.VITE_GENLAYER_RPC_URL?.trim() ||
  (typeof window === "undefined" ? DEFAULT_RPC_URL : `${window.location.origin}/api/rpc`);
export const CONTRACT_ADDRESS = import.meta.env.VITE_LICENSE_COMPASS_CONTRACT_ADDRESS?.trim() || DEFAULT_CONTRACT_ADDRESS;
export const EXPLORER_URL = "https://genlayer-explorer.vercel.app";

export function isContractConfigured(): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(CONTRACT_ADDRESS);
}

export function transactionExplorerUrl(hash: string): string {
  return `${EXPLORER_URL}/tx/${hash}`;
}

export function contractExplorerUrl(): string {
  return `${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`;
}
