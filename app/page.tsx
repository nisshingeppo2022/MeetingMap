import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import Link from "next/link";
import MeetingList from "./components/MeetingList";

export default async function HomePage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();

  const [meetings, contactCount, pendingActions] = user
    ? await Promise.all([
        prisma.meeting.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          include: {
            contact: true,
            meetingContacts: { include: { contact: { select: { name: true } } } },
          },
        }),
        prisma.contact.count({ where: { userId: user.id } }),
        prisma.mindmapNode.count({
          where: {
            meeting: { userId: user.id },
            nodeType: "action",
            NOT: { status: "完了" },
          },
        }),
      ])
    : [[], 0, 0];

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-indigo-700">MeetingMap</h1>
          <form action="/auth/signout" method="post">
            <button className="text-sm text-gray-400 hover:text-gray-600">ログアウト</button>
          </form>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">
        {/* 新しいミーティングボタン */}
        <Link
          href="/meetings/new"
          className="block w-full bg-indigo-600 hover:bg-indigo-700 text-white text-center font-semibold py-4 rounded-2xl transition-colors shadow-sm"
        >
          🎙️ 新しいミーティングを始める
        </Link>

        {/* サマリー */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm text-center">
            <p className="text-2xl font-bold text-indigo-600">{meetings.length}</p>
            <p className="text-xs text-gray-400 mt-0.5">ミーティング</p>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm text-center">
            <p className="text-2xl font-bold text-indigo-600">{contactCount}</p>
            <p className="text-xs text-gray-400 mt-0.5">連絡先</p>
          </div>
          <Link href="/actions" className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm text-center hover:border-amber-300 transition-colors">
            <p className={`text-2xl font-bold ${pendingActions > 0 ? "text-amber-500" : "text-gray-300"}`}>
              {pendingActions}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">未完了タスク</p>
          </Link>
        </div>

        {/* 最近のミーティング */}
        <MeetingList initialMeetings={meetings.map((m) => ({
          ...m,
          date: m.date.toISOString(),
          meetingContacts: m.meetingContacts,
        }))} />
      </main>
    </div>
  );
}
