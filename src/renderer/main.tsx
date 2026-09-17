import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "./app/Shell.tsx";
import "./styles/tokens.css";

/** UI 와 상태만. fs·API 키·직접 네트워크 호출은 여기 없다. */
export function mount(): void {
  const el = document.getElementById("root");
  if (!el) throw new Error("#root 를 찾지 못했다");
  createRoot(el).render(
    <StrictMode>
      <Shell />
    </StrictMode>,
  );
}

mount();
