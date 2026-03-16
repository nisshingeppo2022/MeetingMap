"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Mode = "live" | "import" | "recall";

interface Contact {
  id: string;
  name: string;
  organization: string | null;
  position: string | null;
}

const MODES: { value: Mode; label: string; icon: string; desc: string }[] = [
  { value: "live", label: "リアルタイム録音", icon: "🎙️", desc: "今からミーティングを録音する" },
  { value: "import", label: "音声を取り込む", icon: "📂", desc: "録音済みの音声ファイルを使う" },
  { value: "recall", label: "振り返り入力", icon: "📝", desc: "テキストで内容を入力する" },
];

export default function NewMeetingPage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("live");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [selectedContacts, setSelectedContacts] = useState<Contact[]>([]);
  const [showContactList, setShowContactList] = useState(false);
  const [agenda, setAgenda] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch(`/api/contacts?q=${encodeURIComponent(query)}`)
      .then((r) => r.json())
      .then(setContacts);
  }, [query]);

  function toggleContact(c: Contact) {
    setSelectedContacts((prev) =>
      prev.find((x) => x.id === c.id)
        ? prev.filter((x) => x.id !== c.id)
        : [...prev, c]
    );
  }

  async function handleStart() {
    setCreating(true);
    const res = await fetch("/api/meetings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactIds: selectedContacts.map((c) => c.id), mode, agenda }),
    });
    if (res.ok) {
      const meeting = await res.json();
      if (mode === "recall") {
        router.push(`/meetings/${meeting.id}/recall`);
      } else if (mode === "import") {
        router.push(`/meetings/${meeting.id}/import`);
      } else {
        router.push(`/meetings/${meeting.id}/record`);
      }
    }
    setCreating(false);
  }

  const startLabel = mode === "live" ? "録音開始" : mode === "import" ? "取り込み開始" : "入力開始";

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-lg font-bold text-gray-800">新しいミーティング</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* モード選択 */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">モードを選ぶ</h2>
          <div className="space-y-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                onClick={() => setMode(m.value)}
                className={`w-full flex items-center gap-4 p-4 rounded-xl border-2 transition-colors text-left ${
                  mode === m.value
                    ? "border-indigo-500 bg-indigo-50"
                    : "border-gray-100 bg-white hover:border-gray-200"
                }`}
              >
                <span className="text-2xl">{m.icon}</span>
                <div>
                  <p className={`font-medium text-sm ${mode === m.value ? "text-indigo-700" : "text-gray-800"}`}>
                    {m.label}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">{m.desc}</p>
                </div>
                {mode === m.value && (
                  <span className="ml-auto text-indigo-500 text-lg">✓</span>
                )}
              </button>
            ))}
          </div>
        </section>

        {/* 相手を選ぶ（複数選択） */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">
            参加者を選ぶ（任意・複数選択可）
          </h2>

          {/* 選択済みの連絡先チップ */}
          {selectedContacts.length > 0 && (
            <div className="flex flex-wrap gap-2 mb-3">
              {selectedContacts.map((c) => (
                <span
                  key={c.id}
                  className="flex items-center gap-1.5 bg-indigo-100 text-indigo-700 text-sm px-3 py-1.5 rounded-full"
                >
                  <span className="font-medium">{c.name}</span>
                  <button
                    onClick={() => toggleContact(c)}
                    className="text-indigo-400 hover:text-indigo-700 leading-none"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
          )}

          <button
            onClick={() => setShowContactList(true)}
            className="w-full flex items-center gap-3 bg-white border-2 border-dashed border-gray-200 rounded-xl p-4 hover:border-indigo-300 transition-colors"
          >
            <span className="text-2xl">👥</span>
            <span className="text-sm text-gray-400">
              {selectedContacts.length > 0 ? "参加者を追加・変更する" : "連絡先から選ぶ"}
            </span>
          </button>
        </section>

        {/* アジェンダ */}
        <section>
          <h2 className="text-sm font-semibold text-gray-500 mb-3">
            今日話したいこと（任意）
          </h2>
          <textarea
            value={agenda}
            onChange={(e) => setAgenda(e.target.value)}
            placeholder="確認したいこと、提案したいことをメモ...&#10;入力するとAIがブリーフィングを作成します"
            className="w-full px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-300 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-400"
            rows={3}
          />
        </section>

        {/* 開始ボタン */}
        <button
          onClick={handleStart}
          disabled={creating}
          className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white font-semibold py-4 rounded-2xl transition-colors shadow-sm text-base"
        >
          {creating ? "準備中..." : `${MODES.find((m) => m.value === mode)?.icon} ${startLabel}`}
        </button>
      </main>

      {/* 連絡先選択モーダル（複数選択） */}
      {showContactList && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl flex flex-col max-h-[80vh]">
            <div className="p-4 border-b border-gray-100">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-gray-800">参加者を選ぶ</h2>
                  <p className="text-xs text-gray-400 mt-0.5">複数選択できます</p>
                </div>
                <button
                  onClick={() => { setShowContactList(false); setQuery(""); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="名前・組織で検索..."
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                autoFocus
              />
            </div>

            <div className="overflow-y-auto flex-1 p-2">
              {contacts.length === 0 ? (
                <p className="text-center text-gray-400 text-sm py-8">連絡先がありません</p>
              ) : (
                contacts.map((c) => {
                  const isSelected = selectedContacts.some((x) => x.id === c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => toggleContact(c)}
                      className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-colors text-left ${
                        isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                      }`}
                    >
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center font-bold text-sm flex-shrink-0 ${
                        isSelected ? "bg-indigo-500 text-white" : "bg-indigo-100 text-indigo-600"
                      }`}>
                        {isSelected ? "✓" : c.name[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className={`font-medium text-sm ${isSelected ? "text-indigo-700" : "text-gray-800"}`}>
                          {c.name}
                        </p>
                        {c.organization && (
                          <p className="text-xs text-gray-400 truncate">{c.organization}</p>
                        )}
                      </div>
                      {isSelected && (
                        <span className="text-indigo-500 text-xs font-medium">選択済み</span>
                      )}
                    </button>
                  );
                })
              )}
              <Link
                href="/contacts"
                className="flex items-center gap-2 px-3 py-3 text-sm text-indigo-600 hover:bg-indigo-50 rounded-xl transition-colors"
              >
                <span>＋</span> 新しい連絡先を追加
              </Link>
            </div>

            {/* 確定ボタン */}
            <div className="p-4 border-t border-gray-100">
              <button
                onClick={() => { setShowContactList(false); setQuery(""); }}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors"
              >
                {selectedContacts.length > 0
                  ? `${selectedContacts.length}名を選択して確定`
                  : "選択せずに閉じる"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
