import { readFile } from "node:fs/promises";

/**
 * 볼트 밖 .md/.txt 와 세션 로그의 본문. 원본은 sources/ 에 남고 전문이 출처 페이지가 된다.
 * 프론트매터(date 등)는 본문이 아니다 — 갈라내고, date 는 결정 8 의 날짜 폴백에 넘긴다.
 */
export async function extractMarkdownText(
  file: string,
): Promise<{ text: string; date: string | null }> {
  const raw = (await readFile(file, "utf8")).trim();
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  const date = m ? (/^date:\s*(\d{4}-\d{2}-\d{2})/m.exec(m[1])?.[1] ?? null) : null;
  return { text: m ? raw.slice(m[0].length).trim() : raw, date };
}
