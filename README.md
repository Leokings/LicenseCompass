# License Compass

License Compass helps a person compare a *specific intended use* with plain-language terms published by a wallet. A GenLayer intelligent contract stores versioned terms and uses validator consensus to return **within terms**, **outside terms**, or **unclear**, with numbered clause citations. A separate on-chain permission request lets the visitor ask the publishing wallet for a specific exception.

This is an interpretation aid, **not** proof that the publishing wallet owns the work, legal advice, or legal clearance. The terms and use descriptions are public on StudioNet.

## Try it

- App: https://license-compass-theta.vercel.app/
- Practice work: https://license-compass-theta.vercel.app/demo-work.html
- StudioNet contract: https://genlayer-explorer.vercel.app/address/0xe7A57dE336f6eA04154cC55eFa334F89301f2287
- Deployment transaction: https://genlayer-explorer.vercel.app/tx/0x7eaa3cdf83c89fdec3058d10d24c05954078c9e337762c983a451e2e05c17ffb

For a first visit, open the app, select a published work, read its current numbered terms, connect an instant Studio wallet or a StudioNet-compatible browser wallet, describe **your own** intended use, and submit a check. Wait for FINALIZED and inspect the saved receipt. If the result is outside or unclear, the requester can ask the publishing wallet for permission. Publishers can connect a wallet, publish a public HTTPS work and one clause per line, and later publish a new version without overwriting old assessments.

Permission requests do **not** send a notification to the publisher. After requesting, use **Copy check link** on the receipt and send it to the publishing wallet holder; they can open that link, connect the publishing wallet, and respond. If a terms or receipt read is temporarily rate-limited, use its section's retry button. A rejected browser-wallet signature is not treated as a pending on-chain transaction.

The practice work is a small illustration created for this demo and is now published as work #1. It is not a claim that License Compass verifies ownership.

## Verified StudioNet trail

- [Contract deployment](https://genlayer-explorer.vercel.app/tx/0x7eaa3cdf83c89fdec3058d10d24c05954078c9e337762c983a451e2e05c17ffb) — FINALIZED, successful contract execution.
- [Northbound work and terms v1](https://genlayer-explorer.vercel.app/tx/0xf796f6a6ab10e8d26eceba13c0e8f61042cf1af480881317a917cd978d185a62) — FINALIZED; work #1 with three clauses.
- [Credited noncommercial resize check](https://genlayer-explorer.vercel.app/tx/0x23dcac44b655c64b4c299c0c6136f647c168d4fa16dad02e631410fc0a8648ec) — FINALIZED; check #1, `WITHIN_TERMS`, clauses 1 and 2.
- [Paid advertising check](https://genlayer-explorer.vercel.app/tx/0x108ed51433f1f5b9254636cb6819cef4ab3ad9deaf81bedffcf26b8abc0e3ae9) — FINALIZED; check #2, `OUTSIDE_TERMS`, clause 3.
- [Visitor permission request](https://genlayer-explorer.vercel.app/tx/0x9d95ee3af7e60748e1d51897bd5552aad72baf7234854dfd1b7b61c2ba19de25) and [publisher decline](https://genlayer-explorer.vercel.app/tx/0xc6cefb3dcbc92af0ad08e1f59f9a8d1be882287fff4a592850c989323c156d55) — both FINALIZED; check #2 now reads `DECLINED` after a new browser load. No commercial permission was granted.

Screenshots from the public app: [finalized decision](docs/live-decision.png) and [declined permission after reload](docs/live-permission-response.png). The transaction links above are the primary evidence.

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
- Exact license-version reads are reused between the workbench and a check receipt, and an older check link selects its own work rather than leaving a different work visible. If the recent-check list fails to load, the work catalog and direct check lookup remain usable.
- Permission requests are requester-only and one per check; only the publishing wallet may respond. The response never changes the original check digest.
- Work URLs are pointers; the contract does **not** fetch and authenticate their contents. It cannot prove ownership, third-party rights, fair use, actual subsequent use, or legal enforceability. Ambiguous language can still produce an imperfect AI assessment.
- StudioNet's public RPC can rate-limit requests. The same-origin Vercel relay restricts methods, request size, and origin, and surfaces upstream HTTP failures; it is a demo relay, not production-grade abuse protection. A transaction that is already pending must be resumed, not repeated.

See [architecture](docs/ARCHITECTURE.md) for the trust boundary and [contract](contracts/license_compass.py) for the exact state transitions.
