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

export async function deleteNote(v: Vault, p: NotePath): Promise<void> {
  throw new Error("unimplemented: core/vault/notes.deleteNote");
}
