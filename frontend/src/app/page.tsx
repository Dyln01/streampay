"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPublicClient, createWalletClient, http, custom, formatEther, parseEther, parseAbi } from "viem";
import { monadTestnet } from "viem/chains";

const STREAMPAY_ADDRESS = (process.env.NEXT_PUBLIC_STREAMPAY_ADDRESS || "") as string;
const RPC = "https://testnet-rpc.monad.xyz";
const ZERO = BigInt(0);

const publicClient = createPublicClient({ chain: monadTestnet, transport: http(RPC) });

// Native-MON escrow StreamPay. The getter returns the struct field order.
const STREAMPAY_ABI = parseAbi([
  "function createStream(address _merchant, uint256 _amountPerSecond, uint256 _duration) external payable returns (uint256)",
  "function fundStream(uint256 _streamId) external payable",
  "function extendStream(uint256 _streamId, uint256 _additionalDuration) external payable",
  "function transferStream(uint256 _streamId, address _newPayer) external",
  "function claim(uint256 _streamId) external returns (uint256)",
  "function cancel(uint256 _streamId) external",
  "function streams(uint256) external view returns (address payer, address merchant, uint256 amountPerSecond, uint256 deposit, uint256 withdrawn, uint256 startTime, uint256 duration, bool active, bool cancelled)",
  "function accrued(uint256 _streamId) external view returns (uint256)",
  "function vestedAmount(uint256 _streamId) external view returns (uint256)",
  "function calculateRefund(uint256 _streamId) external view returns (uint256)",
  "function isEnded(uint256 _streamId) external view returns (bool)",
  "function getStreamStatus(uint256 _streamId) external view returns (string)",
  "function getPayerStreams(address) external view returns (uint256[])",
  "function getMerchantStreams(address) external view returns (uint256[])",
  "function totalEscrowed() external view returns (uint256)",
  "function streamCount() external view returns (uint256)",
  "function paused() external view returns (bool)",
  "function pause() external",
  "function unpause() external",
  "function sweepExcess() external",
  "function VERSION() external view returns (string)",
  "function owner() external view returns (address)",
]);

const OWNER = "0xcb19c6d23d0753228ed86039e790a624ea4670a1";

type StreamRow = {
  id: number;
  payer: string;
  merchant: string;
  amountPerSecond: bigint;
  deposit: bigint;
  withdrawn: bigint;
  startTime: bigint;
  duration: bigint;
  active: boolean;
  cancelled: boolean;
};

function isValidAddress(a: string) {
  return /^0x[0-9a-fA-F]{40}$/.test(a);
}
const copy = (t: string) => navigator.clipboard.writeText(t).catch(() => {});
const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** What has vested to the merchant right now (mirrors the contract's _vested). */
function vested(s: StreamRow, nowSec: bigint): bigint {
  if (nowSec <= s.startTime) return ZERO;
  let v = (nowSec - s.startTime) * s.amountPerSecond;
  const cap = s.duration > ZERO ? s.duration * s.amountPerSecond : s.deposit;
  if (v > cap) v = cap;
  if (v > s.deposit) v = s.deposit;
  return v;
}
function claimable(s: StreamRow, nowSec: bigint): bigint {
  if (!s.active) return ZERO;
  const v = vested(s, nowSec);
  return v > s.withdrawn ? v - s.withdrawn : ZERO;
}
function refundNow(s: StreamRow, nowSec: bigint): bigint {
  if (s.cancelled) return ZERO;
  const v = vested(s, nowSec);
  return s.deposit > v ? s.deposit - v : ZERO;
}
function ended(s: StreamRow, nowSec: bigint): boolean {
  if (s.duration > ZERO && nowSec >= s.startTime + s.duration) return true;
  return vested(s, nowSec) >= s.deposit;
}
function timeLeft(s: StreamRow, nowSec: bigint): bigint {
  if (s.duration === ZERO) {
    if (s.amountPerSecond === ZERO) return ZERO;
    const remaining = s.deposit > s.withdrawn ? s.deposit - s.withdrawn : ZERO;
    return remaining / s.amountPerSecond;
  }
  const end = s.startTime + s.duration;
  return end > nowSec ? end - nowSec : ZERO;
}

function fmtDuration(sec: bigint) {
  if (sec === ZERO) return "—";
  const d = Number(sec);
  const days = Math.floor(d / 86400);
  const hrs = Math.floor((d % 86400) / 3600);
  const mins = Math.floor((d % 3600) / 60);
  const secs = d % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function Toast({ t, onClose }: { t: { message: string; type: string }; onClose: () => void }) {
  const cls =
    t.type === "success" ? "bg-green-900 border-green-500 text-green-100"
    : t.type === "error" ? "bg-red-950 border-red-600 text-red-100"
    : "bg-blue-950 border-blue-600 text-blue-100";
  return (
    <div className={`border rounded p-3 mb-2 flex justify-between gap-3 text-xs ${cls}`}>
      <span className="break-all">{t.message}</span>
      <button onClick={onClose} className="underline flex-shrink-0">dismiss</button>
    </div>
  );
}

export default function Home() {
  const [userAddr, setUserAddr] = useState<string>();
  const [walletClient, setWalletClient] = useState<any>();
  const [asPayer, setAsPayer] = useState<StreamRow[]>([]);
  const [asMerchant, setAsMerchant] = useState<StreamRow[]>([]);
  const [busy, setBusy] = useState<string>("");
  const [toasts, setToasts] = useState<{ message: string; type: string }[]>([]);
  const [, setTick] = useState(0);
  const [escrowed, setEscrowed] = useState<bigint>(ZERO);
  const [paused, setPaused] = useState(false);
  const [version, setVersion] = useState("");
  const toastId = useRef(0);

  const hasContract = isValidAddress(STREAMPAY_ADDRESS);
  const nowSec = BigInt(Math.floor(Date.now() / 1000));

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    toastId.current += 1;
    setToasts((p) => [...p, { message, type }].slice(-4));
    setTimeout(() => setToasts((p) => p.slice(1)), 7000);
  }, []);

  // 1s local tick so the accrued figure visibly counts up between chain reads.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  const retry = async <T,>(fn: () => Promise<T>, tries = 4, delay = 800): Promise<T> => {
    let last: any;
    for (let i = 0; i < tries; i++) {
      try {
        return await fn();
      } catch (e: any) {
        last = e;
        const m = String(e?.message || "");
        if (/rate|limit|Bad Request|429|timeout/i.test(m)) await new Promise((r) => setTimeout(r, delay * (i + 1)));
        else throw e;
      }
    }
    throw last;
  };

  const loadStreams = useCallback(async () => {
    if (!userAddr || !hasContract) return;
    try {
      const [payerIds, merchantIds, esc, isPaused, ver] = await Promise.all([
        retry(() => publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "getPayerStreams", args: [userAddr as `0x${string}`] }) as Promise<bigint[]>),
        retry(() => publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "getMerchantStreams", args: [userAddr as `0x${string}`] }) as Promise<bigint[]>),
        retry(() => publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "totalEscrowed" }) as Promise<bigint>),
        retry(() => publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "paused" }) as Promise<boolean>),
        retry(() => publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "VERSION" }) as Promise<string>).catch(() => ""),
      ]);
      setEscrowed(esc);
      setPaused(isPaused);
      setVersion(ver);

      const ids = [...new Set([...payerIds, ...merchantIds].map((b) => Number(b)))];
      const rows: StreamRow[] = [];
      // Monad's public RPC rate-limits hard: 3 reads at a time, pause between batches.
      for (let i = 0; i < ids.length; i += 3) {
        const batch = ids.slice(i, i + 3);
        const got = await Promise.all(
          batch.map(async (id) => {
            const s: any = await retry(() =>
              publicClient.readContract({ address: STREAMPAY_ADDRESS as `0x${string}`, abi: STREAMPAY_ABI, functionName: "streams", args: [BigInt(id)] })
            );
            return {
              id, payer: s[0], merchant: s[1], amountPerSecond: s[2], deposit: s[3],
              withdrawn: s[4], startTime: s[5], duration: s[6], active: s[7], cancelled: s[8],
            } as StreamRow;
          })
        );
        rows.push(...got);
        if (i + 3 < ids.length) await new Promise((r) => setTimeout(r, 500));
      }
      setAsPayer(rows.filter((r) => r.payer.toLowerCase() === userAddr.toLowerCase()));
      setAsMerchant(rows.filter((r) => r.merchant.toLowerCase() === userAddr.toLowerCase()));
    } catch (e: any) {
      addToast("Load failed: " + String(e?.shortMessage || e?.message || e), "error");
    }
  }, [userAddr, hasContract, addToast]);

  useEffect(() => {
    if (userAddr) loadStreams();
    const iv = setInterval(() => { if (userAddr) loadStreams(); }, 6000);
    return () => clearInterval(iv);
  }, [userAddr, loadStreams]);

  const connect = async () => {
    const eth = (window as any).ethereum;
    if (!eth) { addToast("Install MetaMask", "error"); return; }
    try {
      const chainId = await eth.request({ method: "eth_chainId" });
      if (chainId !== "0x3013") {
        try {
          await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x3013" }] });
        } catch (e: any) {
          if (e.code === 4902) addToast("Add Monad testnet (chainId 10143) to MetaMask first", "error");
          else if (e.code === -32603) addToast("Approve the connection in MetaMask", "info");
          else addToast(`Network: ${e.message}`, "error");
        }
      }
      try { await eth.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] }); } catch { /* already granted */ }
      const accounts: string[] = await eth.request({ method: "eth_requestAccounts" });
      const wc = createWalletClient({ account: accounts[0] as `0x${string}`, chain: monadTestnet, transport: custom(eth) });
      setWalletClient(wc);
      setUserAddr(accounts[0]);
      addToast("Connected " + short(accounts[0]), "success");
      eth.on("accountsChanged", (accs: string[]) => { if (accs.length) setUserAddr(accs[0]); });
      eth.on("chainChanged", () => window.location.reload());
    } catch (e: any) {
      if (e.code === -32002) addToast("MetaMask already has a pending request — open it, or restart the dev server", "error");
      else if (e.code === 4001) addToast("Connection rejected", "error");
      else addToast(`Connect failed: ${e.message}`, "error");
    }
  };

  /**
   * Every write goes out with an explicit gas limit (estimate + 30%).
   * Monad testnet charges ~102 gwei and a write sent with an inflated estimate
   * was measured at 25x the real cost — 3,545,029 gas vs 135,293 for the same
   * cancel. Never let the estimate float.
   */
  const send = async (label: string, fn: string, args: any[], value = ZERO) => {
    if (!walletClient || !userAddr) { addToast("Connect a wallet first", "error"); return false; }
    setBusy(label);
    try {
      // Cast the clients to any: this is a dynamic dispatcher over the ABI, so the
      // strict per-function argument tuples that parseAbi generates can't be used here.
      const est = await (publicClient as any).estimateContractGas({
        address: STREAMPAY_ADDRESS, abi: STREAMPAY_ABI, functionName: fn, args, value, account: userAddr,
      });
      const hash = await (walletClient as any).writeContract({
        address: STREAMPAY_ADDRESS, abi: STREAMPAY_ABI, functionName: fn, args, value,
        gas: (est * 13n) / 10n, account: userAddr, chain: monadTestnet,
      });
      addToast(`${label} sent — ${short(hash)}`, "info");
      const rcpt = await publicClient.waitForTransactionReceipt({ hash });
      if (rcpt.status !== "success") { addToast(`${label} reverted on-chain`, "error"); return false; }
      addToast(`${label} confirmed`, "success");
      await loadStreams();
      return true;
    } catch (e: any) {
      addToast(`${label} failed: ${String(e?.shortMessage || e?.message || e).split("\n")[0]}`, "error");
      return false;
    } finally {
      setBusy("");
    }
  };

  const create = (merchant: string, rate: string, duration: string, budget: string) => {
    if (!isValidAddress(merchant)) { addToast("Invalid merchant address", "error"); return; }
    let rateWei: bigint, dur: bigint, deposit: bigint;
    try {
      rateWei = parseEther(rate || "0");
      dur = BigInt(duration || "0");
      deposit = dur > ZERO ? rateWei * dur : parseEther(budget || "0");
    } catch {
      addToast("Rate / duration / deposit must be plain numbers", "error");
      return;
    }
    if (rateWei <= ZERO) { addToast("Rate must be greater than zero", "error"); return; }
    if (deposit <= ZERO) { addToast("Deposit must be greater than zero", "error"); return; }
    return send("Create stream", "createStream", [merchant as `0x${string}`, rateWei, dur], deposit);
  };

  const Row = ({ s, role }: { s: StreamRow; role: "payer" | "merchant" }) => {
    const cl = claimable(s, nowSec);
    const rf = refundNow(s, nowSec);
    const v = vested(s, nowSec);
    const left = timeLeft(s, nowSec);
    const over = ended(s, nowSec);
    const state = s.cancelled ? "cancelled" : !s.active ? "settled" : over ? "ended — claim the remainder" : "active";
    const pct = s.deposit > ZERO ? Number((v * BigInt(10000)) / s.deposit) / 100 : 0;
    return (
      <li className="border border-green-900 rounded p-3 bg-black/40">
        <div className="flex justify-between items-baseline gap-2 flex-wrap">
          <span className="text-xs text-gray-500">#{s.id} · {state}</span>
          <span className="text-xs text-gray-500">rate {formatEther(s.amountPerSecond)} MON/s</span>
        </div>
        <div className="mt-2 h-1.5 w-full bg-gray-800 rounded overflow-hidden">
          <div className="h-full bg-green-600" style={{ width: `${Math.min(100, pct)}%` }} />
        </div>
        <div className="grid grid-cols-2 gap-x-4 text-xs mt-2 text-gray-400">
          <span>escrowed</span><span className="text-green-300">{formatEther(s.deposit)} MON</span>
          <span>earned by merchant</span><span className="text-green-300">{formatEther(v)} MON</span>
          <span>{role === "merchant" ? "claimable now" : "accruing now"}</span>
          <span className="text-green-400 font-bold">{formatEther(cl)} MON</span>
          <span>already claimed</span><span>{formatEther(s.withdrawn)} MON</span>
          {role === "payer" && (<><span>refund if cancelled</span><span className="text-yellow-300">{formatEther(rf)} MON</span></>)}
          <span>{s.active && !over ? "time left" : "runway ended"}</span><span>{s.active ? fmtDuration(left) : "—"}</span>
          <span>{role === "merchant" ? "payer" : "merchant"}</span>
          <span>
            <code className="text-[10px]">{role === "merchant" ? short(s.payer) : short(s.merchant)}</code>
            <button onClick={() => copy(role === "merchant" ? s.payer : s.merchant)} className="ml-1 underline text-green-700">copy</button>
          </span>
        </div>
        <div className="flex gap-2 mt-3 flex-wrap">
          {role === "merchant" && s.active && cl > ZERO && (
            <button onClick={() => send("Claim", "claim", [BigInt(s.id)])} disabled={!!busy}
              className="bg-green-700 hover:bg-green-600 disabled:opacity-40 px-3 py-1 rounded text-xs">Claim {formatEther(cl)} MON</button>
          )}
          {role === "payer" && s.active && !s.cancelled && (
            <>
              <button onClick={() => send("Cancel", "cancel", [BigInt(s.id)])} disabled={!!busy}
                className="bg-red-800 hover:bg-red-700 disabled:opacity-40 px-3 py-1 rounded text-xs">
                Cancel{s.deposit > v ? ` (refund ${formatEther(rf)} MON)` : ""}
              </button>
              <button onClick={() => {
                const amt = prompt("Top up with how much MON?", "0.01");
                if (amt) send("Top up", "fundStream", [BigInt(s.id)], parseEther(amt));
              }} disabled={!!busy} className="bg-blue-900 hover:bg-blue-800 disabled:opacity-40 px-3 py-1 rounded text-xs">Top up</button>
              {s.duration > ZERO && (
                <button onClick={() => {
                  const secs = prompt("Extend by how many seconds? (escrow = seconds × rate)", "600");
                  if (secs) send("Extend", "extendStream", [BigInt(s.id), BigInt(secs)], s.amountPerSecond * BigInt(secs));
                }} disabled={!!busy} className="bg-purple-900 hover:bg-purple-800 disabled:opacity-40 px-3 py-1 rounded text-xs">Extend</button>
              )}
            </>
          )}
        </div>
      </li>
    );
  };

  return (
    <main className="min-h-screen bg-black text-green-400 p-6 font-mono">
      <header className="mb-6">
        <h1 className="text-3xl font-bold">StreamPay</h1>
        <p className="text-green-700 text-sm">
          Per-second subscriptions in native MON on Monad — you escrow once, the merchant draws down as it vests, cancel refunds the rest.
        </p>
        {version && <p className="text-[11px] text-gray-600 mt-1">contract {short(STREAMPAY_ADDRESS)} · {version} · total escrowed {formatEther(escrowed)} MON{paused ? " · NEW STREAMS PAUSED" : ""}</p>}
      </header>

      {!hasContract && (
        <div className="bg-red-950 border border-red-700 rounded p-3 mb-4 text-xs">
          No contract address. Set NEXT_PUBLIC_STREAMPAY_ADDRESS in frontend/.env.local
        </div>
      )}

      {!userAddr ? (
        <button onClick={connect} className="bg-green-700 hover:bg-green-600 text-black font-bold px-6 py-2 rounded">Connect MetaMask</button>
      ) : (
        <>
          <div className="fixed top-3 right-3 z-50 w-80">
            {toasts.map((t, i) => <Toast key={i} t={t} onClose={() => setToasts((p) => p.filter((_, j) => j !== i))} />)}
          </div>

          <div className="flex items-center gap-3 mb-5 text-xs flex-wrap text-gray-500">
            <span>wallet</span><code className="bg-gray-900 px-2 py-1 rounded text-green-300">{short(userAddr)}</code>
            <button onClick={() => copy(userAddr)} className="underline text-green-700">copy</button>
            <span>·</span><span>contract</span>
            <code className="bg-gray-900 px-2 py-1 rounded text-green-300">{short(STREAMPAY_ADDRESS)}</code>
            <button onClick={() => loadStreams()} className="ml-auto bg-gray-800 hover:bg-gray-700 px-2 py-1 rounded text-green-300">Refresh</button>
          </div>

          {busy && <div className="text-yellow-400 text-xs mb-3">{busy}…</div>}

          <div className="grid md:grid-cols-2 gap-5 mb-6">
            <section className="bg-gray-950 border border-green-900 rounded p-4">
              <h2 className="font-bold mb-3">Open a stream (payer)</h2>
              <StreamForm onCreate={create} busy={!!busy} self={userAddr} />
            </section>
            <section className="bg-gray-950 border border-green-900 rounded p-4">
              <h2 className="font-bold mb-3">Streams you pay for</h2>
              {asPayer.length === 0
                ? <p className="text-gray-600 text-xs">None yet. Open one on the left — you can pay yourself to rehearse.</p>
                : <ul className="space-y-3">{asPayer.map((s) => <Row key={`p-${s.id}`} s={s} role="payer" />)}</ul>}
            </section>
          </div>

          <section className="bg-gray-950 border border-green-900 rounded p-4 mb-6">
            <h2 className="font-bold mb-3">Streams you get paid for (merchant)</h2>
            {asMerchant.length === 0
              ? <p className="text-gray-600 text-xs">Nothing addressed to this wallet.</p>
              : <ul className="space-y-3">{asMerchant.map((s) => <Row key={`m-${s.id}`} s={s} role="merchant" />)}</ul>}
          </section>

          {userAddr.toLowerCase() === OWNER && <AdminPanel paused={paused} busy={!!busy} send={send} />}
        </>
      )}
    </main>
  );
}

function StreamForm({ onCreate, busy, self }: { onCreate: (m: string, r: string, d: string, b: string) => void; busy: boolean; self: string }) {
  const [merchant, setMerchant] = useState("");
  const [rate, setRate] = useState("0.001");
  const [duration, setDuration] = useState("600");
  const [budget, setBudget] = useState("0.05");
  const unlimited = duration === "0" || duration === "";
  let preview = "";
  try {
    const rateWei = parseEther(rate || "0");
    preview = unlimited
      ? `${budget} MON covers ${rateWei > ZERO ? (parseEther(budget || "0") / rateWei).toString() : "0"}s at this rate`
      : `escrow = ${rate} × ${duration}s = ${formatEther(rateWei * BigInt(duration || "0"))} MON`;
  } catch { preview = "enter a valid rate"; }

  return (
    <form className="space-y-3 text-xs" onSubmit={(e) => { e.preventDefault(); onCreate(merchant, rate, duration, budget); }}>
      <div>
        <label className="block text-gray-500 mb-1">merchant address</label>
        <input value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x…" required
          className="w-full bg-black border border-green-900 rounded px-2 py-1.5 text-green-300" />
        <button type="button" onClick={() => setMerchant(self)} className="underline text-green-700 mt-1">use my own address (rehearse)</button>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-gray-500 mb-1">rate (MON per second)</label>
          <input type="number" step="0.000001" min="0" value={rate} onChange={(e) => setRate(e.target.value)}
            className="w-full bg-black border border-green-900 rounded px-2 py-1.5 text-green-300" />
        </div>
        <div>
          <label className="block text-gray-500 mb-1">duration (seconds, 0 = until spent)</label>
          <input type="number" min="0" value={duration} onChange={(e) => setDuration(e.target.value)}
            className="w-full bg-black border border-green-900 rounded px-2 py-1.5 text-green-300" />
        </div>
      </div>
      {unlimited && (
        <div>
          <label className="block text-gray-500 mb-1">deposit (MON budget)</label>
          <input type="number" step="0.0001" min="0" value={budget} onChange={(e) => setBudget(e.target.value)}
            className="w-full bg-black border border-green-900 rounded px-2 py-1.5 text-green-300" />
        </div>
      )}
      <p className="text-gray-600">{preview}</p>
      <p className="text-yellow-700">
        Monad testnet gas is ~102 gwei, so a write costs ~0.01–0.02 MON. Pick a rate/deposit well above that or the fees dwarf the stream.
      </p>
      <button type="submit" disabled={busy}
        className="w-full bg-green-700 hover:bg-green-600 disabled:opacity-40 text-black font-bold py-2 rounded">
        {busy ? "working…" : "Escrow MON & open stream"}
      </button>
    </form>
  );
}

function AdminPanel({ paused, busy, send }: { paused: boolean; busy: boolean; send: (l: string, f: string, a: any[]) => Promise<boolean | undefined> }) {
  return (
    <section className="bg-gray-950 border border-yellow-800 rounded p-4">
      <h2 className="font-bold text-yellow-500 mb-1">Owner controls</h2>
      <p className="text-[11px] text-gray-500 mb-3">
        Pause blocks new streams only — claiming and cancelling keep working, so no one&apos;s MON can ever be trapped.
      </p>
      <div className="flex gap-2 flex-wrap text-xs">
        {!paused
          ? <button onClick={() => send("Pause", "pause", [])} disabled={busy} className="bg-red-800 hover:bg-red-700 px-3 py-1.5 rounded disabled:opacity-40">Pause new streams</button>
          : <button onClick={() => send("Unpause", "unpause", [])} disabled={busy} className="bg-green-800 hover:bg-green-700 px-3 py-1.5 rounded disabled:opacity-40">Unpause</button>}
        <button onClick={() => send("Sweep excess", "sweepExcess", [])} disabled={busy} className="bg-yellow-800 hover:bg-yellow-700 text-black px-3 py-1.5 rounded disabled:opacity-40">Sweep excess (never touches escrow)</button>
      </div>
    </section>
  );
}
