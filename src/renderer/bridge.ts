import type { PiecePoolApi } from "../shared/ipc.ts";

/**
 * preload 가 안 붙은 경우를 흡수한다.
 *
 * `npm start` 대신 `electron .` 을 직접 치거나, `npm run dev` 만 켜고
 * 일반 브라우저로 localhost:5173 을 열면 `window.piecepool` 이 없다.
 * 타입은 "항상 있다" 고 말하므로(piecepool.d.ts) 여기서만 거짓말을 되돌린다 —
 * 렌더 중에 읽다가 throw 하면 화면 전체가 하얗게 죽는다.
 */
export const bridge = window.piecepool as PiecePoolApi | undefined;

export const IS_MAC = bridge?.isMac ?? false;
