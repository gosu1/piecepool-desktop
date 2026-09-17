import { describe, it, expect } from "vitest";
import { parseCalloutMarker } from "./callout.ts";

describe("parseCalloutMarker", () => {
  it("[!easy] + 제목", () => {
    expect(parseCalloutMarker("[!easy] 쉬운 설명")).toEqual({ type: "easy", title: "쉬운 설명" });
  });
  it("제목 없으면 타입 기본 라벨", () => {
    expect(parseCalloutMarker("[!easy]")).toEqual({ type: "easy", title: "쉬운 설명" });
    expect(parseCalloutMarker("[!note]")).toEqual({ type: "note", title: "노트" });
  });
  it("[!note] + 제목", () => {
    expect(parseCalloutMarker("[!note] 메모")).toEqual({ type: "note", title: "메모" });
  });
  it("모르는 타입/일반 텍스트 → null", () => {
    expect(parseCalloutMarker("[!warning] 위험")).toBeNull();
    expect(parseCalloutMarker("그냥 인용문")).toBeNull();
  });
});
