import path from "node:path";

/**
 * 런타임에 읽는 자산(프롬프트 .md, 나중엔 pdf.js CMap)의 경로를 여기 한 곳에서 푼다.
 *
 * "type": "module" 에서는 __dirname 이 존재하지 않는다.
 * 그리고 번들러는 import 되지 않는 .md 를 산출물에 복사하지 않는다.
 * 둘 다 Electron 패키징 단계에서 처음 터지므로, 그때 이 파일만 고치면 되게 둔다.
 */
export function assetPath(rel: string): string {
  return path.join(import.meta.dirname, rel);
}
