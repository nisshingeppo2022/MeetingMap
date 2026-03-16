interface GenerateOptions {
  model?: string;
  temperature?: number;
  thinkingBudget?: number; // 0 = thinking無効（高速・省トークン）
  retries?: number;
}

export async function generateContent(
  prompt: string,
  options: GenerateOptions = {}
): Promise<string> {
  const {
    model = "gemini-2.5-flash",
    temperature = 0.3,
    thinkingBudget,
    retries = 2,
  } = options;

  const apiKey = process.env.GEMINI_API_KEY!;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const body: Record<string, unknown> = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };

  // thinkingBudget指定時はThinking設定を追加（0で無効化）
  if (thinkingBudget !== undefined) {
    body.generationConfig = {
      ...body.generationConfig as object,
      thinkingConfig: { thinkingBudget },
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (res.status === 429 && retries > 0) {
    const errText = await res.text();
    const retryMatch = errText.match(/retry in (\d+(\.\d+)?)s/i);
    const waitSec = retryMatch ? Math.ceil(parseFloat(retryMatch[1])) + 1 : 30;
    console.log(`Gemini rate limited. Waiting ${waitSec}s before retry (${retries} left)...`);
    await new Promise((r) => setTimeout(r, waitSec * 1000));
    return generateContent(prompt, { ...options, retries: retries - 1 });
  }

  if (!res.ok) {
    const err = await res.text();
    console.error(`Gemini API error: ${res.status}`, err.slice(0, 500));
    if (res.status === 429) {
      throw new Error("APIのレート制限に達しました。1〜2分待ってから再試行してください。");
    }
    if (res.status === 400) {
      throw new Error(`リクエストエラー (400): ${err.slice(0, 200)}`);
    }
    throw new Error(`Gemini APIエラー (${res.status})`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export const ANALYZE_PROMPT = `あなたはミーティングの内容を分析してマインドマップを生成するアシスタントです。

## 入力
- ミーティングの文字起こしテキスト
- 相手の名前と所属組織
- （あれば）過去のミーティングから蓄積されたノード情報

## タスク
以下のJSON形式でマインドマップのノードを出力してください。JSONのみを返してください:

{
  "root": {
    "label": "ミーティングの主題（自動生成）"
  },
  "nodes": [
    {
      "label": "トピック名",
      "type": "topic",
      "status": "企画中|調整中|進行中|アイデア段階|完了|保留",
      "is_secret": false,
      "children": [
        {
          "label": "具体的な内容",
          "type": "item"
        }
      ]
    }
  ],
  "topics": [
    {
      "category": "イベント|予算|会場|連携|その他",
      "items": [
        {
          "name": "アイテム名",
          "status": "ステータス",
          "details": "詳細",
          "related_people": ["名前"]
        }
      ]
    }
  ],
  "suggested_relations": [
    {
      "description": "他のミーティングとの関連の説明",
      "related_contact": "関連する連絡先名"
    }
  ],
  "action_items": [
    {
      "task": "やるべきこと",
      "assignee": "担当者",
      "deadline": "期限（わかれば）"
    }
  ]
}

## ルール
- ステータスは会話の文脈から推定してください
- 秘匿性が高そうな情報（金額の具体値、交渉の詳細など）にはis_secret: trueを付けてください
- 過去のノード情報がある場合、既存のトピックとの関連を示してください
- 日本語で出力してください`;

export const CROSSLINK_ANALYSIS_PROMPT = `あなたは複数のビジネスミーティングを横断分析する専門家です。

## タスク
以下の複数ミーティングのサマリーを読み、ミーティング間の関係を分析してください。
JSONのみを返してください（マークダウンコードブロック不要）:

{
  "crosslinks": [
    {
      "fromMeetingIndex": 0,
      "toMeetingIndex": 1,
      "type": "synthesis",
      "strength": "strong",
      "reason": "なぜ関連するかの説明（日本語、60字以内）",
      "suggestion": "組み合わせることで生まれる価値または注意点（日本語、100字以内）",
      "category": "カテゴリ名（日本語、15字以内）"
    }
  ]
}

## typeの定義
- synthesis: 2つのミーティングの内容を組み合わせると新しい企画・価値が生まれる
- common_issue: 同じ課題・テーマ・ニーズが複数のミーティングで繰り返し登場している
- conflict: 2つのミーティングの方向性・前提・制約が矛盾または衝突している

## strengthの基準
- strong: 明確かつ重要なつながりがある
- medium: 関連があるが確認が必要
- weak: 可能性があるが不明瞭

## ルール
- crosslinksは最大10件
- 関連度が低いペアは含めない（strengthがweak未満はスキップ）
- fromMeetingIndexとtoMeetingIndexは0-indexedで入力ミーティング配列の位置
- 同じペアを複数回含めない
- 日本語で出力`;

export const BRIEFING_PROMPT = `あなたは商談・会議を支援するAIアシスタントです。これから始まるミーティングに向けて、過去の会議データから関連情報を抽出してください。

JSONのみを返してください（マークダウンコードブロック不要）:

{
  "relevant_meetings": [
    {
      "title": "過去の会議タイトル",
      "date": "日付",
      "relevance": "今回との関連（50字以内）"
    }
  ],
  "ideas_and_opportunities": ["活用できるアイデア・可能性（各40字以内）"],
  "constraints_and_risks": ["知っておくべき制約・懸念事項（各40字以内）"],
  "suggested_talking_points": ["今日確認・提案すべき話題（各40字以内）"],
  "contact_history": "参加者との過去のやりとりの要約（100字以内、参加者情報がない場合はnull）"
}

## ルール
- 過去の会議データに基づいた情報のみを出力する（推測・創作不可）
- 各配列は最大5件
- 日本語で出力`;

export const SUGGEST_PROMPT = `以下のミーティング中の直近の会話テキストから、キーワードとトピックを抽出してください。JSONのみを返してください:

{
  "keywords": ["キーワード1", "キーワード2"],
  "active_topics": ["トピック名1", "トピック名2"],
  "search_queries": ["検索クエリ1", "検索クエリ2"]
}

## ルール
- 会話の流れから「今話しているテーマ」を特定してください
- 検索クエリは過去のデータを検索するために使います
- 簡潔に、3-5個のキーワードに絞ってください`;
