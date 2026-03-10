import { createServerSupabaseClient } from "@/lib/supabase-server";
import { prisma } from "@/lib/prisma";
import Link from "next/link";

export default async function ActionsPage() {
  const supabase = await createServerSupabaseClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const actionNodes = await prisma.mindmapNode.findMany({
    where: {
      meeting: { userId: user.id },
      nodeType: "action",
    },
    include: {
      meeting: { include: { contact: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  const statusGroups: Record<string, typeof actionNodes> = {
    "未完了": actionNodes.filter((n) => !n.status || n.status !== "完了"),
    "完了": actionNodes.filter((n) => n.status === "完了"),
  };

  const statusColors: Record<string, string> = {
    "企画中": "bg-blue-100 text-blue-700",
    "調整中": "bg-yellow-100 text-yellow-700",
    "進行中": "bg-green-100 text-green-700",
    "アイデア段階": "bg-purple-100 text-purple-700",
    "完了": "bg-gray-100 text-gray-500",
    "保留": "bg-red-100 text-red-700",
  };

  const totalPending = statusGroups["未完了"].length;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      <header className="bg-white border-b border-gray-100 px-4 py-4 sticky top-0 z-10">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <Link href="/" className="text-gray-400 hover:text-gray-600 text-xl">←</Link>
          <h1 className="text-base font-bold text-gray-800 flex-1">アクションアイテム</h1>
          {totalPending > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
              {totalPending}件未完了
            </span>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {actionNodes.length === 0 ? (
          <div className="bg-white rounded-2xl border border-gray-100 p-8 text-center shadow-sm">
            <p className="text-gray-400 text-sm">アクションアイテムがまだありません</p>
            <p className="text-gray-400 text-xs mt-1">ミーティングのAI分析を実行すると自動で追加されます</p>
          </div>
        ) : (
          Object.entries(statusGroups).map(([groupName, nodes]) => {
            if (nodes.length === 0) return null;
            return (
              <div key={groupName}>
                <h2 className="text-sm font-semibold text-gray-500 mb-2">
                  {groupName}（{nodes.length}件）
                </h2>
                <div className="space-y-2">
                  {nodes.map((node) => (
                    <Link
                      key={node.id}
                      href={`/meetings/${node.meetingId}/result`}
                      className="block bg-white rounded-xl border border-gray-100 px-4 py-3 shadow-sm hover:border-indigo-200 transition-colors"
                    >
                      <div className="flex items-start gap-3">
                        <div className={`mt-0.5 w-4 h-4 rounded-full border-2 flex-shrink-0 ${
                          node.status === "完了" ? "bg-gray-300 border-gray-300" : "border-amber-400"
                        }`} />
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm font-medium ${node.status === "完了" ? "text-gray-400 line-through" : "text-gray-800"}`}>
                            {node.label}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {node.meeting.title ?? "タイトルなし"} ·{" "}
                            {node.meeting.contact?.name ?? "相手未設定"} ·{" "}
                            {new Date(node.meeting.date).toLocaleDateString("ja-JP")}
                          </p>
                        </div>
                        {node.status && node.status !== "完了" && (
                          <span className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full ${statusColors[node.status] ?? "bg-gray-100 text-gray-500"}`}>
                            {node.status}
                          </span>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </main>
    </div>
  );
}
