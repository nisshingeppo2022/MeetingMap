"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DeviceToken {
  id: string;
  deviceName: string | null;
  active: boolean;
  createdAt: string;
  lastUsedAt: string | null;
}

export default function DevicesPage() {
  const [tokens, setTokens] = useState<DeviceToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [deviceName, setDeviceName] = useState("iPhone");
  const [issuing, setIssuing] = useState(false);
  const [issuedToken, setIssuedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/device-tokens");
    if (res.ok) setTokens(await res.json());
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function copyToClipboard(text: string): Promise<boolean> {
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // fall through to legacy
      }
    }
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    try {
      return document.execCommand("copy");
    } finally {
      document.body.removeChild(textarea);
    }
  }

  async function handleIssue() {
    setIssuing(true);
    setIssuedToken(null);
    setCopied(false);
    const res = await fetch("/api/device-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ deviceName: deviceName.trim() || null }),
    });
    if (res.ok) {
      const data = await res.json();
      setIssuedToken(data.token);
      await load();
    }
    setIssuing(false);
  }

  async function handleCopy() {
    if (!issuedToken) return;
    const ok = await copyToClipboard(issuedToken);
    if (ok) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } else {
      window.prompt("トークンをコピーしてください:", issuedToken);
    }
  }

  async function handleRevoke(id: string) {
    if (!confirm("このトークンを無効化しますか？このデバイスからの記録ができなくなります。")) return;
    await fetch(`/api/device-tokens/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: false }),
    });
    await load();
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-lg font-bold text-gray-800">デバイス連携</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 shadow-sm space-y-3">
          <div>
            <p className="text-sm font-semibold text-gray-800">新しいデバイストークンを発行</p>
            <p className="text-xs text-gray-400 mt-0.5">
              iOSショートカット等からクイックキャプチャAPIを呼ぶための鍵です
            </p>
          </div>
          <input
            type="text"
            value={deviceName}
            onChange={(e) => setDeviceName(e.target.value)}
            placeholder="デバイス名（例: iPhone）"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          />
          <button
            onClick={handleIssue}
            disabled={issuing}
            className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium transition-colors"
          >
            {issuing ? "発行中..." : "トークンを発行"}
          </button>

          {issuedToken && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 space-y-2">
              <p className="text-xs text-amber-700 font-medium">
                この画面を閉じると二度と表示されません。今すぐコピーしてください。
              </p>
              <p className="text-xs font-mono text-gray-700 break-all bg-white rounded-lg p-2 border border-amber-100">
                {issuedToken}
              </p>
              <button
                onClick={handleCopy}
                className="w-full py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium transition-colors"
              >
                {copied ? "コピーしました ✓" : "コピー"}
              </button>
            </div>
          )}
        </div>

        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">発行済みトークン</h2>
          {loading ? (
            <p className="text-center text-gray-400 text-sm py-8">読み込み中...</p>
          ) : tokens.length === 0 ? (
            <div className="bg-white rounded-2xl border border-gray-100 p-6 text-center shadow-sm">
              <p className="text-gray-400 text-sm">まだ発行されていません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tokens.map((t) => (
                <div key={t.id} className="bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-800 text-sm truncate">{t.deviceName ?? "名称未設定"}</p>
                      {!t.active && (
                        <span className="text-xs px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-400 flex-shrink-0">無効</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">
                      発行: {new Date(t.createdAt).toLocaleDateString("ja-JP")}
                      {t.lastUsedAt && ` · 最終利用: ${new Date(t.lastUsedAt).toLocaleDateString("ja-JP")}`}
                    </p>
                  </div>
                  {t.active && (
                    <button
                      onClick={() => handleRevoke(t.id)}
                      className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full bg-red-50 hover:bg-red-100 text-red-500 transition-colors"
                    >
                      無効化
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
