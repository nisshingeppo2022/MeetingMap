import { NextRequest } from "next/server";
import { getDevice, resolveMode } from "@/lib/companion/auth";
import { buildStudentContext, buildConsultContext } from "@/lib/companion/context";
import { appendMessage, getHistory } from "@/lib/companion/store";
import { chatStream, loadPrompt } from "@/lib/companion/llm";
import { SentenceAssembler } from "@/lib/companion/sentences";

export const runtime = "nodejs";
export const maxDuration = 60;

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body?.text || !body?.session_id) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400 });
  }

  const device = await getDevice(body.device_token);
  if (!device) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });

  // フェイルセーフ: consult_token が不正/期限切れでもエラーにせず student として処理
  const mode = await resolveMode(device, body.consult_token);

  // ★ コードパス分離: mode によって呼ぶ関数を完全に分ける
  const [persona, context] =
    mode === "consult"
      ? [await loadPrompt("consult"), await buildConsultContext(body.text)]
      : [await loadPrompt("student"), await buildStudentContext()];

  const system = context ? `${persona}\n\n---\n\n${context}` : persona;
  const history = await getHistory(body.session_id);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: string, d: unknown) => controller.enqueue(encoder.encode(sse(e, d)));
      const assembler = new SentenceAssembler();
      let full = "";
      try {
        // プロバイダ(Gemini/Claude)は llm.ts が環境変数で選択。ルート層は意識しない
        for await (const delta of chatStream({ mode, system, history, userText: body.text })) {
          full += delta;
          send("delta", { text: delta });
          for (const s of assembler.push(delta)) send("sentence", { text: s });
        }
        const rest = assembler.flush();
        if (rest) send("sentence", { text: rest });

        await appendMessage(body.session_id, mode, "user", body.text);
        await appendMessage(body.session_id, mode, "assistant", full);
        send("done", { reply_full: full, mode });
      } catch {
        send("error", { message: "generation_failed" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
