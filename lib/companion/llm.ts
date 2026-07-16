// プロバイダ選択の窓口。ルート層はここだけを import する。
//
// デフォルトは全モード Gemini(無料枠運用)。
// 注意: Gemini 無料枠では送信内容がモデル改善に使われる可能性がある。
// 相談モード(個人コンテキストを送る)をそれから外したい場合は、
// COMPANION_PROVIDER_CONSULT=claude に切り替える(月数十円程度の従量課金)。
import { readFile } from "fs/promises";
import path from "path";
import { geminiChatStream, geminiSummarize } from "./gemini";
import { claudeChatStream, claudeSummarize } from "./claude";

type Provider = "gemini" | "claude";
type Msg = { role: "user" | "assistant"; content: string };

const providerFor = (mode: "student" | "consult"): Provider =>
  ((mode === "consult"
    ? process.env.COMPANION_PROVIDER_CONSULT
    : process.env.COMPANION_PROVIDER_STUDENT) || "gemini") as Provider;

const summaryProvider = (): Provider =>
  (process.env.COMPANION_PROVIDER_SUMMARY || "gemini") as Provider;

export async function loadPrompt(name: "student" | "consult" | "summarize"): Promise<string> {
  const p = path.join(process.cwd(), "companion", "prompts", `${name}.md`);
  return readFile(p, "utf-8");
}

export function chatStream(opts: {
  mode: "student" | "consult";
  system: string;
  history: Msg[];
  userText: string;
}): AsyncGenerator<string> {
  return providerFor(opts.mode) === "claude" ? claudeChatStream(opts) : geminiChatStream(opts);
}

export async function summarize(fullLogText: string): Promise<string> {
  const prompt = await loadPrompt("summarize");
  return summaryProvider() === "claude"
    ? claudeSummarize(prompt, fullLogText)
    : geminiSummarize(prompt, fullLogText);
}
