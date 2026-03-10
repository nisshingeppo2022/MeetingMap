import { prisma } from "@/lib/prisma";
import { notFound } from "next/navigation";
import { STATUS_COLORS, type NodeStatus } from "@/types";

interface MindmapNode {
  id: string;
  parentId: string | null;
  label: string;
  nodeType: string;
  status: string | null;
  isVisible: boolean;
  isSecret: boolean;
  children?: MindmapNode[];
}

function buildTree(nodes: MindmapNode[]): MindmapNode[] {
  const map = new Map<string, MindmapNode>();
  nodes.forEach((n) => map.set(n.id, { ...n, children: [] }));
  const roots: MindmapNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

function NodeItem({ node, depth }: { node: MindmapNode; depth: number }) {
  if (!node.isVisible) return null;
  const indent = depth * 16;
  return (
    <div>
      <div
        className={`flex items-center gap-2 py-1.5 ${depth > 0 ? "border-l border-gray-200" : ""}`}
        style={{ paddingLeft: indent + 8 }}
      >
        <span
          className={`text-sm ${
            node.nodeType === "root"
              ? "font-bold text-indigo-700"
              : node.nodeType === "topic"
              ? "font-semibold text-gray-800"
              : node.nodeType === "action"
              ? "text-amber-700"
              : "text-gray-700"
          }`}
        >
          {node.nodeType === "action" ? "▶ " : ""}{node.label}
        </span>
        {node.status && (
          <span className={`text-xs px-1.5 py-0.5 rounded-full ${STATUS_COLORS[node.status as NodeStatus] ?? "bg-gray-100 text-gray-500"}`}>
            {node.status}
          </span>
        )}
      </div>
      {node.children?.map((child) => (
        <NodeItem key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export default async function SharePage({ params }: { params: { token: string } }) {
  const shareLink = await prisma.shareLink.findUnique({
    where: { token: params.token },
  });

  if (!shareLink) notFound();
  if (shareLink.expiresAt && shareLink.expiresAt < new Date()) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 font-medium">このリンクは期限切れです</p>
        </div>
      </div>
    );
  }

  const config = shareLink.filterConfig as { meetingId?: string } | null;
  if (!config?.meetingId) notFound();

  const meeting = await prisma.meeting.findUnique({
    where: { id: config.meetingId },
    include: {
      contact: true,
      mindmapNodes: { orderBy: { sortOrder: "asc" } },
    },
  });

  if (!meeting) notFound();

  const visibleNodes = meeting.mindmapNodes.filter((n) => !n.isSecret);
  const tree = buildTree(visibleNodes as MindmapNode[]);

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-100 px-4 py-4">
        <div className="max-w-2xl mx-auto">
          <p className="text-xs text-indigo-600 font-medium mb-1">MeetingMap 共有</p>
          <h1 className="text-lg font-bold text-gray-800">
            {meeting.title ?? "ミーティング"}
          </h1>
          {meeting.contact && (
            <p className="text-sm text-gray-400 mt-0.5">
              {meeting.contact.name}
              {meeting.contact.organization && ` · ${meeting.contact.organization}`}
              {" · "}{new Date(meeting.date).toLocaleDateString("ja-JP")}
            </p>
          )}
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          {tree.map((node) => (
            <NodeItem key={node.id} node={node} depth={0} />
          ))}
        </div>
      </main>
    </div>
  );
}
