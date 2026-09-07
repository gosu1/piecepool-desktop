// FROZEN: retitleNote 를 뺀 전체 (0단계 설계 §8)
// retitleNote 는 가배치 5단계.
import type { Note, NotePath, Vault } from "../../shared/types.ts";

export async function readNote(v: Vault, p: NotePath): Promise<Note> {
  throw new Error("unimplemented: core/vault/notes.readNote");
}

export async function writeNote(v: Vault, p: NotePath, content: string): Promise<void> {
  throw new Error("unimplemented: core/vault/notes.writeNote");
}

/** 링크를 따라 고친다 — 이 문서를 가리키는 [[링크]] 를 전부 갱신한다. */
export async function renameNote(v: Vault, from: NotePath, to: NotePath): Promise<NotePath[]> {
  throw new Error("unimplemented: core/vault/notes.renameNote");
}

/**
 * 제목을 바꾼다. 경로가 아니라 Fm.title 이다.
 *
 * 링크 해석이 제목 매칭이므로(상위 §6.1) 제목만 바꾸면 다른 노트의
 * [[옛제목]] 이 전부 고아가 되고 선두 H1 이 이중 표시된다.
 * 세 가지를 함께 해야 한다 — Fm.title, 선두 H1, 모든 [[옛제목]].
 * ![[...]] 임베드는 소스 파일 참조이므로 건드리지 않는다.
 *
 * 반환값은 고친 경로 전체다. 커밋 경로 집합에 그대로 먹인다.
 */
export async function retitleNote(v: Vault, p: NotePath, to: string): Promise<NotePath[]> {
  throw new Error("unimplemented: core/vault/notes.retitleNote");
}

export async function deleteNote(v: Vault, p: NotePath): Promise<void> {
  throw new Error("unimplemented: core/vault/notes.deleteNote");
}
