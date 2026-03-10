"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

interface Contact {
  id: string;
  name: string;
  organization: string | null;
  position: string | null;
  email: string | null;
  _count: { meetings: number };
}

type FormState = { name: string; organization: string; position: string; email: string; phone: string };

const EMPTY_FORM: FormState = { name: "", organization: "", position: "", email: "", phone: "" };

export default function ContactsPage() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [cardUrl, setCardUrl] = useState<string | null>(null);
  const [ocrData, setOcrData] = useState<Record<string, string> | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);

  async function fetchContacts(q = "") {
    const res = await fetch(`/api/contacts?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    setContacts(data);
  }

  useEffect(() => { fetchContacts(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchContacts(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        ...(cardUrl && { businessCardUrl: cardUrl }),
        ...(ocrData && { businessCardOcr: ocrData }),
      }),
    });
    if (res.ok) {
      setShowForm(false);
      setForm(EMPTY_FORM);
      setScanPreview(null);
      setCardUrl(null);
      setOcrData(null);
      fetchContacts(query);
    }
    setSaving(false);
  }

  async function handleCardScan(file: File) {
    setScanning(true);
    setScanPreview(URL.createObjectURL(file));
    setCardUrl(null);
    setOcrData(null);
    setShowForm(true);

    const fd = new FormData();
    fd.append("file", file);
    const res = await fetch("/api/ai/ocr-card", { method: "POST", body: fd });
    if (res.ok) {
      const data = await res.json();
      const { cardUrl: url, ...ocr } = data;
      setCardUrl(url ?? null);
      setOcrData(ocr);
      setForm({
        name: ocr.name ?? "",
        organization: ocr.organization ?? "",
        position: ocr.position ?? "",
        email: ocr.email ?? "",
        phone: ocr.phone ?? "",
      });
    }
    setScanning(false);
  }

  function openForm() {
    setForm(EMPTY_FORM);
    setScanPreview(null);
    setCardUrl(null);
    setOcrData(null);
    setShowForm(true);
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-2">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-lg font-bold text-gray-800 flex-1">連絡先</h1>
          <button
            onClick={() => cardInputRef.current?.click()}
            className="text-sm text-gray-500 hover:text-indigo-600 px-3 py-2 rounded-lg hover:bg-gray-100 transition-colors"
            title="名刺をスキャン"
          >
            📷 名刺
          </button>
          <button
            onClick={openForm}
            className="bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors"
          >
            ＋ 追加
          </button>
        </div>
      </header>

      {/* 名刺画像の隠しinput */}
      <input
        ref={cardInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleCardScan(file);
          e.target.value = "";
        }}
      />

      <main className="max-w-2xl mx-auto px-4 py-4 space-y-4">
        {/* 検索 */}
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="名前・組織で検索..."
          className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
        />

        {/* 連絡先一覧 */}
        {contacts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">連絡先がありません</p>
            <div className="mt-4 flex flex-col gap-2 items-center">
              <button
                onClick={() => cardInputRef.current?.click()}
                className="text-sm text-indigo-600 hover:underline"
              >
                📷 名刺をスキャンして追加
              </button>
              <button
                onClick={openForm}
                className="text-sm text-indigo-600 hover:underline"
              >
                手動で追加
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {contacts.map((contact) => (
              <Link
                key={contact.id}
                href={`/contacts/${contact.id}`}
                className="block bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm hover:border-indigo-200 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-gray-800 text-sm">{contact.name}</p>
                    {(contact.organization || contact.position) && (
                      <p className="text-xs text-gray-400 mt-0.5">
                        {[contact.position, contact.organization].filter(Boolean).join(" · ")}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-gray-400">{contact._count.meetings}回</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>

      {/* 新規追加・名刺スキャンモーダル */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-800">
                  {scanPreview ? "名刺スキャン結果" : "新しい連絡先"}
                </h2>
                <button
                  onClick={() => { setShowForm(false); setScanPreview(null); }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ✕
                </button>
              </div>

              {/* 名刺プレビュー */}
              {scanPreview && (
                <div className="mb-4 rounded-xl overflow-hidden border border-gray-200 relative">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={scanPreview} alt="名刺" className="w-full h-32 object-cover" />
                  {scanning && (
                    <div className="absolute inset-0 bg-white/80 flex items-center justify-center gap-2">
                      <div className="w-5 h-5 rounded-full border-2 border-indigo-300 border-t-indigo-600 animate-spin" />
                      <span className="text-sm text-indigo-600 font-medium">AIが読み取り中...</span>
                    </div>
                  )}
                </div>
              )}

              <form onSubmit={handleCreate} className="space-y-3">
                {[
                  { key: "name", label: "名前 *", placeholder: "山田 太郎", required: true },
                  { key: "organization", label: "組織・会社", placeholder: "株式会社〇〇", required: false },
                  { key: "position", label: "役職", placeholder: "部長", required: false },
                  { key: "email", label: "メール", placeholder: "taro@example.com", required: false },
                  { key: "phone", label: "電話番号", placeholder: "090-0000-0000", required: false },
                ].map(({ key, label, placeholder, required }) => (
                  <div key={key}>
                    <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                    <input
                      type="text"
                      value={form[key as keyof FormState]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                      placeholder={placeholder}
                      required={required}
                      disabled={scanning}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                  </div>
                ))}
                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => { setShowForm(false); setScanPreview(null); }}
                    className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                  >
                    キャンセル
                  </button>
                  <button
                    type="submit"
                    disabled={saving || scanning}
                    className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium transition-colors"
                  >
                    {saving ? "保存中..." : "保存"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
