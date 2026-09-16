# -*- coding: utf-8 -*-
# 깨진 음절 탐지 시제품: 본문의 한글 어절 중 원문 어휘에 없고, 한 음절의 받침만 빼거나 바꾸면 원문 어휘에 있는 것
import io, os, re, sys, glob, collections
BASE=0xAC00
def decompose(c):
    i=ord(c)-BASE; return i//588, (i%588)//28, i%28
def compose(l,v,t): return chr(BASE+l*588+v*28+t)
def variants(word):
    # 각 음절의 받침을 없애거나(0) 다른 받침으로 바꾼 것 — 받침 '추가' 가 깨짐의 꼴이므로 없앤 것을 먼저
    out=set()
    for i,c in enumerate(word):
        if not ('가'<=c<='힣'): continue
        l,v,t=decompose(c)
        if t!=0:
            out.add(word[:i]+compose(l,v,0)+word[i+1:])
    return out
corpus=""
for f in glob.glob("fixtures/vault-lab/**/*.md", recursive=True):
    if "/wiki/" in f.replace("\\","/"): continue
    corpus+=io.open(f,encoding="utf8").read()+"\n"
corpus+=io.open("src/core/prompts/write.md",encoding="utf8").read()
vocab=set(re.findall(r"[가-힣]{2,}", corpus))
# 어절 앞부분(2음절 이상 접두)도 어휘로 — 조사·어미 변형을 흡수
prefixes=set()
for w in vocab:
    for k in range(2,len(w)+1): prefixes.add(w[:k])
def known(w):
    return w in prefixes
for d in sys.argv[1:]:
    found=collections.Counter()
    for f in glob.glob(os.path.join(d,"*.md")):
        t=io.open(f,encoding="utf8").read()
        t=re.sub(r"^---\n.*?\n---\n","",t,count=1,flags=re.S)
        t=re.sub(r"\n## 기록\n.*","",t,flags=re.S)  # 본문만
        for w in re.findall(r"[가-힣]{2,}", t):
            if known(w): continue
            # 접두 2음절 이상이 어휘에 있으면 정상 변형으로 본다
            if any(known(w[:k]) for k in range(len(w),1,-1)): continue
            for v in variants(w):
                if known(v) or any(known(v[:k]) for k in range(len(v),1,-1)):
                    found[f"{w}→{v}"]+=1; break
    print(f"== {os.path.basename(d)}: 후보 {sum(found.values())} 곳 · {len(found)} 종류")
    print("   "+"  ".join(f"{k}({n})" for k,n in found.most_common(30)))
