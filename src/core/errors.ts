import type { ErrorKind } from "../shared/types.ts";

/**
 * core 가 던지는 에러. kind 를 런타임에 들고 있어야
 * main/ipc.ts 가 Result 로 감쌀 때 읽을 수 있다.
 * (인터페이스는 shared/types.ts 에, 클래스는 여기에 — shared 는 타입만 두므로.)
 */
export class PiecePoolError extends Error {
  readonly kind: ErrorKind;

  constructor(kind: ErrorKind, message: string) {
    super(message);
    this.kind = kind;
    this.name = "PiecePoolError";
  }
}
