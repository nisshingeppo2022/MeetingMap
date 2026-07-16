interface GenerateOptions {
  model?: string;
  temperature?: number;
  thinkingBudget?: number; // 0 = thinking無効（高速・省トークン）
  retries?: number;
  fallbackModel?: string; // レート制限(429)時に自動で切り替える予備モデル(枠が別)
  maxOutputTokens?: number;
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
  if (options.maxOutputTokens !== undefined) {
    body.generationConfig = {
      ...body.generationConfig as object,
      maxOutputTokens: options.maxOutputTokens,
    };
  }

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  // レート制限時: 予備モデルが指定されていればまずそちらへ即切替(待ち時間なし)
  if (res.status === 429 && options.fallbackModel && options.fallbackModel !== model) {
    console.log(`Gemini rate limited on ${model}. Falling back to ${options.fallbackModel}...`);
    return generateContent(prompt, { ...options, model: options.fallbackModel, fallbackModel: undefined });
  }

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

export interface ChatMessage {
  role: "user" | "model";
  text: string;
}

// マルチターン会話をSSEでストリーミング生成する（相談モード用）
// 戻り値はテキスト断片を流すReadableStream（Response bodyにそのまま渡せる）
export async function generateContentStream(
  messages: ChatMessage[],
  systemPrompt: string,
  options: GenerateOptions = {}
): Promise<ReadableStream<Uint8Array>> {
  const {
    model = "gemini-2.5-flash",
    temperature = 0.7,
    fallbackModel = "gemini-2.5-flash-lite",
    maxOutputTokens,
  } = options;

  const apiKey = process.env.GEMINI_API_KEY!;

  const doFetch = (m: string) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: messages.map((msg) => ({ role: msg.role, parts: [{ text: msg.text }] })),
        generationConfig: {
          temperature,
          ...(maxOutputTokens !== undefined && { maxOutputTokens }),
        },
      }),
    });

  let res = await doFetch(model);

  // レート制限時は予備モデル(枠が別)へ即切替して再試行
  if (res.status === 429 && fallbackModel && fallbackModel !== model) {
    console.log(`Gemini stream rate limited on ${model}. Falling back to ${fallbackModel}...`);
    res = await doFetch(fallbackModel);
  }

  if (!res.ok || !res.body) {
    const err = await res.text().catch(() => "");
    console.error(`Gemini stream API error: ${res.status}`, err.slice(0, 500));
    if (res.status === 429) {
      throw new Error("APIのレート制限に達しました。1〜2分待ってから再試行してください。");
    }
    throw new Error(`Gemini APIエラー (${res.status})`);
  }

  // GeminiのSSE（data: {...}行）からテキスト断片だけを取り出して流し直す
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice("data: ".length).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
          if (text) controller.enqueue(encoder.encode(text));
        } catch {
          // 不完全なJSON行はスキップ（次チャンクと結合されないSSE仕様外の断片対策）
        }
      }
    },
    cancel(reason) {
      reader.cancel(reason);
    },
  });
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
  "tags": ["タグ名1", "タグ名2", "タグ名3"],
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
- tagsには、この会議の主要テーマを表すタグを3〜5個出力してください。プロンプト内に「既存タグ一覧」が提示されている場合、該当するものがあれば必ず同じ表記でそのまま使い、該当がない場合のみ新しいタグ名を作成してください
- 日本語で出力してください`;

export const TAG_ONLY_PROMPT = `以下のミーティングの文字起こしを読み、主要テーマを表すタグを3〜5個生成してください。
JSONのみを返してください(マークダウンコードブロック不要):

{
  "tags": ["タグ名1", "タグ名2", "タグ名3"]
}

## ルール
- プロンプト内に「既存タグ一覧」が提示されている場合、該当するものがあれば必ず同じ表記でそのまま使い、該当がない場合のみ新しいタグ名を作成してください
- 日本語で出力`;

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

export const CAPTURE_TAG_PROMPT = `以下は音声入力またはテキストで記録された短いメモです。
提示するタグ定義一覧から最も当てはまるタグを選び、JSONのみを返してください(マークダウンコードブロック不要):

{
  "tags": ["タグのslug"],
  "confidence": "high" または "low"
}

## ルール
- タグは基本的に1個。複数の内容が明確に混在する場合のみ2個まで
- どのタグにも自信を持って当てはまらない場合は tags: ["inbox"], confidence: "low" を返す
- 音声入力由来のため句読点の欠落や誤変換を含むことがある。多少の誤変換は許容し、文意を推定して判定する
- 本文の書き換え・要約は行わない(判定のみ行う)
- 日本語で出力`;

export const CONSULT_SYSTEM_PROMPT = `あなたはこのプロジェクトの経緯を全て知る壁打ち相手です。
提供される文脈には、会議の議事録（[議事録]）と本人の独り言・音声メモ（[メモ]）、
他者の文章のクリップ（[クリップ]）が含まれます。

## 振る舞い
- 会議記録と本人の独り言・クリップを区別して扱う
- 矛盾や未決事項に気づいたら指摘する
- 決定を急かさない。相手が考えを整理するのを手伝う
- 文脈にない事実を創作しない。知らないことは知らないと言う
- 相手はスマホから短文で話しかけてくる。返答は簡潔に、必要なら箇条書きで
- 日本語で応答する`;

export const CONSULT_SAVE_PROMPT = `以下はプロジェクトに関する壁打ち相談の会話全文です。
この相談の成果を抽出し、そのままMarkdownとして出力してください（JSON不要、コードブロック不要）:

## 決定したこと
- （箇条書き。なければ「なし」）

## 生まれたToDo
- （箇条書き。なければ「なし」）

## 新しい気づき
- （箇条書き。なければ「なし」）

## ルール
- 会話に出てきた内容のみを書く（創作しない）
- 各項目は1行で簡潔に
- 日本語で出力`;

export const WEEKLY_DREAMING_PROMPT = `あなたは本人の1週間の記録(独り言・会議・クリップ・相談)を読み、
時間をまたいだパターンと未決の問いを抽出する内省パートナーです。
そのままMarkdownとして出力してください(JSON不要、コードブロック不要):

# 週次ふりかえり(自動生成)

## 今週繰り返し現れたテーマ・パターン
- (箇条書き)

## 先週までと比べた変化・進展
- (箇条書き。過去の週次ふりかえりが与えられている場合のみ比較する。なければ「初回のため比較なし」)

## 未決のまま残っている問い
- (箇条書き)

## 「一隅を照らす」の観点で今週照らせたもの
(1〜2行)

## _soul.mdへの追記候補
- (今週の記録から強く裏付けられる、価値観・好み・判断基準の新しい気づきがあれば最大2個。
   既に「本人について(_soul.md)」に書かれている内容と重複するものは出さない。無ければ「なし」)

## ルール
- 記録に書かれている内容のみを根拠にする(創作しない)
- 各項目は簡潔に。全体で600字以内
- 私的な記録なので、迷いや本音もそのまま扱ってよい
- 日本語で出力`;

export const CLIP_ENRICH_PROMPT = `以下は他者の文章・記事からの引用/クリップです。
JSONのみを返してください(マークダウンコードブロック不要):

{
  "summary": "1行要約",
  "use_for": ["出力モード/テーマの候補(例: 学校HPブログ、探究学習推進)"],
  "keywords": ["自分の語彙での検索キーワード"],
  "why": "なぜ気になったかの1行"
}

## ルール
- keywordsは元の文章の語彙そのままではなく、後から自分が検索しそうな言葉を使う
- use_forは既存の出力テンプレート(学校HPブログ、Instagram、DX提出資料、備品購入理由書、
  探究学習推進等)を参考に、複数可
- 「なぜ気になったか」のメモが既に入力として与えられている場合はそれをそのまま why に使う。
  入力が空の場合のみ、この文章から推定して why を生成する
- 本文の書き換えは行わない
- 日本語で出力`;
