"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Meeting {
  id: string;
  title: string | null;
  status: string;
  date: string;
  mode: string;
  contact: { name: string } | null;
  meetingContacts?: { contact: { name: string } }[];
}

const modeLabel: Record<string, string> = {
  live: "リアルタイム",
  import: "取り込み",
  recall: "振り返り",
};

const statusLabel: Record<string, string> = {
  recording: "録音中",
  processing: "処理中",
  completed: "完了",
};

export default function MeetingList({ initialMeetings }: { initialMeetings: Meeting[] }) {
  const router = useRouter();
  const [meetings, setMeetings] = useState(initialMeetings);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectMode, setSelectMode] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [search, setSearch] = useState("");

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function deleteMeetings(ids: string[]) {
    setDeleting(true);
    await Promise.all(
      ids.map((id) =>
        fetch(`/api/meetings/${id}`, { method: "DELETE" })
      )
    );
    setMeetings((prev) => prev.filter((m) => !ids.includes(m.id)));
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    router.refresh();
  }

  async function handleDeleteSelected() {
    if (selected.size === 0) return;
    if (!confirm(`${selected.size}件のミーティングを削除しますか？`)) return;
    await deleteMeetings(Array.from(selected));
  }

  async function handleDeleteSingle(id: string, e: React.MouseEvent) {
    e.preventDefault();
    if (!confirm("このミーティングを削除しますか？")) return;
    await deleteMeetings([id]);
  }

  function getContactNames(m: Meeting): string {
    const names = m.meetingContacts?.map((mc) => mc.contact.name) ?? [];
    if (names.length === 0 && m.contact) names.push(m.contact.name);
    return names.join("・");
  }

  const filtered = search.trim()
    ? meetings.filter((m) =>
        (m.title ?? "").toLowerCase().includes(search.toLowerCase()) ||
        getContactNames(m).toLowerCase().includes(search.toLowerCase())
      )
    : meetings;

  if (meetings.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
        <p className="text-gray-400 text-sm">まだミーティングがありません</p>
        <p className="text-gray-400 text-xs mt-1">上のボタンから始めましょう</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold text-gray-500">最近のミーティング</h2>
        <div className="flex gap-2">
          {selectMode && selected.size > 0 && (
            <button
              onClick={handleDeleteSelected}
              disabled={deleting}
              className="text-xs px-3 py-1 rounded-full bg-red-100 text-red-600 hover:bg-red-200 transition-colors disabled:opacity-50"
            >
              {deleting ? "削除中..." : `${selected.size}件削除`}
            </button>
          )}
          <button
            onClick={() => {
              setSelectMode((v) => !v);
              setSelected(new Set());
            }}
            className="text-xs px-3 py-1 rounded-full border border-gray-200 text-gray-500 hover:border-gray-300 transition-colors"
          >
            {selectMode ? "キャンセル" : "選択"}
          </button>
        </div>
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="タイトル・相手で検索..."
        className="w-full mb-3 px-3 py-2 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-300 focus:outline-none focus:ring-2 focus:ring-indigo-300"
      />

      <div className="space-y-2">
        {filtered.length === 0 && (
          <p className="text-center text-gray-400 text-sm py-4">該当するミーティングがありません</p>
        )}
        {filtered.map((meeting) => {
          const isSelected = selected.has(meeting.id);
          const card = (
            <div
              key={meeting.id}
              className={`flex items-center gap-3 bg-white rounded-xl border px-4 py-3 shadow-sm transition-colors ${
                selectMode
                  ? isSelected
                    ? "border-indigo-400 bg-indigo-50"
                    : "border-gray-100 cursor-pointer hover:border-indigo-200"
                  : "border-gray-100 hover:border-indigo-200"
              }`}
              onClick={selectMode ? () => toggleSelect(meeting.id) : undefined}
            >
              {selectMode && (
                <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center flex-shrink-0 ${isSelected ? "border-indigo-500 bg-indigo-500" : "border-gray-300"}`}>
                  {isSelected && <span className="text-white text-xs">✓</span>}
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="font-medium text-gray-800 text-sm truncate">
                  {meeting.title ?? "タイトルなし"}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {getContactNames(meeting) || "参加者未設定"} ·{" "}
                  {new Date(meeting.date).toLocaleDateString("ja-JP")} ·{" "}
                  {modeLabel[meeting.mode]}
                </p>
              </div>
              <span className="flex-shrink-0 text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                {statusLabel[meeting.status]}
              </span>
              {!selectMode && (
                <button
                  onClick={(e) => handleDeleteSingle(meeting.id, e)}
                  className="flex-shrink-0 text-gray-300 hover:text-red-400 transition-colors text-sm ml-1"
                  title="削除"
                >
                  ✕
                </button>
              )}
            </div>
          );

          return selectMode ? (
            <div key={meeting.id}>{card}</div>
          ) : (
            <Link key={meeting.id} href={`/meetings/${meeting.id}/result`}>
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
