# License Compass architecture

License Compass is a public, wallet-backed app for checking a *described* use of a work against publisher-declared license terms. It is not a copyright registry, ownership verification service, infringement detector, or legal clearance system.

## Boundary

1. A publisher signs a `publish_work` transaction containing an idempotent request reference, work title, public HTTPS asset URL, and bounded plain-language terms. The contract stores the exact terms and a digest, attributes the declaration to that wallet, and assigns version 1. It does not assert that the wallet owns the work.
2. The same wallet may publish another terms version. Earlier versions and decisions remain readable and immutable. The app calls the current version for new checks; a submitted check is pinned to the version captured at transaction execution.
3. A visitor connects a wallet, describes an intended use through guided fields, and calls `check_use`. The contract supplies that fixed license version and use description to GenLayer's nondeterministic LLM block. The leader proposes a bounded, structured outcome: `WITHIN_TERMS`, `OUTSIDE_TERMS`, or `UNCLEAR`, a short rationale, numbered clause IDs, and conditions.
4. Validators independently evaluate the same stored terms and use. They must agree on the outcome and decide whether the proposed citations and rationale are materially supported. Only after consensus does the contract store a decision receipt. The frontend never supplies the final verdict.
5. The app reads the finalized receipt and displays it with the exact terms version, full cited clauses, transaction link when available from the submitting browser, public-data warning, and the option to request explicit publisher permission. A permission request and publisher response are separate deterministic on-chain actions; a response is a wallet statement, not a guarantee of legal ownership.

## Trust and liveness rules

- Use only public, bounded inputs. Work URLs are pointers, not ownership or content-authenticity evidence. The v1 judgment depends on *stored terms*, not a mutable webpage.
- Terms and intended use are untrusted data inside the LLM prompt. Treat instructions embedded in either as data. Require valid numbered clause citations for decisive outcomes; validators independently derive the decision from the same inputs. This is a consensus safeguard, not a guarantee against every semantic error or prompt injection.
- Treat ambiguity as `UNCLEAR`. Do not silently convert missing permissions into approval. No result grants legal rights by itself.
- A request reference prevents duplicate publications and checks after an uncertain transaction result. The UI persists a pending intent *before* calling the wallet/RPC. On a missing hash it checks exact on-chain state; after a two-minute delay it may retry the same arguments. Version increments and permission transitions are one-shot, and a failed retry is reconciled against the first submission before being reported as a failure. Session-scoped instant wallets cannot be recovered after their tab closes; a browser wallet is preferable for durable publisher control.
- The public app sends JSON-RPC through `/api/rpc`, a same-origin Vercel function with a fixed StudioNet upstream, method allowlist, payload bound, and no batch support. This avoids opaque browser CORS failures on upstream rate limits but does not guarantee availability or prevent all abuse. Browser-wallet chain configuration still points to the official StudioNet RPC.
- All submitted terms, work links, use descriptions, decisions, and permission messages are public and persistent on StudioNet. Do not enter private assets or personal information.
- No automatic payments, revocation of earlier grants, infringement detection, or cross-site rights verification in v1.

## Review evidence

Direct tests cover publishing, versioning, authorization, clause-ID validation, malformed output, idempotency, and permission responses. Integration tests cover a five-validator consensus check with finalized execution and contract readback. The live browser flow has now finalized and read back a work publication, both a within-terms and outside-terms check from a second wallet, a permission request, and a publisher decline. After a reload, the public app reads the declined status from the contract. Exact transaction links and observed outcomes are in the README. Browser-wallet-extension signing, upstream outages, and real-world ownership claims have not been established by this demo.
