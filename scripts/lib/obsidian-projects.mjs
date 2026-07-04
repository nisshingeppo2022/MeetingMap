// プロジェクトレイヤー(P9)共通ロジック。sync-obsidian.mjs と rebuild-digest.mjs から使う。
import path from "path";
import fs from "fs";

export function toJstIso(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  const y = jst.getUTCFullYear();
  const mo = pad(jst.getUTCMonth() + 1);
  const d = pad(jst.getUTCDate());
  const h = pad(jst.getUTCHours());
  const mi = pad(jst.getUTCMinutes());
  const s = pad(jst.getUTCSeconds());
  return `${y}-${mo}-${d}T${h}:${mi}:${s}+09:00`;
}

function jstParts(date) {
  const jst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return {
    y: jst.getUTCFullYear(),
    mo: pad(jst.getUTCMonth() + 1),
    d: pad(jst.getUTCDate()),
    hh: pad(jst.getUTCHours()),
    mm: pad(jst.getUTCMinutes()),
  };
}

export function projectDir(vaultPath, slug) {
  return path.join(vaultPath, "projects", slug);
}

// プロジェクトのフォルダ・雛形ファイルが無ければ作成する(_hub.md / todo.md / _captures.md)
export function ensureProjectScaffold(vaultPath, slug, label) {
  const dir = projectDir(vaultPath, slug);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const hubPath = path.join(dir, "_hub.md");
  if (!fs.existsSync(hubPath)) {
    fs.writeFileSync(
      hubPath,
      [
        `# ${label ?? slug}`,
        "",
        "## 目的",
        "",
        "## 期限",
        "",
        "## 関係者",
        "",
        "## 決定事項",
        "",
      ].join("\n"),
      "utf-8"
    );
  }

  const todoPath = path.join(dir, "todo.md");
  if (!fs.existsSync(todoPath)) {
    fs.writeFileSync(todoPath, `# ${label ?? slug} ToDo\n\n`, "utf-8");
  }

  const capturesPath = path.join(dir, "_captures.md");
  if (!fs.existsSync(capturesPath)) {
    fs.writeFileSync(
      capturesPath,
      `# ${label ?? slug} キャプチャダイジェスト\n\n(このファイルは自動生成されます。手で編集しないでください。再生成: npm run rebuild-digest ${slug})\n`,
      "utf-8"
    );
  }

  return { dir, hubPath, todoPath, capturesPath };
}

export function digestEntry(capture) {
  const { y, mo, d, hh, mm } = jstParts(new Date(capture.created_at));
  return `\n## ${y}-${mo}-${d} ${hh}:${mm}(${capture.source})\n${capture.content}\n`;
}

export function appendToDigest(vaultPath, slug, label, capture) {
  const { capturesPath } = ensureProjectScaffold(vaultPath, slug, label);
  fs.appendFileSync(capturesPath, digestEntry(capture), "utf-8");
}

// captures/配下のMarkdownファイルからフロントマターを抽出する(rebuild-digest用)
export function parseCaptureFile(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return null;
  const [, fm, body] = match;

  const sourceMatch = fm.match(/^source:\s*(.+)$/m);
  const tagsMatch = fm.match(/^tags:\s*\[(.*)\]$/m);
  const createdMatch = fm.match(/^created:\s*(.+)$/m);
  const idMatch = fm.match(/^capture_id:\s*(.+)$/m);
  if (!sourceMatch || !createdMatch || !idMatch) return null;

  const tags = tagsMatch && tagsMatch[1].trim()
    ? tagsMatch[1].split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  return {
    id: idMatch[1].trim(),
    source: sourceMatch[1].trim(),
    tags,
    created_at: createdMatch[1].trim(),
    content: body.replace(/^\n+/, "").replace(/\n+$/, ""),
  };
}

// _captures.md をVault内のファイル群から作り直す(rebuild-digest と 削除同期の両方から使う)
export function rebuildDigestFromFiles(vaultPath, slug, label) {
  const matches = findCapturesByTag(vaultPath, slug);
  const { capturesPath } = ensureProjectScaffold(vaultPath, slug, label);
  const header = `# ${label} キャプチャダイジェスト\n\n(このファイルは自動生成されます。手で編集しないでください。再生成: npm run rebuild-digest ${slug})\n`;
  const body = matches.map((c) => digestEntry(c)).join("");
  fs.writeFileSync(capturesPath, header + body, "utf-8");
  return matches.length;
}

// captures/ 配下(月フォルダ + meetings/)を走査して、指定タグを含む全captureを時系列で返す
export function findCapturesByTag(vaultPath, tagSlug) {
  const capturesDir = path.join(vaultPath, "captures");
  if (!fs.existsSync(capturesDir)) return [];

  const results = [];
  const subDirs = fs.readdirSync(capturesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => path.join(capturesDir, e.name));

  for (const dir of subDirs) {
    const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
    for (const file of files) {
      const parsed = parseCaptureFile(path.join(dir, file));
      if (parsed && parsed.tags.includes(tagSlug)) results.push(parsed);
    }
  }

  results.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  return results;
}
