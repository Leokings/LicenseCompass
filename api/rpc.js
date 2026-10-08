const UPSTREAM_RPC = "https://studio.genlayer.com/api";
const MAX_REQUEST_BYTES = 65_536;
const MAX_RESPONSE_BYTES = 2_000_000;
const ALLOWED_METHODS = new Set([
  "gen_call",
  "eth_chainId",
  "eth_getTransactionCount",
  "eth_gasPrice",
  "eth_estimateGas",
  "eth_getBalance",
  "eth_getBlockByNumber",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_sendRawTransaction",
]);

export function validateRpcPayload(body) {
  if (!body || Array.isArray(body) || typeof body !== "object") return "A single JSON-RPC request is required.";
  if (body.jsonrpc !== "2.0" || !ALLOWED_METHODS.has(body.method)) return "This JSON-RPC method is not supported.";
  if (!Array.isArray(body.params) || body.params.length > 8) return "Invalid JSON-RPC parameters.";
  if (!(typeof body.id === "number" || typeof body.id === "string")) return "Invalid JSON-RPC request ID.";
  return null;
}

export default async function handler(request, response) {
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  if (request.method !== "POST") return response.status(405).json({ error: "POST required." });

  // This is a public demo relay, not an arbitrary browser-accessible RPC endpoint.
  // Origin is only a browser boundary; the upstream can still be accessed directly.
  const origin = request.headers.origin;
  if (!origin || origin !== `https://${request.headers.host}`) {
    return response.status(403).json({ error: "Same-origin requests only." });
  }
  const contentLength = Number(request.headers["content-length"] ?? 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_REQUEST_BYTES) {
    return response.status(413).json({ error: "JSON-RPC request is too large." });
  }
  let body;
  try {
    body = typeof request.body === "string" ? JSON.parse(request.body) : request.body;
  } catch {
    return response.status(400).json({ error: "Invalid JSON." });
  }
  const error = validateRpcPayload(body);
  if (error) return response.status(400).json({ error });
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized) > MAX_REQUEST_BYTES) {
    return response.status(413).json({ error: "JSON-RPC request is too large." });
  }

  try {
    const upstream = await fetch(UPSTREAM_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: serialized,
      signal: AbortSignal.timeout(60_000),
    });
    const retryAfter = upstream.headers.get("retry-after");
    if (retryAfter) response.setHeader("Retry-After", retryAfter);
    const reply = await upstream.text();
    if (Buffer.byteLength(reply) > MAX_RESPONSE_BYTES) {
      return response.status(502).json({ error: "StudioNet response was too large." });
    }
    if (!upstream.ok && !reply.trim().startsWith("{")) {
      return response.status(upstream.status).json({ error: `StudioNet RPC returned HTTP ${upstream.status}.` });
    }
    return response.status(upstream.status).send(reply);
  } catch {
    return response.status(502).json({ error: "StudioNet RPC is temporarily unreachable. Check the saved action before retrying." });
  }
}
