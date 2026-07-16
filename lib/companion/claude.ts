import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export const CLAUDE_CHAT_MODEL = process.env.COMPANION_MODEL || "claude-haiku-4-5";
export const CLAUDE_SUMMARY_MODEL = process.env.COMPANION_SUMMARY_MODEL || "claude-sonnet-4-6";

const MAX_TOKENS = { student: 400, consult: 300, summary: 1500 } as const;

type Msg = { role: "user" | "assistant"; content: string };

export async function* claudeChatStream(opts: {
  mode: "student" | "consult";
  system: string;
  history: Msg[];
  userText: string;
}): AsyncGenerator<string> {
  const stream = anthropic.messages.stream({
    model: CLAUDE_CHAT_MODEL,
    max_tokens: MAX_TOKENS[opts.mode],
    system: opts.system,
    messages: [...opts.history, { role: "user", content: opts.userText }],
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

export async function claudeSummarize(prompt: string, fullLogText: string): Promise<string> {
  const res = await anthropic.messages.create({
    model: CLAUDE_SUMMARY_MODEL,
    max_tokens: MAX_TOKENS.summary,
    messages: [{ role: "user", content: `${prompt}\n\n---\n\n${fullLogText}` }],
  });
  return res.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
