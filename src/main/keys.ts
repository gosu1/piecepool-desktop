// OWNER: 7단계 — electron safeStorage 를 설치한 뒤 채운다.

/**
 * Gemini API 키는 main 에만 둔다.
 *
 * 현행 앱은 localStorage["gemini-key"] 에 두는데 그건 renderer 다.
 * safeStorage 로 암호화해 app.getPath("userData") 에 두면
 * OS 키체인(Windows DPAPI / macOS Keychain)을 쓰므로 평문으로 남지 않는다.
 *
 * renderer 는 키 값을 절대 받지 않는다 — "설정됨/안 됨" 불리언과
 * 설정용 쓰기 채널만 preload 가 노출한다. LLM 호출은 전부 core/ 에서 일어난다.
 */
export async function hasKey(): Promise<boolean> {
  throw new Error("unimplemented: main/keys.hasKey");
}

export async function setKey(value: string): Promise<void> {
  throw new Error("unimplemented: main/keys.setKey");
}

/** main 안에서만 쓴다. 이 값이 preload 를 넘어가면 안 된다. */
export async function readKey(): Promise<string | null> {
  throw new Error("unimplemented: main/keys.readKey");
}
