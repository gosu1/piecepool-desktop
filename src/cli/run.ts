import { PiecePoolError } from "../core/errors.ts";
import type { OnProgress } from "../shared/types.ts";

/** CLI 는 onProgress 로 console.log 를 넘긴다. 엔진은 어느 쪽인지 모른다. */
export const log: OnProgress = (p) => {
  console.log(p.detail ? `${p.step}: ${p.detail}` : p.step);
};

/**
 * 에러를 메시지와 종료 코드로 바꾸는 자리다.
 * process.exit 금지는 엔진 한정이므로 여기서는 합법이다.
 */
export async function main(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const kind = e instanceof PiecePoolError ? e.kind : "unknown";
    console.error(`[${kind}] ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  }
}
