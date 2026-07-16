// CLAUDE.md の規約(Gemini APIはv1beta直接fetch、SDKは使わない)に合わせ、
// @google/genai SDKではなく既存の lib/gemini.ts(fetchベース・レート制限フォールバック実装済み)
// を利用する。
import { generateContent, generateContentStream, ChatMessage } from "@/lib/gemini";

// 無料枠対象のモデルを使用。現在の推奨/上限は AI Studio の Rate Limits 画面で確認し、
// 変更は環境変数で行う(コード変更不要)
export const GEMINI_CHAT_MODEL = process.env.COMPANION_GEMINI_MODEL || "gemini-2.5-flash";
export const GEMINI_SUMMARY_MODEL = process.env.COMPANION_GEMINI_SUMMARY_MODEL || "gemini-2.5-flash";
const FALLBACK_MODEL = "gemini-2.5-flash-lite";

const MAX_TOKENS = { student: 400, consult: 300, summary: 1500 } as const;

type Msg = { role: "user" | "assistant"; content: string };

function toMessages(history: Msg[], userText: string): ChatMessage[] {
  return [
    ...history.map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      text: m.content,
    })),
    { role: "user" as const, text: userText },
  ];
}

export async function* geminiChatStream(opts: {
  mode: "student" | "consult";
  system: string;
  history: Msg[];
  userText: string;
}): AsyncGenerator<string> {
  const stream = await generateContentStream(toMessages(opts.history, opts.userText), opts.system, {
    model: GEMINI_CHAT_MODEL,
    fallbackModel: FALLBACK_MODEL,
    maxOutputTokens: MAX_TOKENS[opts.mode],
  });
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

export async function geminiSummarize(prompt: string, fullLogText: string): Promise<string> {
  return generateContent(`${prompt}\n\n---\n\n${fullLogText}`, {
    model: GEMINI_SUMMARY_MODEL,
    fallbackModel: FALLBACK_MODEL,
    maxOutputTokens: MAX_TOKENS.summary,
    retries: 1,
  });
}
