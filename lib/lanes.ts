export interface Lane {
  id: string;
  label: string;
  tags: string[];
  bgColor: string;
}

export const LANES: Lane[] = [
  {
    id: "stem",
    label: "🤖 STEM・教育",
    bgColor: "#eff6ff",
    tags: [
      "ロボット教育",
      "情報教育の推進",
      "AI教育",
      "デジタルものづくり",
      "GBC活動",
      "情報活用能力",
    ],
  },
  {
    id: "community",
    label: "🤝 連携・組織",
    bgColor: "#fefce8",
    tags: [
      "コミュニティ形成",
      "共同プロジェクト",
      "イベント企画・運営",
      "人材育成",
      "裏方支援",
    ],
  },
  {
    id: "school",
    label: "🏫 学校・支援",
    bgColor: "#f0fdf4",
    tags: [
      "学びの多様化学校",
      "不登校支援",
      "社会の変化と教育",
      "教員不足",
      "通信制授業",
    ],
  },
  {
    id: "vision",
    label: "💡 ビジョン",
    bgColor: "#faf5ff",
    tags: [
      "VR活動の可能性",
      "VRコンテンツ制作",
      "文化祭でのVR活用",
      "宇宙開発",
      "AIと人間の共存",
      "覚悟と献身",
    ],
  },
  {
    id: "management",
    label: "💰 運営・実務",
    bgColor: "#fff7ed",
    tags: [
      "予算と調達",
      "活動の継続と発展",
      "アイデア出し",
      "企画会議",
      "プロフェッショナル意識",
    ],
  },
];

export const OTHER_LANE: Lane = { id: "other", label: "その他", tags: [], bgColor: "#f9fafb" };

export const ALL_LANES: Lane[] = [...LANES, OTHER_LANE];

// 会議のタグ名一覧から、最も多くのタグが一致するレーンのidを返す。
// どのレーンにも一致しない場合は 'other' を返す。
export function assignLane(tagNames: string[]): string {
  let bestLaneId = OTHER_LANE.id;
  let bestCount = 0;
  for (const lane of LANES) {
    const count = tagNames.filter((t) => lane.tags.includes(t)).length;
    if (count > bestCount) {
      bestCount = count;
      bestLaneId = lane.id;
    }
  }
  return bestLaneId;
}
