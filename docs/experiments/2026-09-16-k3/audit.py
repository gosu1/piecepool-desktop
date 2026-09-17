# -*- coding: utf-8 -*-
# 회차 위키 감사 — 정답 세트가 안 재는 것: 링크 과잉·자기 링크·기록 중복·이름 형태·허브 크기
import io, os, re, sys, collections, glob
def audit(d):
    pages = {}
    for f in glob.glob(os.path.join(d, "*.md")):
        name = os.path.splitext(os.path.basename(f))[0]
        t = io.open(f, encoding="utf8").read()
        body = re.sub(r"^---\n.*?\n---\n", "", t, count=1, flags=re.S)
        m = re.search(r"^> (.+)$", body, flags=re.M)
        summary = m.group(1) if m else ""
        recs = re.findall(r"^- (\d{4}-\d{2}-\d{2}|\?|날짜 미상)? ?(.*?) ← \[\[([^\]|#]+)(#[^\]]*)?\]\]", body, flags=re.M)
        prose = re.sub(r"\n## 기록\n.*", "", body, flags=re.S)
        links = re.findall(r"\[\[([^\]|#]+)", prose)
        pages[name] = dict(summary=summary, recs=recs, links=links, prose=prose, chars=len(body))
    names = set(pages)
    out = []
    total_links = sum(len(p["links"]) for p in pages.values())
    self_links = sum(1 for n, p in pages.items() for l in p["links"] if l == n)
    dangling = sum(1 for p in pages.values() for l in p["links"] if l not in names and not l.startswith("2026") and not re.match(r"^[a-z]", l))
    # 같은 이름을 한 페이지 본문에 여러 번 링크
    repeat = sum(max(0, c - 1) for p in pages.values() for c in collections.Counter(p["links"]).values())
    # 기록 중복: 같은 fact 가 두 페이지 이상에
    fact_pages = collections.defaultdict(set)
    for n, p in pages.items():
        for _, fact, src, _ in p["recs"]:
            fact_pages[fact.strip()].add(n)
    dup_facts = sum(1 for f, ps in fact_pages.items() if len(ps) > 1)
    total_recs = sum(len(p["recs"]) for p in pages.values())
    josa = [n for n in names if re.search(r"[가-힣](이|가|는|을|를|의)$", n) and len(n) <= 4]
    latin_title = [n for n in names if re.match(r"^[A-Za-z]", n) and len(n) > 25]
    me = pages.get("나")
    out.append(f"페이지 {len(pages)} · 본문 링크 {total_links} (페이지당 {total_links/len(pages):.1f}) · 같은 이름 반복 링크 {repeat} · 자기 링크 {self_links} · 없는 페이지로 {dangling}")
    out.append(f"기록 {total_recs} (페이지당 {total_recs/len(pages):.1f}) · 같은 fact 가 두 페이지 이상에 {dup_facts}")
    out.append(f"조사 의심 이름 {josa} · 긴 로마자 제목 {latin_title}")
    if me:
        out.append(f"나: 본문 {me['chars']}자 · 링크 {len(me['links'])} · 기록 {len(me['recs'])} · 요약 {me['summary'][:90]}…")
    big = sorted(pages.items(), key=lambda kv: -kv[1]["chars"])[:3]
    out.append("가장 큰 페이지: " + ", ".join(f"{n} {p['chars']}자/기록 {len(p['recs'])}" for n, p in big))
    return "\n".join(out)
for d in sys.argv[1:]:
    print("==", os.path.basename(d)); print(audit(d))
