"""
RAG 检索评测脚本（不依赖 HTTP，直接调用 search_chunks）。

用法（在 backend 目录、已激活 .venv 且数据库有资料时）：
  python eval/eval_rag.py
  python eval/eval_rag.py --golden eval/golden.example.json --username meridian --top-k 6
  python eval/eval_rag.py --ragas   # 需 pip install ragas datasets

指标说明：
  - title_hit：Top-K 命中片段所属资料的 source.title 是否匹配 expected_source_title
  - keyword_hit：Top-K 合并文本（含 parent 回填）是否包含全部 expected_keywords
  - ragas（可选）：context recall / precision，需 reference_answer
  - 若复现请注释 retriever.py 中 search_chunks 所标记的代码，以加速评估
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

BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

load_dotenv(BACKEND_ROOT / ".env")
load_dotenv()

import crud
from database import async_session
from services.rag.retriever import search_chunks


EVAL_DIR = Path(__file__).resolve().parent
DEFAULT_GOLDEN = EVAL_DIR / "golden.example.json"
TITLE_SUFFIXES = (".pdf", ".md", ".txt", ".markdown")


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


def normalize_title(title: str) -> str:
    """去掉扩展名并小写，便于文件名与入库标题互相比对。"""
    text = title.strip().lower()
    for suffix in TITLE_SUFFIXES:
        if text.endswith(suffix):
            text = text[: -len(suffix)]
            break
    return text.strip()


def titles_match(expected: str, actual: str) -> bool:
    """双向子串：期望名可出现在实际标题中，或实际标题出现在期望名中。"""
    exp = normalize_title(expected)
    act = normalize_title(actual)
    if not exp or not act:
        return False
    return exp in act or act in exp


def resolve_source_titles(
    matches: list[dict[str, Any]],
    source_title_by_id: dict[str, str],
) -> list[str]:
    """检索返回的 title 多为章节名；按 source_id 回查资料标题。"""
    titles: list[str] = []
    for match in matches:
        source_id = str(match.get("source_id") or "")
        source_title = source_title_by_id.get(source_id) or ""
        if source_title:
            titles.append(source_title)
        else:
            # 兜底：无 source 映射时仍展示 chunk title，避免明细空白
            titles.append(str(match.get("title") or ""))
    return titles


def check_title_hit(source_titles: list[str], expected_title: str) -> bool:
    if not expected_title.strip():
        return True
    return any(titles_match(expected_title, title) for title in source_titles if title)


def check_keyword_hit(matches: list[dict[str, Any]], keywords: list[str]) -> bool:
    if not keywords:
        return True
    blob = "\n".join(str(m.get("text") or "") for m in matches)
    return all(kw in blob for kw in keywords)


async def _load_source_titles(db, user_id: str) -> dict[str, str]:
    sources = await crud.list_sources_by_user_id(db, user_id)
    return {source.id: source.title for source in sources}


async def evaluate_retrieval(
    username: str,
    cases: list[dict[str, Any]],
    top_k: int,
) -> list[CaseResult]:
    user_id = await _user_id_for_username(username)
    results: list[CaseResult] = []
    async with async_session() as db:
        source_title_by_id = await _load_source_titles(db, user_id)
        if not source_title_by_id:
            print(f"警告：用户 {username} 名下暂无资料，title_hit / keyword_hit 可能全为 0。")

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
                source_titles = resolve_source_titles(matches, source_title_by_id)
                title_hit = check_title_hit(source_titles, expected_title)
                keyword_hit = check_keyword_hit(matches, keywords)
                top_score = float(matches[0].get("score") or 0) if matches else 0.0
                results.append(
                    CaseResult(
                        question=question,
                        title_hit=title_hit,
                        keyword_hit=keyword_hit,
                        matched_titles=source_titles[:top_k],
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
    valid = total - errors
    title_hits = sum(1 for r in results if r.title_hit and not r.error)
    keyword_hits = sum(1 for r in results if r.keyword_hit and not r.error)
    both_hits = sum(1 for r in results if r.title_hit and r.keyword_hit and not r.error)

    print("\n=== RAG 检索评测 ===")
    print(f"样本数: {total}  |  Top-K: {top_k}")
    print(f"标题命中 (source.title): {title_hits}/{valid}  ({_pct(title_hits, valid)})")
    print(f"关键词命中: {keyword_hits}/{valid}  ({_pct(keyword_hits, valid)})")
    print(f"双指标同时命中: {both_hits}/{valid}  ({_pct(both_hits, valid)})")
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
            print(f"  source_titles: {row.matched_titles}")


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
        from ragas.metrics import LLMContextPrecisionWithReference, LLMContextRecall
    except ImportError as exc:
        print("\n跳过 RAGAS：请先安装  pip install ragas datasets")
        raise SystemExit(1) from exc

    user_id = await _user_id_for_username(username)
    llm = _build_ragas_llm()
    rows: list[dict[str, Any]] = []
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
    print("\n=== RAGAS (LLMContextRecall / Precision) ===")
    print(result)


def _build_ragas_llm():
    """优先走 OpenAI 兼容中转；否则用 Google GenAI。"""
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
        default=os.getenv("EVAL_USERNAME", "meridian"),
        help="评测使用的登录用户名（需已入库资料，默认 meridian）",
    )
    parser.add_argument("--top-k", type=int, default=6, help="检索 Top-K")
    parser.add_argument("--ragas", action="store_true", help="额外跑 RAGAS LLMContextRecall")
    return parser.parse_args()


async def main() -> None:
    args = parse_args()
    golden = args.golden if args.golden.is_absolute() else (Path.cwd() / args.golden).resolve()
    if not golden.exists() and args.golden == DEFAULT_GOLDEN:
        golden = DEFAULT_GOLDEN
    if not golden.exists():
        # 相对路径再试脚本同目录
        alt = EVAL_DIR / args.golden.name
        if alt.exists():
            golden = alt
        else:
            print(f"找不到评测文件：{args.golden}", file=sys.stderr)
            print("可复制 eval/golden.example.json 为 eval/golden.json 并修改。", file=sys.stderr)
            raise SystemExit(1)

    cases = load_cases(golden)
    print(f"加载 {len(cases)} 条评测 | user={args.username} | golden={golden.name}")

    results = await evaluate_retrieval(args.username, cases, args.top_k)
    print_report(results, args.top_k)

    if args.ragas:
        await run_ragas(args.username, cases, args.top_k)


if __name__ == "__main__":
    asyncio.run(main())
