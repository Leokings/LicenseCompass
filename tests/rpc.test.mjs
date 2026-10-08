import { describe, expect, it } from "vitest";
import { validateRpcPayload } from "../api/rpc.js";

describe("public RPC relay boundary", () => {
  it("accepts only the narrow methods needed by the app", () => {
    expect(validateRpcPayload({ jsonrpc: "2.0", id: 1, method: "gen_call", params: [] })).toBeNull();
    expect(validateRpcPayload({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: ["0x01"] })).toBeNull();
    expect(validateRpcPayload({ jsonrpc: "2.0", id: 1, method: "eth_sendTransaction", params: [] })).toMatch(/not supported/);
    expect(validateRpcPayload([{ jsonrpc: "2.0", id: 1, method: "gen_call", params: [] }])).toMatch(/single/);
  });
});
