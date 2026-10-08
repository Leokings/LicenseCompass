# License Compass

License Compass helps a person compare a *specific intended use* with plain-language terms published by a wallet. A GenLayer intelligent contract stores versioned terms and uses validator consensus to return **within terms**, **outside terms**, or **unclear**, with numbered clause citations. A separate on-chain permission request lets the visitor ask the publishing wallet for a specific exception.

This is an interpretation aid, **not** proof that the publishing wallet owns the work, legal advice, or legal clearance. The terms and use descriptions are public on StudioNet.

## Try it

- App: https://license-compass-theta.vercel.app/
- Practice work: https://license-compass-theta.vercel.app/demo-work.html
- StudioNet contract (v0.3.0): https://genlayer-explorer.vercel.app/address/0xc7e4B4015dC4759Fc47ec78172a96b84f6ce2Ac0
- Deployment transaction: https://genlayer-explorer.vercel.app/tx/0x93bbca2d4f2739d2d64e78eab3f10d7443844bf0425ced057e1e03463b8116fa

For a first visit, open the app, select a published work, read its current numbered terms, connect an instant Studio wallet or a StudioNet-compatible browser wallet, describe **your own** intended use, and submit a check. Wait for FINALIZED and inspect the saved receipt. If the result is outside or unclear, the requester can ask the publishing wallet for permission. Publishers can connect a wallet, publish a public HTTPS work and one clause per line, and later publish a new version without overwriting old assessments.

Permission requests do **not** send a notification to the publisher. After requesting, use **Copy check link** on the receipt and send it to the publishing wallet holder; they can open that link, connect the publishing wallet, and respond. If a terms or receipt read is temporarily rate-limited, use its section's retry button. A rejected browser-wallet signature is not treated as a pending on-chain transaction.

The practice work is a small illustration created for this demo and is now published as work #1. It is not a claim that License Compass verifies ownership.

## Verified StudioNet trail

- [v0.3.0 contract deployment](https://genlayer-explorer.vercel.app/tx/0x93bbca2d4f2739d2d64e78eab3f10d7443844bf0425ced057e1e03463b8116fa) — FINALIZED, successful contract execution.
- [Northbound work and terms v1](https://genlayer-explorer.vercel.app/tx/0xa203157851f00c29b28a73e363bcb58c64d89a5e09f09ac6defd89841794942f) — FINALIZED; work #1 with three clauses, published with a browser-extension wallet.
- [Credited noncommercial resize check](https://genlayer-explorer.vercel.app/tx/0x587ed0b5e7af96b33d8dfc70dd2bbf3ca42390e0023db0b602c755ffefeea892) — FINALIZED; browser-extension signed check #1, `WITHIN_TERMS`, read back from the app after reload.
- [Paid advertising check](https://genlayer-explorer.vercel.app/tx/0xb6c885e5babfb462205778c3a8d46ee7a2a3606c6404014281bdbf0a68609f8f) — FINALIZED; separate visitor wallet, check #2, `OUTSIDE_TERMS`, clause 3.
- [Visitor permission request](https://genlayer-explorer.vercel.app/tx/0xaf04f30f43fd4f08554c4670666e371f7f86a5fe76ae2875f8cfb3ab83aa6965) — FINALIZED; check #2 changed to `PENDING`.
- [Publisher decline](https://genlayer-explorer.vercel.app/tx/0x3515f680377bef719d063fefa820a6981c601519af5a1cc837b85537b8f65385) — FINALIZED from the publishing browser wallet; check #2 reads `DECLINED` after a fresh browser load. No commercial permission was granted.

Read the finalized results in the app: [within-terms check #1](https://license-compass-theta.vercel.app/?check=1#receipt) and [outside-terms check #2 with declined permission](https://license-compass-theta.vercel.app/?check=2#receipt).

The earlier [v0.1.0 contract](https://genlayer-explorer.vercel.app/address/0xe7A57dE336f6eA04154cC55eFa334F89301f2287) is superseded, not deleted. A [failed live browser-wallet check](https://genlayer-explorer.vercel.app/tx/0x223b5c885427950d309ffd5c425e61c1faeaa5c7ea3afd1ac037f2291f1ed3b0) on that contract exposed a malformed model citation and validator disagreement; it did **not** create a check. The v0.3.0 contract adds bounded model-output repair and safer Unicode prompt sizing, with direct and five-validator regression tests. Historical screenshots in `docs/` show the superseded contract and are not current-deployment evidence.

## Local development

Requires Node.js 24, Python with `gltest`, and the GenLayer tools used by the scripts below.

```sh
npm install
npm run dev
npm run verify
```

`npm run contract:sim` starts local GLSim; while it is running, `npm run contract:test:integration` runs the five-validator contract flow. The deployed StudioNet address is the app default. The browser uses a same-origin `/api/rpc` relay in production and a Vite proxy locally, while browser-wallet network setup uses the public StudioNet RPC. `VITE_LICENSE_COMPASS_CONTRACT_ADDRESS` and `VITE_GENLAYER_RPC_URL` override defaults for another environment. See `.env.example`.

## Guarantees and limits

- A publisher-only version change cannot rewrite earlier terms. Checks pin the current version and its digest.
- Only GenLayer's contract judgment can set an outcome; the browser cannot submit its own verdict. Validators independently assess the same terms/use and support for the leader's citation.
- Duplicate publication/check references are rejected. The frontend saves each write intent *before* broadcasting. If the RPC never returns a hash, it first checks exact finalized state and only offers an identical retry after a delay; the contract's one-shot transitions prevent duplicate effects.
- A malformed LLM response gets one bounded repair attempt; a second invalid answer still fails closed. Numeric-string clause IDs are accepted only when they unambiguously name a published clause. This reduces, but cannot eliminate, model or validator disagreement.
- Exact license-version reads are reused between the workbench and a check receipt, and an older check link selects its own work rather than leaving a different work visible. If the recent-check list fails to load, the work catalog and direct check lookup remain usable.
- Permission requests are requester-only and one per check; only the publishing wallet may respond. The response never changes the original check digest.
- Work URLs are pointers; the contract does **not** fetch and authenticate their contents. It cannot prove ownership, third-party rights, fair use, actual subsequent use, or legal enforceability. Ambiguous language can still produce an imperfect AI assessment.
- StudioNet's public RPC can rate-limit requests. The same-origin Vercel relay restricts methods, request size, and origin, and surfaces upstream HTTP failures; it is a demo relay, not production-grade abuse protection. A transaction that is already pending must be resumed, not repeated.

See [architecture](docs/ARCHITECTURE.md) for the trust boundary and [contract](contracts/license_compass.py) for the exact state transitions.
