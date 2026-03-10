"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

interface Contact {
  id: string;
  name: string;
  organization: string | null;
  position: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  businessCardUrl: string | null;
  meetings: {
    id: string;
    title: string | null;
    date: string;
    mode: string;
    status: string;
    durationSeconds: number | null;
  }[];
}

const modeLabel: Record<string, string> = { live: "リアルタイム", import: "取り込み", recall: "振り返り" };
const statusLabel: Record<string, string> = { recording: "録音中", processing: "処理中", completed: "完了" };

export default function ContactDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [contact, setContact] = useState<Contact | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ name: "", organization: "", position: "", email: "", phone: "", notes: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/contacts/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setContact(data);
        setForm({
          name: data.name ?? "",
          organization: data.organization ?? "",
          position: data.position ?? "",
          email: data.email ?? "",
          phone: data.phone ?? "",
          notes: data.notes ?? "",
        });
      });
  }, [id]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/contacts/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setContact((prev) => prev ? { ...prev, ...form } : prev);
    setEditing(false);
    setSaving(false);
  }

  async function handleDelete() {
    if (!confirm(`「${contact?.name}」を削除しますか？`)) return;
    await fetch(`/api/contacts/${id}`, { method: "DELETE" });
    router.push("/contacts");
  }

  if (!contact) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-gray-400 text-sm">読み込み中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/contacts" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-lg font-bold text-gray-800 flex-1 truncate">{contact.name}</h1>
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            編集
          </button>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {/* プロフィール */}
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm space-y-3">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 rounded-full bg-indigo-100 flex items-center justify-center text-2xl font-bold text-indigo-600 flex-shrink-0">
              {contact.name[0]}
            </div>
            <div>
              <p className="font-semibold text-gray-800">{contact.name}</p>
              {contact.position && <p className="text-sm text-gray-500">{contact.position}</p>}
              {contact.organization && <p className="text-sm text-gray-400">{contact.organization}</p>}
            </div>
          </div>
          {contact.email && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-gray-400">✉️</span> {contact.email}
            </div>
          )}
          {contact.phone && (
            <div className="flex items-center gap-2 text-sm text-gray-600">
              <span className="text-gray-400">📞</span> {contact.phone}
            </div>
          )}
          {contact.notes && (
            <div className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">
              {contact.notes}
            </div>
          )}

          {/* 名刺画像 */}
          {contact.businessCardUrl && (
            <div>
              <p className="text-xs text-gray-400 mb-1.5">名刺</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={contact.businessCardUrl}
                alt="名刺"
                className="w-full rounded-xl border border-gray-100 object-contain max-h-48 bg-gray-50"
              />
            </div>
          )}
        </div>

        {/* ミーティング履歴 */}
        <div>
          <h2 className="text-sm font-semibold text-gray-500 mb-2">
            ミーティング履歴（{contact.meetings.length}件）
          </h2>
          {contact.meetings.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 p-5 text-center shadow-sm">
              <p className="text-gray-400 text-sm">まだミーティングがありません</p>
            </div>
          ) : (
            <div className="space-y-2">
              {contact.meetings.map((m) => (
                <Link
                  key={m.id}
                  href={`/meetings/${m.id}/result`}
                  className="block bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm hover:border-indigo-200 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{m.title ?? "タイトルなし"}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {new Date(m.date).toLocaleDateString("ja-JP")} · {modeLabel[m.mode]}
                        {m.durationSeconds && ` · ${Math.round(m.durationSeconds / 60)}分`}
                      </p>
                    </div>
                    <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded-full">
                      {statusLabel[m.status]}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        {/* 削除ボタン */}
        <button
          onClick={handleDelete}
          className="w-full py-3 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 rounded-xl transition-colors"
        >
          この連絡先を削除
        </button>
      </main>

      {/* 編集モーダル */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-gray-800 mb-4">連絡先を編集</h2>
            <form onSubmit={handleSave} className="space-y-3">
              {[
                { key: "name", label: "名前 *", required: true },
                { key: "organization", label: "組織・会社", required: false },
                { key: "position", label: "役職", required: false },
                { key: "email", label: "メール", required: false },
                { key: "phone", label: "電話番号", required: false },
              ].map(({ key, label, required }) => (
                <div key={key}>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                  <input
                    type="text"
                    value={form[key as keyof typeof form]}
                    onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    required={required}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                </div>
              ))}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">メモ</label>
                <textarea
                  value={form.notes}
                  onChange={(e) => setForm({ ...form, notes: e.target.value })}
                  rows={3}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                />
              </div>
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="flex-1 py-2.5 border border-gray-200 rounded-lg text-sm text-gray-600 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-300 text-white rounded-lg text-sm font-medium transition-colors"
                >
                  {saving ? "保存中..." : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
