import type { NotePath, Vault } from "../../shared/types.ts";
import { readRaw, writeNote } from "./notes.ts";

/**
 * 편집기가 저장할 때 본문만 바꾼다. 프론트매터 블록은 글자 그대로 다시 쓴다 —
 * 앱 편집기는 `hashes` 를 갱신하지 않는다 (CLAUDE.md §4). 편집기가 지문을 새로 찍으면
 * 사용자가 고친 절이 "우리 글" 로 판정되어 다음 정리에서 덮인다.
 *
 * 줄바꿈도 원문을 따른다. CRLF 파일을 LF 로 되쓰면 git 이 파일 전체를 바뀐 것으로 본다.
 */
export function replaceBody(raw: string, body: string): string {
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const m = /^(﻿?---\r?\n[\s\S]*?\r?\n---\r?\n)/.exec(raw);
  const head = m ? m[1] : "";
  const text = body.replace(/\r?\n/g, eol);
  // 프론트매터 뒤 빈 줄 하나 — 화면(stripFrontmatter)이 떼어 낸 그 줄이다.
  const gap = head && !text.startsWith(eol) ? eol : "";
  return head + gap + text;
}

export async function saveBody(v: Vault, p: NotePath, body: string): Promise<void> {
  const raw = await readRaw(v, p);
  await writeNote(v, p, replaceBody(raw, body));
}
