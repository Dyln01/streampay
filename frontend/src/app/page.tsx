"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPublicClient, createWalletClient, http, custom, formatEther, parseUnits, parseAbi } from "viem";
import { monadTestnet } from "viem/chains";

const STREAMPAY_ADDRESS = (process.env.NEXT_PUBLIC_STREAMPAY_ADDRESS || "") as string;

const RPC = "https://testnet-rpc.monad.xyz";

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC),
});

const STREAMPAY_ABI = parseAbi([
  "function createStream(address _merchant, uint256 _amountPerSecond, uint256 _duration) external returns (uint256)",
  "function claim(uint256 _streamId) external returns (uint256)",
  "function cancel(uint256 _streamId) external",
  "function accrued(uint256 _streamId) external view returns (uint256)",
  "function streams(uint256) external view returns (address payer, address merchant, uint256 amountPerSecond, uint256 startTime, uint256 lastClaimed, uint256 totalPaid, uint256 duration, bool active)",
  "function getPayerStreams(address) external view returns (uint256[])",
  "function getMerchantStreams(address) external view returns (uint256[])",
  "function paymentToken() external view returns (address)",
  "function allowance(address owner, address spender) external view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function pause() external",
  "function unpause() external",
  "function extendStream(uint256 _streamId, uint256 _additionalDuration) external",
  "function transferStream(uint256 _streamId, address _newPayer) external",
  "function emergencyWithdraw(uint256 _streamId) external",
  "function claimAfterExpiry(uint256 _streamId) external returns (uint256)",
]);

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function Toast({ message, type, onClose }: { message: string; type: "success" | "error" | "info"; onClose: () => void }) {
  return (
    <div className={`border rounded-lg p-3 mb-2 flex justify-between items-center text-sm ${
      type === "success" ? "bg-green-800 border-green-600 text-green-100" :
      type === "error" ? "bg-red-900 border-red-600 text-red-100" :
      "bg-blue-900 border-blue-600 text-blue-100"
    }`}>
      <span>{message}</span>
      <button onClick={onClose} className="ml-3 text-xs underline flex-shrink-0">Dismiss</button>
    </div>
  );
}

export default function Home() {
  const [userAddr, setUserAddr] = useState<string | undefined>();
  const [walletClient, setWalletClient] = useState<any>();
  const [streams, setStreams] = useState<any[]>([]);
  const [merchantStreams, setMerchantStreams] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [toasts, setToasts] = useState<{ message: string; type: "success" | "error" | "info" }[]>([]);
  const [networkOk, setNetworkOk] = useState(true);
  const [tick, setTick] = useState(0);
  const toastId = useRef(0);

  const hasContract = isValidAddress(STREAMPAY_ADDRESS);

  const addToast = useCallback((message: string, type: "success" | "error" | "info" = "info") => {
    const id = ++toastId.current;
    setToasts(prev => [...prev, { message, type }]);
    setTimeout(() => setToasts(prev => prev.filter((_, i) => i !== id - 1)), 5000);
  }, []);

  const checkNetwork = useCallback(async () => {
    if (!(window as any).ethereum) return false;
    try {
      const chainId = await (window as any).ethereum.request({ method: "eth_chainId" });
      return chainId === "0x3013";
    } catch {
      return false;
    }
  }, []);


  const loadStreams = useCallback(async () => {
    if (!userAddr || !hasContract) return;
    setLoading(true);
    try {
      const payerIds = await publicClient.readContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "getPayerStreams",
        args: [userAddr as `0x${string}`],
      }) as bigint[];
      const merchantIds = await publicClient.readContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "getMerchantStreams",
        args: [userAddr as `0x${string}`],
      }) as bigint[];

      const allIds = [...new Set([...payerIds, ...merchantIds])];
      const batchSize = 3;
      const results = [];
      for (let i = 0; i < allIds.length; i += batchSize) {
        const batch = allIds.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (id) => {
            let s, acc;
            for (let retry = 0; retry < 3; retry++) {
              try {
                s = await publicClient.readContract({
                  address: STREAMPAY_ADDRESS as `0x${string}`,
                  abi: STREAMPAY_ABI,
                  functionName: "streams",
                  args: [id],
                }) as [string, string, bigint, bigint, bigint, bigint, bigint, boolean];
                acc = await publicClient.readContract({
                  address: STREAMPAY_ADDRESS as `0x${string}`,
                  abi: STREAMPAY_ABI,
                  functionName: "accrued",
                  args: [id],
                });
                break;
              } catch (e: any) {
                if (e.message?.includes("limited to 15/sec") && retry < 2) {
                  await new Promise((r) => setTimeout(r, 1000));
                } else throw e;
              }
            }
            return { id: Number(id), payer: s![0], merchant: s![1], amountPerSecond: s![2], startTime: s![3], lastClaimed: s![4], totalPaid: s![5], duration: s![6], active: s![7], accrued: acc };
          })
        );
        results.push(...batchResults);
        if (i + batchSize < allIds.length) {
          await new Promise((r) => setTimeout(r, 500));
        }
      }

      const payerStreams = results.filter((r) => payerIds.includes(BigInt(r.id)));
      const mStreams = results.filter((r) => merchantIds.includes(BigInt(r.id)));
      setStreams(payerStreams);
      setMerchantStreams(mStreams);
      if (payerStreams.length > 0 || mStreams.length > 0) {
        addToast(`Loaded ${payerStreams.length + mStreams.length} stream(s)`, "info");
      }
    } catch (e: any) {
      console.error("Load error:", e);
      addToast("Load failed: " + (e.message || "unknown error"), "error");
    }
    setLoading(false);
  }, [userAddr, hasContract]);

  useEffect(() => {
    if (userAddr) loadStreams();
    const interval = setInterval(loadStreams, 5000);
    const tickInterval = setInterval(() => setTick(t => t + 1), 1000);
    return () => { clearInterval(interval); clearInterval(tickInterval); };
  }, [userAddr]);

  const connect = async () => {
    if (!(window as any).ethereum) { addToast("Install MetaMask", "error"); return; }
    const ok = await checkNetwork();
    setNetworkOk(ok);
    if (!ok) {
      try {
        await (window as any).ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x3013" }],
        });
        addToast("Switched to Monad testnet", "success");
      } catch (e: any) {
        if (e.code === 4902) {
          addToast("Add Monad testnet to MetaMask first", "error");
        } else if (e.code === -32603) {
          addToast("Already on Monad testnet — approve the connection", "info");
        } else {
          addToast(`Network issue: ${e.message}`, "error");
        }
      }
    }
    try {
      // Clear any pending permissions first
      try {
        await (window as any).ethereum.request({ method: "wallet_requestPermissions", params: [{ eth_accounts: {} }] });
      } catch (_) { /* ignore — permissions may already be granted */ }

      const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
      const wc = createWalletClient({ account: accounts[0], chain: monadTestnet, transport: custom((window as any).ethereum) });
      setUserAddr(accounts[0]);
      setWalletClient(wc);
      addToast("Connected: " + accounts[0].slice(0, 8) + "..." + accounts[0].slice(-6), "info");

      (window as any).ethereum.on("accountsChanged", (accs: string[]) => {
        if (accs.length > 0) {
          setUserAddr(accs[0]);
          addToast("Switched to: " + accs[0].slice(0, 8) + "..." + accs[0].slice(-6), "info");
          setTimeout(() => loadStreams(), 500);
        }
      });
    } catch (e: any) {
      if (e.code === -32002) {
        addToast("Approval already pending — check MetaMask or refresh the page", "error");
      } else if (e.code === 4001) {
        addToast("Connection rejected by user", "error");
      } else {
        addToast(`Connect failed: ${e.message}`, "error");
      }
    }
  };

  const handleCreateStream = async (merchant: string, perSecond: string, duration: string) => {
    if (!walletClient) { addToast("Wallet not connected", "error"); return; }
    if (!hasContract) { addToast("Contract not deployed", "error"); return; }
    if (!isValidAddress(merchant)) { addToast("Invalid merchant address", "error"); return; }

    setLoading(true);
    try {
      const amount = parseUnits(perSecond, 18);
      const dur = BigInt(duration === "" ? "0" : duration);

      const tokenAddr = await publicClient.readContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "paymentToken",
      }) as `0x${string}`;

      const TOKEN_ABI = parseAbi([
        "function allowance(address owner, address spender) view returns (uint256)",
        "function approve(address spender, uint256 amount) returns (bool)",
      ]);

      const allowance = await publicClient.readContract({
        address: tokenAddr,
        abi: TOKEN_ABI,
        functionName: "allowance",
        args: [userAddr as `0x${string}`, STREAMPAY_ADDRESS as `0x${string}`],
      });

      if (allowance < amount) {
        addToast("Approving tokens (max)...", "info");
        const { request } = await publicClient.simulateContract({
          address: tokenAddr,
          abi: TOKEN_ABI,
          functionName: "approve",
          args: [STREAMPAY_ADDRESS as `0x${string}`, (BigInt(2) ** BigInt(256)) - BigInt(1)],
          account: userAddr as `0x${string}`,
        });
        const hash = await walletClient.writeContract(request);
        await publicClient.waitForTransactionReceipt({ hash });
        addToast("Tokens approved", "success");
      }

      addToast("Creating stream...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "createStream",
        args: [merchant as `0x${string}`, amount, dur],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Stream created!", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleClaim = async (streamId: number) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Claiming...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "claim",
        args: [BigInt(streamId)],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Claimed!", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleCancel = async (streamId: number) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Cancelling stream...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "cancel",
        args: [BigInt(streamId)],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Stream cancelled", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleExtend = async (streamId: number, extraSec: string) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Extending stream...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "extendStream",
        args: [BigInt(streamId), BigInt(extraSec)],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Stream extended", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleTransfer = async (streamId: number, newPayer: string) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Transferring stream...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "transferStream",
        args: [BigInt(streamId), newPayer as `0x${string}`],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Stream transferred", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleEmergencyWithdraw = async (streamId: number) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Withdrawing...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "emergencyWithdraw",
        args: [BigInt(streamId)],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Funds withdrawn", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const handleClaimAfterExpiry = async (streamId: number) => {
    if (!walletClient) return;
    setLoading(true);
    try {
      addToast("Claiming after expiry...", "info");
      const { request } = await publicClient.simulateContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "claimAfterExpiry",
        args: [BigInt(streamId)],
        account: userAddr as `0x${string}`,
      });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Claimed after expiry", "success");
      loadStreams();
    } catch (e: any) {
      addToast(`Error: ${e.message}`, "error");
    }
    setLoading(false);
  };

  const formatDuration = (sec: bigint) => {
    if (sec === BigInt(0)) return "Unlimited";
    const d = Number(sec);
    const days = Math.floor(d / 86400);
    const hrs = Math.floor((d % 86400) / 3600);
    if (days > 0) return `${days}d ${hrs}h`;
    return `${hrs}h`;
  };

  return (
    <main className="min-h-screen bg-black text-green-400 p-8 font-mono">
      <h1 className="text-3xl font-bold mb-2">StreamPay</h1>
      <p className="text-green-600 mb-6">Per-second subscriptions on Monad — gasless for users</p>

      {!userAddr ? (
        <div className="bg-gray-900 border border-green-800 rounded-lg p-6 mb-6">
          <p className="text-gray-400 mb-4">Connect wallet to start.</p>
          <button onClick={connect} className="bg-green-700 hover:bg-green-600 text-white px-6 py-2 rounded">Connect MetaMask</button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-3 mb-4 text-sm flex-wrap">
            <span className="text-gray-400">Wallet:</span>
            <code className="bg-gray-900 px-2 py-1 rounded">{userAddr.slice(0, 8)}...{userAddr.slice(-6)}</code>
            <button onClick={() => copyToClipboard(userAddr)} className="text-green-600 underline text-xs">Copy</button>
            <span className="text-gray-400">|</span>
            <span className="text-gray-400">Contract:</span>
            <code className="bg-gray-900 px-2 py-1 rounded text-xs">{STREAMPAY_ADDRESS.slice(0, 8)}...{STREAMPAY_ADDRESS.slice(-6)}</code>
            <button onClick={() => copyToClipboard(STREAMPAY_ADDRESS)} className="text-green-600 underline text-xs">Copy</button>
            <button onClick={() => loadStreams()} disabled={loading} className="bg-gray-700 hover:bg-gray-600 text-white px-2 py-1 rounded text-xs ml-auto">Refresh</button>
          </div>

          <div className="fixed top-4 right-4 z-50 max-w-sm">
            {toasts.map((t, i) => (
              <Toast key={i} message={t.message} type={t.type} onClose={() => setToasts(prev => prev.filter((_, j) => j !== i))} />
            ))}
          </div>

          {!hasContract && (
            <div className="bg-red-900 border border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-400">Contract not set. Add NEXT_PUBLIC_STREAMPAY_ADDRESS to .env.local</p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-6 mb-8">
            <section className="bg-gray-900 border border-green-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Create Stream</h2>
              <StreamForm onCreate={handleCreateStream} loading={loading} />
            </section>
            <section className="bg-gray-900 border border-green-800 rounded-lg p-6 mb-6">
              <h2 className="text-xl font-bold mb-4">Your Streams (Payer)</h2>
              {streams.length === 0 ? (
                <div>
                  <p className="text-gray-500 mb-3">No streams yet.</p>
                  <button onClick={() => { handleCreateStream(userAddr || "0x0000000000000000000000000000000000000000", "0.001", "10"); }} disabled={loading || !userAddr} className="bg-blue-800 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">Create Test Stream (to yourself)</button>
                  <p className="text-xs text-gray-600 mt-2">This creates a stream from your account to yourself for testing.</p>
                </div>
              ) : (
                <ul className="space-y-2">{streams.map((s) => (
                  <li key={`payer-${s.id}`} className="border border-green-800 rounded p-3">
                    <p>Merchant: <code className="text-xs">{s.merchant.slice(0, 8)}...{s.merchant.slice(-6)}</code>
                      <button onClick={() => copyToClipboard(s.merchant)} className="ml-1 text-green-600 underline text-xs">Copy</button>
                    </p>
                    <p>Rate: {formatEther(s.amountPerSecond)} MON/sec</p>
                    <p>Accrued: {formatEther(s.accrued)} MON (tick: {tick})</p>
                    <p>Duration: {formatDuration(s.duration)}</p>
                    <p>Status: {s.active ? (s.duration > BigInt(0) && /* need to check expiry */ "Active") : "Inactive"}</p>
                    <p>Refund if cancel: {formatEther(s.totalPaid)} MON</p>
                    {s.active && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        <button onClick={() => handleCancel(s.id)} disabled={loading} className="bg-red-800 hover:bg-red-700 text-white px-3 py-1 rounded text-xs">Cancel</button>
                        <button onClick={() => { const ext = prompt("Extend by how many seconds?", "86400"); if (ext) handleExtend(s.id, ext); }} disabled={loading} className="bg-blue-800 hover:bg-blue-700 text-white px-3 py-1 rounded text-xs">Extend</button>
                        <button onClick={() => { const np = prompt("New payer address?"); if (np) handleTransfer(s.id, np); }} disabled={loading} className="bg-purple-800 hover:bg-purple-700 text-white px-3 py-1 rounded text-xs">Transfer</button>
                        <button onClick={() => handleEmergencyWithdraw(s.id)} disabled={loading} className="bg-orange-800 hover:bg-orange-700 text-white px-3 py-1 rounded text-xs">Withdraw</button>
                      </div>
                    )}
                    {!s.active && s.totalPaid > BigInt(0) && (
                      <button onClick={() => handleClaimAfterExpiry(s.id)} disabled={loading} className="mt-2 bg-yellow-800 hover:bg-yellow-700 text-white px-3 py-1 rounded text-xs">Claim After Expiry</button>
                    )}
                  </li>
                ))}</ul>
              )}
            </section>
          </div>

          <section className="bg-gray-900 border border-green-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Merchant Dashboard</h2>
            {merchantStreams.length === 0 ? (
              <div>
                <p className="text-gray-500 mb-3">No streams received.</p>
                <button onClick={() => { handleCreateStream(userAddr || "0x00000000000000000000000000000000000000", "0.001", "10"); }} disabled={loading || !userAddr} className="bg-blue-800 hover:bg-blue-700 text-white px-4 py-2 rounded text-sm">Create Test Stream (to yourself)</button>
                <p className="text-xs text-gray-600 mt-2">Creates a stream from your account to yourself for testing.</p>
              </div>
            ) : (
              <ul className="space-y-2">{merchantStreams.map((s) => (
                <li key={`merchant-${s.id}`} className="border border-green-800 rounded p-3 flex justify-between items-center">
                  <div>
                    <p>Payer: <code className="text-xs">{s.payer.slice(0, 8)}...{s.payer.slice(-6)}</code>
                      <button onClick={() => copyToClipboard(s.payer)} className="ml-1 text-green-600 underline text-xs">Copy</button>
                    </p>
                    <p>Rate: {formatEther(s.amountPerSecond)} MON/sec</p>
                    <p>Accrued: {formatEther(s.accrued)} MON (tick: {tick})</p>
                    <p>Duration: {formatDuration(s.duration)}</p>
                    <p>Active: {s.active ? "Yes" : "No"}</p>
                  </div>
                  <button onClick={() => handleClaim(s.id)} disabled={loading} className={`px-4 py-2 rounded text-sm ${s.active ? "bg-green-700 hover:bg-green-600" : "bg-yellow-700 hover:bg-yellow-600"} text-white disabled:opacity-50`}>{s.active ? "Claim" : "Claim After Expiry"}</button>
                </li>
              ))}</ul>
            )}
          </section>

          <AdminPanel address={userAddr} contract={STREAMPAY_ADDRESS} publicClient={publicClient} walletClient={walletClient} addToast={addToast} loadStreams={loadStreams} loading={loading} />
        </>
      )}
    </main>
  );
}

function StreamForm({ onCreate, loading }: { onCreate: (m: string, r: string, d: string) => void; loading: boolean }) {
  const [merchant, setMerchant] = useState("");
  const [rate, setRate] = useState("0.001");
  const [duration, setDuration] = useState("0");
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onCreate(merchant, rate, duration); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="block text-sm text-gray-400 mb-1">Merchant Address</label><input type="text" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x..." className="w-full bg-gray-800 border border-green-800 rounded px-3 py-2 text-green-400 font-mono" required /></div>
      <div><label className="block text-sm text-gray-400 mb-1">Rate (MON/sec)</label><input type="number" step="0.000001" value={rate} onChange={(e) => setRate(e.target.value)} className="w-full bg-gray-800 border border-green-800 rounded px-3 py-2 text-green-400 font-mono" required /></div>
      <div><label className="block text-sm text-gray-400 mb-1">Duration (seconds, 0 = unlimited)</label><input type="number" value={duration} onChange={(e) => setDuration(e.target.value)} placeholder="0" className="w-full bg-gray-800 border border-green-800 rounded px-3 py-2 text-green-400 font-mono" /></div>
      <button type="submit" disabled={loading} className="w-full bg-green-700 hover:bg-green-600 text-white py-2 rounded disabled:opacity-50">{loading ? "Creating..." : "Create Stream"}</button>
    </form>
  );
}

function AdminPanel({ address, contract, publicClient, walletClient, addToast, loadStreams, loading }: {
  address: string | undefined;
  contract: string;
  publicClient: any;
  walletClient: any;
  addToast: (msg: string, type: "success" | "error" | "info") => void;
  loadStreams: () => void;
  loading: boolean;
}) {
  const [adminAddr, setAdminAddr] = useState("");
  useEffect(() => { if (address) setAdminAddr(address.toLowerCase()); }, [address]);
  const isOwner = adminAddr === "0xcb19c6d23d0753228ed86039e790a624ea4670a1c";
  const [pauseMsg, setPauseMsg] = useState("");

  const doPause = async () => {
    if (!walletClient) return;
    try {
      const { request } = await publicClient.simulateContract({ address: contract as `0x${string}`, abi: STREAMPAY_ABI, functionName: "pause", account: address as `0x${string}` });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Paused", "success"); loadStreams();
    } catch (e: any) { addToast(`Error: ${e.message}`, "error"); }
  };
  const doUnpause = async () => {
    if (!walletClient) return;
    try {
      const { request } = await publicClient.simulateContract({ address: contract as `0x${string}`, abi: STREAMPAY_ABI, functionName: "unpause", account: address as `0x${string}` });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Unpaused", "success"); loadStreams();
    } catch (e: any) { addToast(`Error: ${e.message}`, "error"); }
  };
  const doSweep = async () => {
    if (!walletClient) return;
    try {
      const { request } = await publicClient.simulateContract({ address: contract as `0x${string}`, abi: STREAMPAY_ABI, functionName: "sweepTokens", args: [adminAddr as `0x${string}`, BigInt(0)], account: address as `0x${string}` });
      const hash = await walletClient.writeContract(request);
      await publicClient.waitForTransactionReceipt({ hash });
      addToast("Swept", "success"); loadStreams();
    } catch (e: any) { addToast(`Error: ${e.message}`, "error"); }
  };

  if (!isOwner) return null;
  return (
    <section className="bg-gray-900 border border-yellow-800 rounded-lg p-6 mb-6">
      <h2 className="text-xl font-bold mb-4 text-yellow-400">Admin Panel</h2>
      <div className="flex gap-3 flex-wrap">
        <button onClick={doPause} disabled={loading} className="bg-red-800 hover:bg-red-700 text-white px-4 py-2 rounded text-sm">Pause All</button>
        <button onClick={doUnpause} disabled={loading} className="bg-green-800 hover:bg-green-700 text-white px-4 py-2 rounded text-sm">Unpause All</button>
        <button onClick={doSweep} disabled={loading} className="bg-yellow-800 hover:bg-yellow-700 text-black px-4 py-2 rounded text-sm">Sweep Tokens</button>
      </div>
      <p className="text-xs text-gray-500 mt-2">Owner: 0xcb19...a1c</p>
    </section>
  );
}
