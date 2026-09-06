// OWNER: 7단계 — 채널명과 요청/응답 타입은 shared/ipc.ts 에 둔다(아직 없음).
import type { AppError, ErrorKind, Result } from "../shared/types.ts";
import { PiecePoolError } from "../core/errors.ts";

/**
 * IPC 핸들러는 절대 throw 하지 않는다.
 *
 * Electron IPC 는 예외를 삼킨다 — main 에서 throw 하면 renderer 에는
 * 스택도 타입도 없는 밋밋한 문자열만 도착한다. Tauri 의 Result<T, String> 이
 * 강제하던 규율이 Electron 에는 없으므로 이 경계에서 직접 만든다.
 *
 * core 는 throw 하고 여기서 감싼다. kind 를 못 읽으면 "unknown" 으로 떨어뜨린다 —
 * JSON.parse 실패나 EACCES 처럼 core 가 만들지 않은 예외가 항상 있기 때문이다.
 */
export async function wrap<T>(fn: () => Promise<T>): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, error: toAppError(e) };
  }
}

export function toAppError(e: unknown): AppError {
  const kind: ErrorKind = e instanceof PiecePoolError ? e.kind : "unknown";
  return { kind, message: e instanceof Error ? e.message : String(e) };
}

/** onProgress = webContents.send. CLI 가 console.log 를 넘기던 자리다. */
export function registerHandlers(): void {
  throw new Error("unimplemented: main/ipc.registerHandlers");
}
