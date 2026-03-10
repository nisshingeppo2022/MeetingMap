export type MeetingMode = "live" | "import" | "recall";
export type MeetingStatus = "recording" | "processing" | "completed";
export type NodeType = "root" | "topic" | "item" | "action";
export type ViewType = "full_map" | "topic" | "meeting";

export const NODE_STATUS_OPTIONS = [
  "アイデア段階",
  "企画中",
  "調整中",
  "進行中",
  "完了",
  "保留",
] as const;
export type NodeStatus = (typeof NODE_STATUS_OPTIONS)[number];

export const STATUS_COLORS: Record<NodeStatus, string> = {
  アイデア段階: "bg-gray-100 text-gray-700",
  企画中: "bg-blue-100 text-blue-700",
  調整中: "bg-yellow-100 text-yellow-700",
  進行中: "bg-green-100 text-green-700",
  完了: "bg-indigo-100 text-indigo-700",
  保留: "bg-red-100 text-red-700",
};

export interface TranscriptSegment {
  text: string;
  timestamp: number;
  isFinal: boolean;
}

export interface AiAnalysisResult {
  root: { label: string };
  nodes: AiNode[];
  topics: AiTopicCategory[];
  suggested_relations: AiRelation[];
  action_items: AiActionItem[];
}

export interface AiNode {
  label: string;
  type: NodeType;
  status?: string;
  is_secret?: boolean;
  children?: AiNode[];
}

export interface AiTopicCategory {
  category: string;
  items: AiTopicItem[];
}

export interface AiTopicItem {
  name: string;
  status: string;
  details: string;
  related_people: string[];
}

export interface AiRelation {
  description: string;
  related_contact: string;
}

export interface AiActionItem {
  task: string;
  assignee: string;
  deadline?: string;
}

export interface AiSuggestResult {
  keywords: string[];
  active_topics: string[];
  search_queries: string[];
}
