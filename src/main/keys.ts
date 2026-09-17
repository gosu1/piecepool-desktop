// OWNER: 7단계 — 2026-09-17 채움.
import { app, safeStorage } from "electron";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * LLM API 키는 main 에만 둔다.
 *
 * safeStorage 로 암호화해 app.getPath("userData") 에 두면
 * OS 키체인(Windows DPAPI / macOS Keychain)을 쓰므로 평문으로 남지 않는다.
 *
 * renderer 는 키 값을 절대 받지 않는다 — "설정됨/안 됨" 불리언과
 * 설정용 쓰기 채널만 preload 가 노출한다. LLM 호출은 전부 core/ 에서 일어난다.
 * core 는 환경 변수를 읽으므로, 정리를 시작하기 직전에 main 이 readKey 로 꺼내 올린다.
 */
function keyFile(): string {
  return join(app.getPath("userData"), "llm-key.bin");
}

/** 환경 변수로 들어온 키(개발 중 `--env-file=.env`)도 "설정됨" 이다. */
export async function hasKey(): Promise<boolean> {
  if (process.env.PIECEPOOL_LLM_API_KEY) return true;
  return (await readKey()) !== null;
}

/** 빈 문자열은 "지운다" 다. */
export async function setKey(value: string): Promise<void> {
  const v = value.trim();
  if (v === "") {
    await rm(keyFile(), { force: true });
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("이 OS 에서 키를 암호화해 저장할 수 없다");
  }
  await mkdir(dirname(keyFile()), { recursive: true });
  await writeFile(keyFile(), safeStorage.encryptString(v));
}

/** main 안에서만 쓴다. 이 값이 preload 를 넘어가면 안 된다. */
export async function readKey(): Promise<string | null> {
  try {
    const v = safeStorage.decryptString(await readFile(keyFile()));
    return v === "" ? null : v;
  } catch {
    return null;
  }
}
