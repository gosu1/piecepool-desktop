// 이 파일에 import 문을 두면 모듈이 되어 declare global 이 필요해진다.
// 인라인 import 타입을 쓰면 전역 선언 그대로 남는다 — preload 를 직접 보지 않는 것은 같다.
interface Window {
  piecepool: import("../shared/ipc.ts").PiecePoolApi;
}
