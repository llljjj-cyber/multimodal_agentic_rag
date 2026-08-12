"""
RAG 检索评测脚本（不依赖 HTTP，直接调用 RAG_STORE.search）。

用法（在 backend 目录、已激活 .venv 且数据库有资料时）：
  python eval_rag.py
  python eval_rag.py --golden eval/golden.json --username ljlkjj --top-k 6
  python eval_rag.py --ragas   # 需 pip install ragas datasets

指标说明：
  - title_hit：Top-K 里是否出现期望资料标题（子串匹配）
  - keyword_hit：Top-K 合并文本是否包含全部 expected_keywords
  - ragas（可选）：context recall 等，需 reference_answer 且安装 ragas
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv

load_dotenv()

import crud
from database import async_session
from services.rag.retriever import search_chunks


DEFAULT_GOLDEN = Path(__file__).resolve().parent / "eval" / "golden.example.json"


async def _user_id_for_username(username: str) -> str:
    async with async_session() as db:
        user = await crud.get_user_by_username(db, username)
        if user is None:
            raise SystemExit(f"用户不存在: {username}")
        return user.id


@dataclass
class CaseResult:
    question: str
    title_hit: bool
    keyword_hit: bool
    matched_titles: list[str] = field(default_factory=list)
    top_score: float = 0.0
    error: str | None = None


def load_cases(path: Path) -> list[dict[str, Any]]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    cases = payload.get("cases") if isinstance(payload, dict) else payload
    if not isinstance(cases, list) or not cases:
        raise ValueError(f"评测文件为空或格式不对：{path}")
    return cases


def check_title_hit(matches: list[dict[str, Any]], expected_title: str) -> tuple[bool, list[str]]:
    titles = [str(m.get("title") or "") for m in matches]
    if not expected_title.strip():
        return True, titles
    hit = any(expected_title in title for title in titles)
    return hit, titles


def check_keyword_hit(matches: list[dict[str, Any]], keywords: list[str]) -> bool:
    if not keywords:
        return True
    blob = "\n".join(str(m.get("text") or "") for m in matches)
    return all(kw in blob for kw in keywords)


async def evaluate_retrieval(
    username: str,
    cases: list[dict[str, Any]],
    top_k: int,
) -> list[CaseResult]:
    user_id = await _user_id_for_username(username)
    results: list[CaseResult] = []
    async with async_session() as db:
        for case in cases:
            question = str(case.get("question") or "").strip()
            if not question:
                results.append(CaseResult(question="", title_hit=False, keyword_hit=False, error="空问题"))
                continue
            try:
                retrieval = await search_chunks(db, user_id, question, top_k)
                matches = retrieval.get("matches") or []
                expected_title = str(case.get("expected_source_title") or "")
                keywords = [str(k) for k in (case.get("expected_keywords") or []) if str(k).strip()]
                title_hit, titles = check_title_hit(matches, expected_title)
                keyword_hit = check_keyword_hit(matches, keywords)
                top_score = float(matches[0].get("score") or 0) if matches else 0.0
                results.append(
                    CaseResult(
                        question=question,
                        title_hit=title_hit,
                        keyword_hit=keyword_hit,
                        matched_titles=titles[:top_k],
                        top_score=top_score,
                    )
                )
            except Exception as exc:
                results.append(
                    CaseResult(
                        question=question,
                        title_hit=False,
                        keyword_hit=False,
                        error=str(exc),
                    )
                )
    return results


def print_report(results: list[CaseResult], top_k: int) -> None:
    total = len(results)
    errors = sum(1 for r in results if r.error)
    title_hits = sum(1 for r in results if r.title_hit and not r.error)
    keyword_hits = sum(1 for r in results if r.keyword_hit and not r.error)

    print("\n=== RAG 检索评测 ===")
    print(f"样本数: {total}  |  Top-K: {top_k}")
    print(f"标题命中: {title_hits}/{total - errors}  ({_pct(title_hits, total - errors)})")
    print(f"关键词命中: {keyword_hits}/{total - errors}  ({_pct(keyword_hits, total - errors)})")
    if errors:
        print(f"失败: {errors}")

    print("\n--- 明细 ---")
    for index, row in enumerate(results, start=1):
        print(f"\n[{index}] {row.question}")
        if row.error:
            print(f"  ERROR: {row.error}")
            continue
        print(f"  title_hit={row.title_hit}  keyword_hit={row.keyword_hit}  top_score={row.top_score}")
        if row.matched_titles:
            print(f"  titles: {row.matched_titles}")


def _pct(num: int, denom: int) -> str:
    if denom <= 0:
        return "n/a"
    return f"{100 * num / denom:.1f}%"


async def run_ragas(
    username: str,
    cases: list[dict[str, Any]],
    top_k: int,
) -> None:
    try:
        from ragas import EvaluationDataset, evaluate
        from ragas.metrics import LLMContextRecall, LLMContextPrecisionWithReference
    except ImportError as exc:
        print("\n跳过 RAGAS：请先安装  pip install ragas datasets")
        raise SystemExit(1) from exc

    user_id = await _user_id_for_username(username)
    llm = _build_ragas_llm()
    rows: list[dict[str, str]] = []
    async with async_session() as db:
        for case in cases:
            question = str(case.get("question") or "").strip()
            reference = str(case.get("reference_answer") or "").strip()
            if not question or not reference:
                continue
            retrieval = await search_chunks(db, user_id, question, top_k)
            contexts = [str(m.get("text") or "") for m in (retrieval.get("matches") or []) if m.get("text")]
            if not contexts:
                continue
            rows.append(
                {
                    "user_input": question,
                    "retrieved_contexts": contexts,
                    "reference": reference,
                }
            )

    if not rows:
        print("\nRAGAS：没有带 reference_answer 且检索到上下文的样本，跳过。")
        return

    dataset = EvaluationDataset.from_list(rows)
    metrics = [
    LLMContextRecall(),
    LLMContextPrecisionWithReference(),
]
    result = evaluate(dataset=dataset, metrics=metrics, llm=llm)
    print("\n=== RAGAS (LLMContextRecall) ===")
    print(result)


def _build_ragas_llm():
    """优先 Gemini；若配置了中转 OpenAI 兼容地址则走 base_url。"""
    from ragas.llms import llm_factory

    base_url = (os.getenv("RAGAS_BASE_URL") or "").strip()
    api_key = os.getenv("RAGAS_API_KEY")
    model = os.getenv("RAGAS_LLM_MODEL")

    if base_url:
        from openai import OpenAI

        if base_url.endswith("/"):
            base_url = base_url.rstrip("/")
        if not base_url.endswith("/v1"):
            base_url = f"{base_url}/v1"
        client = OpenAI(api_key=api_key, base_url=base_url)
        return llm_factory(model, provider="openai", client=client)

    from google import genai

    client = genai.Client(api_key=api_key)
    return llm_factory(model, provider="google", client=client)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="RAG 检索评测")
    parser.add_argument(
        "--golden",
        type=Path,
        default=DEFAULT_GOLDEN,
        help="golden JSON 路径（默认 eval/golden.example.json）",
    )
    parser.add_argument(
        "--username",
        default=os.getenv("EVAL_USERNAME", "lj"),
        help="评测使用的登录用户名（需已入库资料）",
    )
    parser.add_argument("--top-k", type=int, default=6, help="检索 Top-K")
    parser.add_argument("--ragas", action="store_true", help="额外跑 RAGAS LLMContextRecall")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    if not args.golden.exists():
        print(f"找不到评测文件：{args.golden}", file=sys.stderr)
        print("可复制 eval/golden.example.json 为 eval/golden.json 并修改。", file=sys.stderr)
        raise SystemExit(1)

    cases = load_cases(args.golden)
    print(f"加载 {len(cases)} 条评测 | user={args.username} | golden={args.golden.name}")

    # results = await evaluate_retrieval(args.username, cases, args.top_k)
    # print_report(results, args.top_k)

    if args.ragas:
        await run_ragas(args.username, cases, args.top_k)


if __name__ == "__main__":
    asyncio.run(main())
