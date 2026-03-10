import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function TopicsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  // 全ミーティングのtopicノードを取得
  const topicNodes = await prisma.mindmapNode.findMany({
    where: {
      meeting: { userId: user.id },
      nodeType: "topic",
    },
    include: {
      meeting: {
        include: { contact: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // ラベルでグループ化
  const grouped = new Map<string, typeof topicNodes>();
  for (const node of topicNodes) {
    const key = node.label;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(node);
  }

  const groupedArray = Array.from(grouped.entries())
    .sort((a, b) => b[1].length - a[1].length);

  const statusColors: Record<string, string> = {
    "企画中": "bg-blue-100 text-blue-700",
    "調整中": "bg-yellow-100 text-yellow-700",
    "進行中": "bg-green-100 text-green-700",
    "アイデア段階": "bg-purple-100 text-purple-700",
    "完了": "bg-gray-100 text-gray-600",
    "保留": "bg-red-100 text-red-700",
  };

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800">トピック別</h1>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        {groupedArray.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">トピックがまだありません</p>
            <p className="text-gray-400 text-xs mt-1">ミーティングのAI分析を実行するとトピックが作成されます</p>
          </div>
        ) : (
          groupedArray.map(([label, nodes]) => (
            <div key={label} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800 text-sm">{label}</h2>
                <span className="text-xs text-gray-400">{nodes.length}件のミーティング</span>
              </div>
              <div className="divide-y divide-gray-50">
                {nodes.map((node) => (
                  <Link
                    key={node.id}
                    href={`/meetings/${node.meetingId}/result`}
                    className="flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm text-gray-700 truncate">
                        {node.meeting.title ?? "タイトルなし"}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {node.meeting.contact?.name ?? "相手未設定"} ·{" "}
                        {new Date(node.meeting.date).toLocaleDateString("ja-JP")}
                      </p>
                    </div>
                    {node.status && (
                      <span className={`ml-3 flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${statusColors[node.status] ?? "bg-gray-100 text-gray-600"}`}>
                        {node.status}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))
        )}
      </main>
    </div>
  );
}
