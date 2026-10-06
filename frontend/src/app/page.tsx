"use client";

import { useState, useEffect, useCallback } from "react";
import { createPublicClient, createWalletClient, http, formatEther, parseUnits, monadTestnet } from "viem";

const STREAMPAY_ADDRESS = (process.env.NEXT_PUBLIC_STREAMPAY_ADDRESS || "") as string;

const RPC = "https://testnet-rpc.monad.xyz";

const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(RPC),
});

const STREAMPAY_ABI = [
  "function createStream(address _merchant, uint256 _amountPerSecond) external returns (uint256)",
  "function claim(uint256 _streamId) external returns (uint256)",
  "function cancel(uint256 _streamId) external",
  "function accrued(uint256 _streamId) external view returns (uint256)",
  "function streams(uint256) external view returns (address payer, address merchant, uint256 amountPerSecond, uint256 startTime, uint256 lastClaimed, uint256 totalPaid, bool active)",
  "function getPayerStreams(address) external view returns (uint256[])",
  "function getMerchantStreams(address) external view returns (uint256[])",
  "function paymentToken() external view returns (address)",
] as const;

function isValidAddress(addr: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(addr);
}

export default function Home() {
  const [userAddr, setUserAddr] = useState<string | undefined>();
  const [walletClient, setWalletClient] = useState<any>();
  const [streams, setStreams] = useState<any[]>([]);
  const [merchantStreams, setMerchantStreams] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  const hasContract = isValidAddress(STREAMPAY_ADDRESS);

  const loadStreams = useCallback(async () => {
    if (!userAddr || !hasContract) return;
    try {
      const payerIds = await publicClient.readContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "getPayerStreams",
        args: [userAddr as `0x${string}`],
      });
      const merchantIds = await publicClient.readContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "getMerchantStreams",
        args: [userAddr as `0x${string}`],
      });

      const payerStreams = await Promise.all(
        (payerIds as bigint[]).map(async (id) => {
          const s = await publicClient.readContract({
            address: STREAMPAY_ADDRESS as `0x${string}`,
            abi: STREAMPAY_ABI,
            functionName: "streams",
            args: [id],
          }) as [string, string, bigint, bigint, bigint, bigint, boolean];
          const acc = await publicClient.readContract({
            address: STREAMPAY_ADDRESS as `0x${string}`,
            abi: STREAMPAY_ABI,
            functionName: "accrued",
            args: [id],
          });
          return { id: Number(id), payer: s[0], merchant: s[1], amountPerSecond: s[2], startTime: s[3], lastClaimed: s[4], totalPaid: s[5], active: s[6], accrued: acc };
        })
      );

      const mStreams = await Promise.all(
        (merchantIds as bigint[]).map(async (id) => {
          const s = await publicClient.readContract({
            address: STREAMPAY_ADDRESS as `0x${string}`,
            abi: STREAMPAY_ABI,
            functionName: "streams",
            args: [id],
          }) as [string, string, bigint, bigint, bigint, bigint, boolean];
          const acc = await publicClient.readContract({
            address: STREAMPAY_ADDRESS as `0x${string}`,
            abi: STREAMPAY_ABI,
            functionName: "accrued",
            args: [id],
          });
          return { id: Number(id), payer: s[0], merchant: s[1], amountPerSecond: s[2], startTime: s[3], lastClaimed: s[4], totalPaid: s[5], active: s[6], accrued: acc };
        })
      );

      setStreams(payerStreams);
      setMerchantStreams(mStreams);
    } catch (e) {
      console.error("Load error:", e);
    }
  }, [userAddr, hasContract]);

  useEffect(() => {
    if (userAddr) loadStreams();
  }, [userAddr]);

  const connect = async () => {
    if (!(window as any).ethereum) { setMessage("Install MetaMask"); return; }
    const accounts = await (window as any).ethereum.request({ method: "eth_requestAccounts" });
    const wc = createWalletClient({ account: accounts[0], chain: monadTestnet, transport: http() });
    setUserAddr(accounts[0]);
    setWalletClient(wc);
  };

  const createStream = async (merchant: string, perSecond: string) => {
    if (!walletClient) { setMessage("Wallet not connected"); return; }
    if (!hasContract) { setMessage("Contract not deployed — set NEXT_PUBLIC_STREAMPAY_ADDRESS in .env.local"); return; }
    setLoading(true); setMessage("Creating stream...");
    try {
      const hash = await walletClient.writeContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "createStream",
        args: [merchant as `0x${string}`, parseUnits(perSecond, 18)],
      });
      setMessage(`Tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage("Stream created!"); loadStreams();
    } catch (e: any) { setMessage(`Error: ${e.message}`); }
    setLoading(false);
  };

  const claim = async (streamId: number) => {
    if (!walletClient || !hasContract) return;
    setLoading(true); setMessage("Claiming...");
    try {
      const hash = await walletClient.writeContract({
        address: STREAMPAY_ADDRESS as `0x${string}`,
        abi: STREAMPAY_ABI,
        functionName: "claim",
        args: [BigInt(streamId)],
      });
      setMessage(`Tx: ${hash}`);
      await publicClient.waitForTransactionReceipt({ hash });
      setMessage("Claimed!"); loadStreams();
    } catch (e: any) { setMessage(`Error: ${e.message}`); }
    setLoading(false);
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
          {!hasContract && (
            <div className="bg-red-900 border border-red-800 rounded-lg p-4 mb-6">
              <p className="text-red-400">Contract address not set. Add NEXT_PUBLIC_STREAMPAY_ADDRESS to .env.local</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-6 mb-8">
            <section className="bg-gray-900 border border-green-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Create Stream</h2>
              <StreamForm onCreate={createStream} loading={loading} />
            </section>
            <section className="bg-gray-900 border border-green-800 rounded-lg p-6">
              <h2 className="text-xl font-bold mb-4">Your Streams (Payer)</h2>
              {streams.length === 0 ? <p className="text-gray-500">No active streams.</p> : (
                <ul className="space-y-2">{streams.map((s) => (
                  <li key={s.id} className="border border-green-800 rounded p-3">
                    <p>Merchant: {s.merchant}</p>
                    <p>Rate: {formatEther(s.amountPerSecond)} MON/sec</p>
                    <p>Accrued: {formatEther(s.accrued)} MON</p>
                    <p>Active: {s.active ? "Yes" : "No"}</p>
                  </li>
                ))}</ul>
              )}
            </section>
          </div>
          <section className="bg-gray-900 border border-green-800 rounded-lg p-6 mb-6">
            <h2 className="text-xl font-bold mb-4">Merchant Dashboard</h2>
            {merchantStreams.length === 0 ? <p className="text-gray-500">No streams received.</p> : (
              <ul className="space-y-2">{merchantStreams.map((s) => (
                <li key={s.id} className="border border-green-800 rounded p-3 flex justify-between items-center">
                  <div><p>Payer: {s.payer}</p><p>Rate: {formatEther(s.amountPerSecond)} MON/sec</p><p>Accrued: {formatEther(s.accrued)} MON</p></div>
                  <button onClick={() => claim(s.id)} disabled={loading || s.accrued === BigInt(0)} className="bg-green-700 hover:bg-green-600 text-white px-4 py-2 rounded disabled:opacity-50">Claim</button>
                </li>
              ))}</ul>
            )}
          </section>
          {message && <div className="bg-gray-900 border border-green-800 rounded-lg p-4 mb-6"><p>{message}</p></div>}
        </>
      )}
    </main>
  );
}

function StreamForm({ onCreate, loading }: { onCreate: (m: string, r: string) => void; loading: boolean }) {
  const [merchant, setMerchant] = useState("");
  const [rate, setRate] = useState("0.001");
  const handleSubmit = (e: React.FormEvent) => { e.preventDefault(); onCreate(merchant, rate); };
  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div><label className="block text-sm text-gray-400 mb-1">Merchant Address</label><input type="text" value={merchant} onChange={(e) => setMerchant(e.target.value)} placeholder="0x..." className="w-full bg-gray-800 border border-green-800 rounded px-3 py-2 text-green-400 font-mono" required /></div>
      <div><label className="block text-sm text-gray-400 mb-1">Rate (MON/sec)</label><input type="number" step="0.000001" value={rate} onChange={(e) => setRate(e.target.value)} className="w-full bg-gray-800 border border-green-800 rounded px-3 py-2 text-green-400 font-mono" required /></div>
      <button type="submit" disabled={loading} className="w-full bg-green-700 hover:bg-green-600 text-white py-2 rounded disabled:opacity-50">{loading ? "Creating..." : "Create Stream"}</button>
    </form>
  );
}
