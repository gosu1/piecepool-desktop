import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";

// 폴더 경계를 규칙으로 강제한다.
//
//   cli/  ──┐
//           ├──▶  core/     (역방향 import 금지)
//   main/ ──┘
//
// import-x/no-restricted-paths 를 쓰는 이유: no-restricted-imports 는 import
// "문자열"을 minimatch 로 비교할 뿐이라 `import "../../cli"` 같은 디렉터리
// import 와 동적 import 를 놓치고, src/core/main/ 같은 내부 폴더를 오탐한다.
// bare 패키지(electron, node:*) 금지에만 no-restricted-imports 를 쓴다.
export default tseslint.config(
  { ignores: ["node_modules/**", "out/**", "dist/**"] },

  // 이 spread 가 없으면 파서가 TypeScript 가 아니다.
  // 평범한 import 만 있는 파일에서는 동작하는 것처럼 보이다가
  // 첫 `import type` 에서 파싱 에러가 난다.
  ...tseslint.configs.recommended,

  {
    files: ["src/**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver": { node: { extensions: [".ts", ".tsx"] } },
    },
    rules: {
      // no-restricted-paths 는 해석에 실패한 import 를 조용히 통과시킨다.
      // 스텁뿐인 지금이 정확히 그 조건이라 함께 켠다.
      "import-x/no-unresolved": "error",

      // 0단계는 전부 unimplemented 스텁이라 미사용 인자가 필연이다.
      // 구현이 차면 args 검사를 켠다.
      "@typescript-eslint/no-unused-vars": [
        "error",
        { args: "none", varsIgnorePattern: "^_" },
      ],

      // Node 22 의 type stripping 은 타입만 지우고 코드를 만들지 않는다.
      // 아래 셋은 코드 생성이 필요하므로 ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX 로 죽는다.
      "no-restricted-syntax": [
        "error",
        { selector: "TSEnumDeclaration", message: "enum 은 node 가 .ts 를 직접 실행할 때 죽는다 — 유니온 타입이나 as const 를 쓴다" },
        { selector: "TSModuleDeclaration", message: "namespace 는 node 가 .ts 를 직접 실행할 때 죽는다" },
        { selector: "TSParameterProperty", message: "생성자 파라미터 프로퍼티는 node 가 .ts 를 직접 실행할 때 죽는다 — 필드를 따로 선언한다" },
      ],

      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            { target: "./src/core", from: "./src/cli", message: "core 는 호출자를 모른다" },
            { target: "./src/core", from: "./src/main", message: "core 는 호출자를 모른다" },
            { target: "./src/core", from: "./src/preload", message: "core 는 호출자를 모른다" },
            { target: "./src/core", from: "./src/renderer", message: "core 는 호출자를 모른다" },
            { target: "./src/shared", from: "./src/core", message: "shared 는 타입과 순수 상수만" },
            { target: "./src/shared", from: "./src/cli", message: "shared 는 타입과 순수 상수만" },
          ],
        },
      ],
    },
  },

  {
    files: ["src/core/**/*.ts"],
    rules: {
      // 진행 상황은 onProgress 콜백으로 나간다. 엔진에 실행 환경을 심지 않는다.
      "no-console": "error",
      "no-restricted-properties": [
        "error",
        { object: "process", property: "exit", message: "core 는 종료하지 않는다 — throw 한다" },
        { object: "process", property: "argv", message: "core 는 argv 를 읽지 않는다" },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        { patterns: [{ group: ["electron", "electron/*"], message: "core 는 순수 Node 다" }] },
      ],
    },
  },

  {
    files: ["src/shared/**/*.ts"],
    rules: {
      // window·document 는 전역이라 import 가 없다.
      // tsconfig.web.json 이 shared 를 DOM lib 과 함께 포함하므로
      // 타입 레벨에서는 합법이다 — 이 규칙이 유일한 방어선이다.
      "no-restricted-globals": [
        "error",
        { name: "window", message: "shared 는 플랫폼 중립이다" },
        { name: "document", message: "shared 는 플랫폼 중립이다" },
        { name: "localStorage", message: "shared 는 플랫폼 중립이다" },
      ],
      "@typescript-eslint/no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "electron", "electron/*"],
              allowTypeImports: true,
              message: "shared 는 런타임 의존이 없다",
            },
          ],
        },
      ],
    },
  },

  // CLI 는 onProgress 로 console.log 를 넘기는 자리다.
  { files: ["src/cli/**/*.ts"], rules: { "no-console": "off" } },
);
