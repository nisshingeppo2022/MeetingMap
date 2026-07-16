// 日本語の文区切りアセンブラ: ストリーミング delta を蓄積し、文が確定するたびに返す
const BOUNDARY = /([。!?!?\n])/;

export class SentenceAssembler {
  private buf = "";

  push(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    let m;
    while ((m = BOUNDARY.exec(this.buf))) {
      const end = m.index + m[1].length;
      const sentence = this.buf.slice(0, end).trim();
      if (sentence) out.push(sentence);
      this.buf = this.buf.slice(end);
    }
    return out;
  }

  flush(): string | null {
    const rest = this.buf.trim();
    this.buf = "";
    return rest || null;
  }
}
