import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import type { ConnectedWallet, ContractInfo, LicenseVersion, PermissionRequest, UseCheck, UseKind, WalletKind, Work } from "./types";
import { CONTRACT_ADDRESS, contractExplorerUrl, isContractConfigured, transactionExplorerUrl } from "./lib/config";
import {
  connectWallet, getCheck, getContractInfo, getLicense, getPendingAction,
  getPermissionRequest, getRecentChecks, getRecentWorks, getWork,
  publishTermsVersion, publishWork, requestPermission, respondPermission,
  restoreStudioWallet, resumePendingAction, retryUncertainAction, submitUseCheck,
  type ActionPhase, type CompletedAction,
} from "./lib/genlayer";

const OUTCOME_COPY = {
  WITHIN_TERMS: { label: "Appears within the terms", icon: "↗", note: "Only for the use you described, subject to every stated condition." },
  OUTSIDE_TERMS: { label: "Outside the stated terms", icon: "↘", note: "Ask the publisher for permission before proceeding." },
  UNCLEAR: { label: "Needs a human answer", icon: "?", note: "The published terms or use details do not establish a clear answer." },
} as const;

function shortAddress(value: string): string {
  return value.length > 16 ? `${value.slice(0, 6)}…${value.slice(-4)}` : value;
}

function shortDigest(value: string): string {
  return value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value;
}

function dateLabel(value: number): string {
  return value ? new Date(value * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";
}

function errorMessage(cause: unknown, fallback: string): string {
  const message = cause instanceof Error ? cause.message : fallback;
  return /failed to fetch|networkerror|\b429\b|rate.?limit|StudioNet RPC is temporarily unreachable/i.test(message)
    ? "StudioNet is temporarily unreachable or rate-limited. Wait a few minutes, then retry the catalog; do not repeat a pending transaction."
    : message;
}

function clausesFromText(value: string): string[] {
  const clauses = value.split(/\r?\n/).map((line) => line.trim().replace(/\s+/g, " ")).filter(Boolean);
  if (clauses.length < 1 || clauses.length > 8) throw new Error("Write between 1 and 8 license clauses, one per line.");
  if (clauses.some((clause) => clause.length < 12 || clause.length > 360)) {
    throw new Error("Each clause needs 12–360 characters.");
  }
  if (new Set(clauses.map((clause) => clause.toLowerCase())).size !== clauses.length) {
    throw new Error("Remove duplicate clauses before publishing.");
  }
  return clauses;
}

function CompassMark({ small = false }: { small?: boolean }) {
  return <span className={small ? "compass-mark compass-mark--small" : "compass-mark"} aria-hidden="true"><span>✦</span></span>;
}

function WalletControls({
  wallet, busy, onConnect, onDisconnect,
}: {
  wallet: ConnectedWallet | null;
  busy: boolean;
  onConnect: (kind: WalletKind) => void;
  onDisconnect: () => void;
}) {
  return wallet ? (
    <div className="wallet-pill">
      <span className="wallet-pill__dot" />
      <span>{wallet.kind === "studio" ? "Studio wallet" : "Browser wallet"} <strong>{shortAddress(wallet.address)}</strong></span>
      <button type="button" onClick={onDisconnect} disabled={busy} aria-label="Change wallet">Change</button>
    </div>
  ) : (
    <div className="wallet-choices">
      <button type="button" className="button button--dark" onClick={() => onConnect("studio")} disabled={busy}>✦ Instant Studio wallet</button>
      <button type="button" className="button button--outline" onClick={() => onConnect("browser")} disabled={busy}>Connect browser wallet</button>
    </div>
  );
}

function CheckReceipt({
  check, license, permission, wallet, busy, evidenceError, onRetryEvidence, onRequest, onRespond,
}: {
  check: UseCheck;
  license: LicenseVersion | null;
  permission: PermissionRequest | null;
  wallet: ConnectedWallet | null;
  busy: boolean;
  evidenceError: string;
  onRetryEvidence: () => void;
  onRequest: (note: string) => void;
  onRespond: (approve: boolean, note: string) => void;
}) {
  const [requestNote, setRequestNote] = useState("");
  const [responseNote, setResponseNote] = useState("");
  const [linkMessage, setLinkMessage] = useState("");
  const outcome = OUTCOME_COPY[check.outcome];
  const isRequester = wallet?.address.toLowerCase() === check.requester.toLowerCase();
  const isPublisher = permission?.publisher && wallet?.address.toLowerCase() === permission.publisher.toLowerCase();
  const citedClauses = license ? check.clauseIds.map((id) => ({ id, text: license.clauses[id - 1] })).filter((item) => item.text) : [];

  async function copyCheckLink() {
    const url = `${window.location.origin}/?check=${check.checkId}#receipt`;
    try {
      await navigator.clipboard.writeText(url);
      setLinkMessage("Link copied. Send it to the publishing wallet if you requested permission.");
    } catch {
      setLinkMessage(`Copy this link from your address bar: ${url}`);
    }
  }

  return (
    <section className={`receipt receipt--${check.outcome.toLowerCase()}`} aria-labelledby="receipt-title">
      <div className="receipt__topline"><span>FINALIZED USE CHECK #{check.checkId}</span><span>TERMS v{check.licenseVersion}</span></div>
      <div className="receipt__headline"><span className="receipt__icon" aria-hidden="true">{outcome.icon}</span><div><p className="eyebrow">Based on the publisher-declared terms</p><h2 id="receipt-title">{outcome.label}</h2></div></div>
      <p className="receipt__rationale">{check.rationale}</p>
      <div className="receipt__grid">
        <div><span>Described use</span><strong>{check.useKind.toLowerCase()} · {check.channel}</strong><p>{check.description}</p></div>
        <div><span>What this means</span><strong>{outcome.note}</strong><p>{check.isModified ? "Modified work" : "Unmodified work"} · {check.willCredit ? "Credit planned" : "No credit planned"}</p></div>
      </div>
      <div className="receipt__evidence">
        <h3>Clauses considered</h3>
        {!license ? <p>Loading the exact license version used for this check…</p> : citedClauses.length ? citedClauses.map((item) => <blockquote key={item.id}><b>{String(item.id).padStart(2, "0")}</b><span>{item.text}</span></blockquote>) : <p>No clause decisively covers this use. The published terms do not settle it.</p>}
      </div>
      {evidenceError ? <div className="receipt__read-error" role="alert"><span>{evidenceError}</span><button type="button" onClick={onRetryEvidence} disabled={busy}>Retry receipt evidence ↻</button></div> : null}
      {check.conditions.length > 0 ? <div className="receipt__conditions"><h3>Conditions or next steps</h3><ul>{check.conditions.map((item) => <li key={item}>{item}</li>)}</ul></div> : null}
      <div className="receipt__proof">
        <span>Terms digest <code title={check.termsDigest}>{shortDigest(check.termsDigest)}</code></span>
        <span>Decision digest <code title={check.checkDigest}>{shortDigest(check.checkDigest)}</code></span>
        <span>{dateLabel(check.createdAt)}</span>
        {check.transactionHash ? <a href={transactionExplorerUrl(check.transactionHash)} target="_blank" rel="noopener noreferrer">View transaction ↗</a> : null}
        <button type="button" onClick={() => void copyCheckLink()}>Copy check link ↗</button>
      </div>
      {linkMessage ? <p className="receipt__link-message" role="status">{linkMessage}</p> : null}
      <p className="receipt__caveat">This is an assessment of the described use against one version of terms. It does not verify copyright ownership, actual use, third-party rights, fair use, or legal permission.</p>
      {permission?.status && permission.status !== "NONE" ? (
        <div className={`permission-status permission-status--${permission.status.toLowerCase()}`}>
          <strong>Publisher response: {permission.status.toLowerCase()}</strong>
          <p>{permission.requestNote}</p>
          {permission.responseNote ? <p><b>Reply:</b> {permission.responseNote}</p> : null}
          <small>The reply is a statement from the wallet that published these terms; ownership is not independently verified.</small>
          {permission.status === "PENDING" ? <small>The app does not notify the publisher. Share this check link with them so they can respond.</small> : null}
        </div>
      ) : null}
      {check.outcome !== "WITHIN_TERMS" && permission?.status === "NONE" && isRequester ? (
        <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onRequest(requestNote); }}>
          <label htmlFor="request-note">Ask the publisher for explicit permission</label>
          <textarea id="request-note" minLength={10} maxLength={280} value={requestNote} onChange={(event) => setRequestNote(event.target.value)} placeholder="Describe exactly which use you want them to approve." required />
          <button type="submit" className="button button--accent" disabled={busy || requestNote.trim().length < 10}>Send permission request ↗</button>
        </form>
      ) : null}
      {permission?.status === "PENDING" && isPublisher ? (
        <form className="inline-form" onSubmit={(event) => { event.preventDefault(); onRespond(true, responseNote); }}>
          <label htmlFor="response-note">Respond as the publishing wallet</label>
          <textarea id="response-note" minLength={10} maxLength={280} value={responseNote} onChange={(event) => setResponseNote(event.target.value)} placeholder="State the precise scope of your approval or reason for declining." required />
          <div className="inline-form__actions"><button type="submit" className="button button--accent" disabled={busy || responseNote.trim().length < 10}>Approve described use</button><button type="button" className="button button--outline" disabled={busy || responseNote.trim().length < 10} onClick={() => onRespond(false, responseNote)}>Decline</button></div>
        </form>
      ) : null}
    </section>
  );
}

export default function App() {
  const configured = isContractConfigured();
  const [wallet, setWallet] = useState<ConnectedWallet | null>(() => restoreStudioWallet());
  const [view, setView] = useState<"explore" | "publish">("explore");
  const [info, setInfo] = useState<ContractInfo | null>(null);
  const [catalogReady, setCatalogReady] = useState(false);
  const [works, setWorks] = useState<Work[]>([]);
  const [recentChecks, setRecentChecks] = useState<UseCheck[]>([]);
  const [trailUnavailable, setTrailUnavailable] = useState(false);
  const [selectedWorkId, setSelectedWorkId] = useState<number | null>(null);
  const [license, setLicense] = useState<LicenseVersion | null>(null);
  const [licenseLoadError, setLicenseLoadError] = useState("");
  const [licenseRetry, setLicenseRetry] = useState(0);
  const [selectedCheck, setSelectedCheck] = useState<UseCheck | null>(null);
  const [checkLicense, setCheckLicense] = useState<LicenseVersion | null>(null);
  const [permission, setPermission] = useState<PermissionRequest | null>(null);
  const [receiptLoadError, setReceiptLoadError] = useState("");
  const [receiptRetry, setReceiptRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(configured);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [transactionHash, setTransactionHash] = useState("");
  const [pending, setPending] = useState(() => getPendingAction());
  const [title, setTitle] = useState("");
  const [assetUrl, setAssetUrl] = useState("");
  const [termsText, setTermsText] = useState("");
  const [rightsDeclared, setRightsDeclared] = useState(false);
  const [newTermsText, setNewTermsText] = useState("");
  const [editingTerms, setEditingTerms] = useState(false);
  const [useKind, setUseKind] = useState<UseKind>("PERSONAL");
  const [isModified, setIsModified] = useState(false);
  const [willCredit, setWillCredit] = useState(true);
  const [channel, setChannel] = useState("");
  const [description, setDescription] = useState("");
  const [lookupId, setLookupId] = useState("");

  const selectedWork = works.find((work) => work.workId === selectedWorkId) ?? null;
  const selectedLicense = license && selectedWork && license.workId === selectedWork.workId &&
    license.version === selectedWork.currentVersion ? license : null;
  const publisherIsConnected = selectedWork && wallet?.address.toLowerCase() === selectedWork.publisher.toLowerCase();

  async function refreshLedger() {
    if (!configured) return;
    const [infoResult, worksResult, checksResult] = await Promise.allSettled([
      getContractInfo(), getRecentWorks(16), getRecentChecks(10),
    ]);
    if (worksResult.status === "rejected") throw worksResult.reason;
    const nextWorks = worksResult.value;
    setInfo(infoResult.status === "fulfilled" ? infoResult.value : null);
    setCatalogReady(true);
    const current = selectedWorkId && !nextWorks.some((work) => work.workId === selectedWorkId)
      ? await getWork(selectedWorkId)
      : null;
    setWorks(current ? [current, ...nextWorks] : nextWorks);
    setRecentChecks(checksResult.status === "fulfilled" ? checksResult.value : []);
    setTrailUnavailable(checksResult.status === "rejected");
    setSelectedWorkId((current) => current ?? nextWorks[0]?.workId ?? null);
  }

  useEffect(() => {
    if (!configured) return;
    let active = true;
    Promise.allSettled([getContractInfo(), getRecentWorks(16), getRecentChecks(10)])
      .then(async ([infoResult, worksResult, checksResult]) => {
        if (!active) return;
        if (worksResult.status === "rejected") throw worksResult.reason;
        const nextWorks = worksResult.value;
        const params = new URLSearchParams(window.location.search);
        const checkParam = params.get("check");
        const requestedCheckId = checkParam && /^\d+$/.test(checkParam) ? Number(checkParam) : 0;
        let requestedCheck: UseCheck | null = null;
        if (Number.isSafeInteger(requestedCheckId) && requestedCheckId > 0) {
          try { requestedCheck = await getCheck(requestedCheckId); }
          catch { if (active) setError(`Check #${requestedCheckId} was not found. Showing recent checks instead.`); }
        }
        const workParam = params.get("work");
        const workFromUrl = workParam && /^\d+$/.test(workParam) ? Number(workParam) : 0;
        const requestedWorkId = requestedCheck?.workId ?? workFromUrl;
        let requestedWork: Work | null = null;
        if (Number.isSafeInteger(requestedWorkId) && requestedWorkId > 0 && !nextWorks.some((work) => work.workId === requestedWorkId)) {
          try { requestedWork = await getWork(requestedWorkId); }
          catch { if (active) setError(`Work #${requestedWorkId} was not found. Showing recent works instead.`); }
        }
        if (!active) return;
        setInfo(infoResult.status === "fulfilled" ? infoResult.value : null);
        setCatalogReady(true);
        setWorks(requestedWork ? [requestedWork, ...nextWorks] : nextWorks);
        setRecentChecks(checksResult.status === "fulfilled" ? checksResult.value : []);
        setTrailUnavailable(checksResult.status === "rejected");
        setSelectedWorkId(requestedWork?.workId || nextWorks.find((work) => work.workId === requestedWorkId)?.workId || nextWorks[0]?.workId || null);
        setSelectedCheck(requestedCheck);
      })
      .catch((cause) => { if (active) setError(errorMessage(cause, "Could not read StudioNet.")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [configured]);

  useEffect(() => {
    if (!selectedWorkId || !selectedWork || !configured) { setLicense(null); return; }
    let active = true;
    setLicense(null);
    setLicenseLoadError("");
    getLicense(selectedWorkId, selectedWork.currentVersion).then((value) => { if (active) setLicense(value); })
      .catch((cause) => { if (active) setLicenseLoadError(errorMessage(cause, "Could not load terms.")); });
    return () => { active = false; };
  }, [configured, selectedWorkId, selectedWork?.currentVersion, licenseRetry]);

  useEffect(() => {
    if (!selectedCheck || !configured) { setCheckLicense(null); setPermission(null); return; }
    let active = true;
    setCheckLicense(null);
    setPermission(null);
    setReceiptLoadError("");
    Promise.allSettled([
      getLicense(selectedCheck.workId, selectedCheck.licenseVersion),
      getPermissionRequest(selectedCheck.checkId),
    ]).then(([licenseResult, permissionResult]) => {
      if (!active) return;
      if (licenseResult.status === "fulfilled") setCheckLicense(licenseResult.value);
      if (permissionResult.status === "fulfilled") setPermission(permissionResult.value);
      const failure = licenseResult.status === "rejected" ? licenseResult.reason :
        permissionResult.status === "rejected" ? permissionResult.reason : null;
      if (failure) setReceiptLoadError(errorMessage(failure, "Could not load receipt evidence."));
    });
    return () => { active = false; };
  }, [configured, selectedCheck?.checkId, selectedCheck?.licenseVersion, selectedCheck?.workId, receiptRetry]);

  useEffect(() => {
    if (!selectedCheck) return;
    const frame = window.requestAnimationFrame(() => document.getElementById("receipt")?.scrollIntoView({ behavior: "smooth", block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [selectedCheck?.checkId]);

  function updatePhase(phase: ActionPhase, hash?: string) {
    const copy = {
      signing: "Confirm the action in your wallet.",
      submitted: "Submitted to GenLayer. Waiting for validator consensus.",
      finalizing: "Waiting for finalized execution. This can take a while.",
      reading: "Finalized. Reading the exact saved record.",
      recovering: "Checking whether the original submission finalized. No new transaction is being sent.",
    };
    setNotice(copy[phase]);
    if (hash) setTransactionHash(hash);
  }

  async function applyCompleted(result: CompletedAction) {
    setTransactionHash(result.hash);
    setPending(null);
    switch (result.kind) {
      case "publish":
        setNotice(`Work #${result.work.workId} and terms v1 are published on StudioNet.`);
        setSelectedWorkId(result.work.workId);
        setTitle(""); setAssetUrl(""); setTermsText(""); setRightsDeclared(false);
        setView("explore");
        window.history.replaceState({}, "", `?work=${result.work.workId}#explore`);
        await refreshLedger();
        break;
      case "terms":
        setNotice(`Terms v${result.license.version} are published. Earlier versions remain readable.`);
        setEditingTerms(false);
        setLicense(result.license);
        await refreshLedger();
        break;
      case "check":
        setNotice(`Use check #${result.check.checkId} finalized and saved.`);
        setSelectedWorkId(result.check.workId);
        setSelectedCheck(result.check);
        window.history.replaceState({}, "", `?check=${result.check.checkId}#receipt`);
        await refreshLedger();
        break;
      case "request":
      case "respond":
        setPermission(result.permission);
        setNotice(result.kind === "request" ? "Your request is on-chain. Copy the check link and send it to the publisher; this app does not notify them." : "Your response is on-chain.");
        break;
    }
  }

  async function runAction(action: () => Promise<CompletedAction>) {
    setBusy(true); setError(""); setNotice(""); setTransactionHash("");
    try {
      await applyCompleted(await action());
    } catch (cause) {
      setError(errorMessage(cause, "The action could not complete."));
      setNotice("");
      setPending(getPendingAction());
    } finally {
      setBusy(false);
    }
  }

  function requireWallet(): ConnectedWallet {
    if (!wallet) throw new Error("Connect a wallet before submitting.");
    return wallet;
  }

  async function retryCatalog() {
    setLoading(true);
    setError("");
    try { await refreshLedger(); }
    catch (cause) { setError(errorMessage(cause, "Could not read StudioNet.")); }
    finally { setLoading(false); }
  }

  async function handleConnect(kind: WalletKind) {
    setError(""); setBusy(true);
    try { setWallet(await connectWallet(kind)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Wallet connection failed."); }
    finally { setBusy(false); }
  }

  function handlePublish(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const currentWallet = requireWallet();
      if (!rightsDeclared) throw new Error("Confirm that you intend to publish these terms for this work.");
      const clauses = clausesFromText(termsText);
      void runAction(() => publishWork(currentWallet, { title, assetUrl, clauses }, updatePhase));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the publication fields."); }
  }

  function handleVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const currentWallet = requireWallet();
      if (!selectedWork || !publisherIsConnected) throw new Error("Only the publishing wallet can version these terms.");
      const clauses = clausesFromText(newTermsText);
      void runAction(() => publishTermsVersion(currentWallet, selectedWork, clauses, updatePhase));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the new terms."); }
  }

  function handleCheck(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const currentWallet = requireWallet();
      if (!selectedWork || !selectedLicense) throw new Error("Select a work with readable current terms first.");
      if (description.trim().length < 20) throw new Error("Describe your intended use in at least 20 characters.");
      void runAction(() => submitUseCheck(currentWallet, selectedWork, {
        useKind, isModified, willCredit, channel, description,
      }, updatePhase));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the use details."); }
  }

  function handleLookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const id = Number(lookupId);
    if (!Number.isSafeInteger(id) || id < 1) { setError("Enter a valid use-check ID."); return; }
    setError(""); setBusy(true);
    void getCheck(id).then((record) => openCheck(record))
      .catch((cause) => setError(cause instanceof Error ? cause.message : "No check found."))
      .finally(() => setBusy(false));
  }

  async function openCheck(record: UseCheck) {
    if (!works.some((work) => work.workId === record.workId)) {
      try {
        const relatedWork = await getWork(record.workId);
        setWorks((current) => current.some((work) => work.workId === relatedWork.workId)
          ? current : [relatedWork, ...current]);
      } catch (cause) {
        setError(errorMessage(cause, "Could not load the work for this check."));
      }
    }
    setSelectedWorkId(record.workId);
    setSelectedCheck(record);
    window.history.replaceState({}, "", `?check=${record.checkId}#receipt`);
  }

  const catalogUnavailable = configured && !loading && !catalogReady;
  const writeDisabled = !configured || busy || !!pending || catalogUnavailable;

  return (
    <div className="app-shell">
      <header className="site-header">
        <a href="#top" className="brand" aria-label="License Compass home"><CompassMark small /><span>license<span className="brand__accent">compass</span></span></a>
        <nav aria-label="Main navigation"><a href="#explore" onClick={() => setView("explore")}>Explore</a><a href="#publish" onClick={() => setView("publish")}>Publish terms</a><a href="#how-it-works">How it works</a></nav>
        <span className="network-pill"><span /> STUDIO<span className="network-pill__hide">NET</span></span>
      </header>

      <main id="top">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero__copy">
            <span className="eyebrow eyebrow--hero"><span>✦</span> A clearer way to create together</span>
            <h1 id="hero-title">Good ideas deserve<br /><em>clear directions.</em></h1>
            <p>Explore creator-declared licenses. Describe how you want to use a work. Let GenLayer check the terms—and show you exactly why.</p>
            <div className="hero__actions"><a className="button button--accent" href="#explore" onClick={() => setView("explore")}>Explore works <span>↗</span></a><a className="text-link" href="#how-it-works">See how it works <span>↓</span></a></div>
            <div className="hero__micro"><span>01 / Publisher-declared terms</span><span>02 / Consensus-backed assessment</span><span>03 / No false legal promises</span></div>
          </div>
          <div className="hero__art" aria-hidden="true">
            <div className="art-orbit art-orbit--outer"><span className="art-n">N</span><span className="art-e">E</span><span className="art-s">S</span><span className="art-w">W</span></div>
            <div className="art-orbit art-orbit--inner" />
            <div className="art-needle art-needle--north" /><div className="art-needle art-needle--south" />
            <div className="art-center">✦</div>
            <span className="art-note art-note--one">CREDIT?</span><span className="art-note art-note--two">EDIT?</span><span className="art-note art-note--three">COMMERCIAL?</span>
          </div>
        </section>

        <section className="truth-bar" aria-label="Product scope">
          <div><b>↗</b><span>Understand terms, not just tick boxes</span></div>
          <div><b>✦</b><span>See the exact numbered clauses</span></div>
          <div><b>◎</b><span>Ask the publisher when the answer is unclear</span></div>
        </section>

        {!configured ? <div className="deployment-banner" role="status"><b>Build preview</b><span>This app is not connected to a deployed License Compass contract yet. Publishing and use checks will become available after StudioNet deployment.</span></div> : null}
        {error ? <div className="alert alert--error" role="alert"><strong>Needs attention</strong><span>{error}</span>{catalogUnavailable ? <button type="button" onClick={() => void retryCatalog()}>Retry catalog</button> : null}<button type="button" onClick={() => setError("")} aria-label="Dismiss error">×</button></div> : null}
        {notice ? <div className="alert alert--notice" role="status"><strong>{busy ? "Working on it" : "Saved"}</strong><span>{notice}</span>{transactionHash ? <a href={transactionExplorerUrl(transactionHash)} target="_blank" rel="noopener noreferrer">Transaction ↗</a> : null}</div> : null}
        {pending ? <div className="resume-banner"><div><strong>{pending.hash ? "One StudioNet action still needs readback." : "The network did not return a transaction hash."}</strong><p>{pending.hash ? "Resume its transaction. Do not submit a duplicate." : "Check whether the original action finalized before retrying. A retry reuses the exact saved arguments after checking on-chain state."}</p></div><div className="resume-banner__actions"><button className="button button--dark" type="button" disabled={busy} onClick={() => void runAction(() => resumePendingAction(updatePhase))}>{pending.hash ? "Resume action ↗" : "Check original action ↗"}</button>{!pending.hash ? <button className="button button--outline" type="button" disabled={busy || !wallet || wallet.address.toLowerCase() !== pending.address.toLowerCase()} onClick={() => { try { const currentWallet = requireWallet(); void runAction(() => retryUncertainAction(currentWallet, updatePhase)); } catch (cause) { setError(errorMessage(cause, "Connect the original wallet.")); } }}>Retry identical action</button> : null}</div></div> : null}

        <section className="workbench" id="explore" aria-labelledby="workbench-title">
          <div className="section-top"><div><span className="eyebrow">The workbench</span><h2 id="workbench-title">Find your way through reuse.</h2><p>Start with a work, not a legal maze.</p></div><div className="switcher" role="group" aria-label="Workbench view"><button type="button" className={view === "explore" ? "is-active" : ""} onClick={() => setView("explore")}>Explore</button><button type="button" className={view === "publish" ? "is-active" : ""} onClick={() => setView("publish")}>Publish a work</button></div></div>

          <div className="wallet-row"><div><b>Start with a wallet</b><p>Instant Studio wallets are free for testing and last only in this browser tab. Browser wallets can be used instead.</p></div><WalletControls wallet={wallet} busy={busy} onConnect={(kind) => void handleConnect(kind)} onDisconnect={() => setWallet(null)} /></div>

          {view === "explore" ? (
            <div className="explore-layout">
              <div className="catalog-panel">
                <div className="panel-title"><span>PUBLIC WORKS</span><b>{info ? `${info.workCount} published` : catalogReady ? "Recent works" : "Reading…"}</b></div>
                {loading ? <p className="empty-state">Reading the StudioNet catalog…</p> : catalogUnavailable ? <div className="empty-state"><span>↻</span><h3>Catalog temporarily unavailable.</h3><p>StudioNet did not return the latest finalized works. Retry when the network is available.</p><button type="button" className="button button--dark" onClick={() => void retryCatalog()}>Retry catalog ↗</button></div> : works.length === 0 ? <div className="empty-state"><span>✳</span><h3>A blank canvas is a beginning.</h3><p>No publisher-declared works are stored in this contract yet. Publish the first one to make the checking flow available.</p><button type="button" className="button button--dark" onClick={() => setView("publish")}>Publish a work ↗</button></div> : (
                  <div className="work-list">{works.map((work) => <button key={work.workId} type="button" className={`work-card ${selectedWorkId === work.workId ? "work-card--selected" : ""}`} onClick={() => { setSelectedWorkId(work.workId); setSelectedCheck(null); setEditingTerms(false); window.history.replaceState({}, "", `?work=${work.workId}#explore`); }}><span className="work-card__number">{String(work.workId).padStart(2, "0")}</span><span className="work-card__body"><strong>{work.title}</strong><small>Terms v{work.currentVersion} · {shortAddress(work.publisher)}</small></span><span className="work-card__arrow" aria-hidden="true">↗</span></button>)}</div>
                )}
                <p className="catalog-foot">Recent works from the current contract. Publication is a wallet declaration, not proof of ownership.</p>
              </div>

              <div className="detail-panel">
                {selectedWork && selectedLicense ? <>
                  <div className="detail-header"><span className="eyebrow">Selected work / #{selectedWork.workId}</span><h3>{selectedWork.title}</h3><a href={selectedWork.assetUrl} target="_blank" rel="noopener noreferrer">Open work ↗</a><p>Published by <code title={selectedWork.publisher}>{shortAddress(selectedWork.publisher)}</code> · Terms version {selectedLicense.version}</p></div>
                  <div className="terms-list"><div className="terms-list__title"><strong>The published terms</strong><span>VERSION {selectedLicense.version}</span></div>{selectedLicense.clauses.map((clause, index) => <div className="term" key={`${selectedLicense.version}-${index}`}><b>{String(index + 1).padStart(2, "0")}</b><p>{clause}</p></div>)}</div>
                  <div className="terms-meta"><span>Terms digest <code title={selectedLicense.termsDigest}>{shortDigest(selectedLicense.termsDigest)}</code></span><span>Published {dateLabel(selectedLicense.publishedAt)}</span></div>
                  {publisherIsConnected ? <div className="publisher-tools"><button type="button" className="text-link" onClick={() => { setEditingTerms(!editingTerms); setNewTermsText(selectedLicense.clauses.join("\n")); }}>{editingTerms ? "Close version editor ↑" : "Publish a new terms version ↗"}</button>{editingTerms ? <form onSubmit={handleVersion}><label htmlFor="new-terms">New numbered clauses, one per line</label><textarea id="new-terms" value={newTermsText} onChange={(event) => setNewTermsText(event.target.value)} rows={6} required /><p>Earlier versions and their use checks remain unchanged.</p><button type="submit" className="button button--dark" disabled={writeDisabled}>Publish version {selectedWork.currentVersion + 1}</button></form> : null}</div> : null}
                  <form className="use-form" onSubmit={handleCheck} aria-labelledby="use-form-title">
                    <span className="eyebrow">Try a use</span><h3 id="use-form-title">What do you want to do with it?</h3><p>Describe one specific plan. Your description will be public on StudioNet.</p>
                    <div className="form-grid"><label>Purpose<select value={useKind} onChange={(event) => setUseKind(event.target.value as UseKind)}><option value="PERSONAL">Personal / non-commercial</option><option value="EDITORIAL">Editorial / educational</option><option value="COMMERCIAL">Commercial / promotional</option></select></label><label>Where will it appear?<input maxLength={80} minLength={3} value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="e.g. my newsletter" required /></label></div>
                    <div className="choice-grid"><fieldset><legend>Will you edit or remix it?</legend><label><input type="radio" name="modified" checked={!isModified} onChange={() => setIsModified(false)} /> No</label><label><input type="radio" name="modified" checked={isModified} onChange={() => setIsModified(true)} /> Yes</label></fieldset><fieldset><legend>Will you credit the publisher?</legend><label><input type="radio" name="credit" checked={willCredit} onChange={() => setWillCredit(true)} /> Yes</label><label><input type="radio" name="credit" checked={!willCredit} onChange={() => setWillCredit(false)} /> No</label></fieldset></div>
                    <label>Describe the exact use<textarea value={description} onChange={(event) => setDescription(event.target.value)} minLength={20} maxLength={360} rows={3} placeholder="Explain what you will publish, who will see it, and any payment or promotion involved." required /></label>
                    <div className="form-bottom"><p>GenLayer will compare your plan to terms v{selectedLicense.version}. A result is advisory, not legal clearance.</p><button type="submit" className="button button--accent" disabled={writeDisabled || !wallet || description.trim().length < 20 || !channel.trim()}>{busy ? "Checking…" : "Check my use ↗"}</button></div>
                  </form>
                </> : <div className="empty-state empty-state--detail"><CompassMark /><h3>{selectedWork ? `Reading terms for ${selectedWork.title}` : "Select a work to see its terms."}</h3><p>{licenseLoadError || "Each check is tied to a specific published version."}</p>{selectedWork && licenseLoadError ? <button type="button" className="button button--dark" onClick={() => setLicenseRetry((count) => count + 1)}>Retry terms ↻</button> : null}</div>}
              </div>
            </div>
          ) : (
            <section id="publish" className="publish-panel" aria-labelledby="publish-title"><div className="publish-panel__intro"><span className="eyebrow">For creators</span><h3 id="publish-title">Put your terms in plain sight.</h3><p>Write one clear rule per line. We will number and preserve them so every later check can refer to the exact version a visitor read.</p><div className="publish-doodle" aria-hidden="true">✳<span>YOUR WORK<br />YOUR WORDS</span></div></div><form onSubmit={handlePublish} className="publish-form"><label>Work title<input value={title} onChange={(event) => setTitle(event.target.value)} minLength={3} maxLength={96} placeholder="Give the work a recognizable name" required /></label><label>Public HTTPS link to the work<input value={assetUrl} onChange={(event) => setAssetUrl(event.target.value)} placeholder="https://your-site.com/your-work" required /></label><label>License clauses — one per line<textarea value={termsText} onChange={(event) => setTermsText(event.target.value)} rows={7} placeholder={"Example: You may share this image in personal posts if you credit the publisher.\nPaid advertising requires separate written permission."} required /><small>1–8 clauses, 12–360 characters each. These are your own terms; we do not edit them after publication.</small></label><label className="checkbox-line"><input type="checkbox" checked={rightsDeclared} onChange={(event) => setRightsDeclared(event.target.checked)} required /><span>I intend to publish these terms for this work. I understand that the app records my wallet declaration but does not verify ownership.</span></label><p className="public-note">The title, link, terms, and wallet address will be public and persistent on StudioNet. Do not include private information.</p><button className="button button--accent" type="submit" disabled={writeDisabled || !wallet || !rightsDeclared}>Publish terms ↗</button></form></section>
          )}
        </section>

        {selectedCheck ? <div id="receipt" className="receipt-wrap"><CheckReceipt key={selectedCheck.checkId} check={selectedCheck} license={checkLicense} permission={permission} wallet={wallet} busy={busy || !!pending} evidenceError={receiptLoadError} onRetryEvidence={() => setReceiptRetry((count) => count + 1)} onRequest={(note) => { try { const currentWallet = requireWallet(); void runAction(() => requestPermission(currentWallet, selectedCheck.checkId, note, updatePhase)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Connect a wallet."); } }} onRespond={(approve, note) => { try { const currentWallet = requireWallet(); void runAction(() => respondPermission(currentWallet, selectedCheck.checkId, approve, note, updatePhase)); } catch (cause) { setError(cause instanceof Error ? cause.message : "Connect a wallet."); } }} /></div> : null}

        <section className="ledger" aria-labelledby="ledger-title"><div className="section-top"><div><span className="eyebrow">Public trail</span><h2 id="ledger-title">Every direction leaves a trace.</h2><p>Look up an older use check by its number, or open a recent one.</p></div><form className="lookup-form" onSubmit={handleLookup}><label htmlFor="lookup-id">Find a use check</label><div><input id="lookup-id" type="number" min="1" step="1" value={lookupId} onChange={(event) => setLookupId(event.target.value)} placeholder="Check ID" /><button type="submit" disabled={!configured || busy}>Find ↗</button></div></form></div>{recentChecks.length ? <div className="ledger-list">{recentChecks.map((item) => <button key={item.checkId} type="button" onClick={() => void openCheck(item)}><b>#{item.checkId}</b><span>Work #{item.workId} · terms v{item.licenseVersion}</span><strong>{OUTCOME_COPY[item.outcome].label}</strong><small>{dateLabel(item.createdAt)} ↗</small></button>)}</div> : <div className="ledger-empty">{catalogUnavailable || trailUnavailable ? "The recent check list could not be loaded. You can still find a finalized check by ID or retry when StudioNet is available." : "No finalized use checks on this contract yet. The first check will appear here."}</div>}</section>

        <section className="method" id="how-it-works" aria-labelledby="method-title"><div className="method__intro"><span className="eyebrow">The method</span><h2 id="method-title">Less guessing.<br /><em>More clarity.</em></h2><p>License Compass is an interpretation aid and a public record—not a substitute for permission from the person who actually holds the rights.</p></div><div className="method__steps"><div><b>01</b><h3>Terms that stay put</h3><p>Each published license gets a version and digest. Later edits create a new version instead of rewriting history.</p></div><div><b>02</b><h3>One described use</h3><p>The visitor explains their intended use. GenLayer validators compare that description against the stored clauses.</p></div><div><b>03</b><h3>An honest answer</h3><p>The result can be within, outside, or unclear. If the terms are silent, the app will not invent permission.</p></div><div><b>04</b><h3>A human path forward</h3><p>Visitors can ask the publishing wallet for a specific permission; its response is recorded separately from the assessment.</p></div></div></section>

        <footer className="site-footer"><div className="brand brand--footer"><CompassMark small /><span>license<span className="brand__accent">compass</span></span></div><p>Publisher-declared terms. Consensus-backed assessments. No ownership or legal-rights guarantee.</p><div>{configured ? <a href={contractExplorerUrl()} target="_blank" rel="noopener noreferrer">StudioNet contract ↗</a> : <span>StudioNet deployment pending</span>}<span>{info ? `v${info.contractVersion} · ${info.workCount} works · ${info.checkCount} checks` : catalogUnavailable ? "Network temporarily unavailable" : catalogReady ? "StudioNet connected · counts unavailable" : CONTRACT_ADDRESS ? "Reading network…" : "Local build preview"}</span></div></footer>
      </main>
    </div>
  );
}
