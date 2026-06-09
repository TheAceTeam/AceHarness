"""Skill 内置规则路由：diff → Top-K 规则卡片 → selected_rules.md（自包含，无 repo 依赖）。"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from rule_router import render_selected_with_cards, select_rules_local

SKILL_DIR = SCRIPT_DIR.parent
DEFAULT_REGISTRY = SKILL_DIR / "rules_registry.json"
DEFAULT_INDEX = SKILL_DIR / "rules" / "search_index.json"
DEFAULT_CARDS = SKILL_DIR / "rules" / "cards"
DEFAULT_WORK_DIR = "review_tmp"

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]{2,}|[a-zA-Z_]{3,}")


def _load_registry(path: Path) -> Dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return {"version": 1, "rules": data, "meta": {}}
    return data


def _load_search_index(path: Path) -> Dict[str, Any]:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {}


def _index_score(rid: str, blob: str, index: Dict[str, Any]) -> float:
    postings = index.get("postings") or {}
    meta = (index.get("cards_meta") or {}).get(rid) or {}
    score = 0.0
    blob_l = blob.lower()
    for kw in meta.get("keyword_triggers") or []:
        if str(kw).lower() in blob_l:
            score += 2.0
    for term in _TOKEN_RE.findall(blob):
        t = term.lower()
        if t in postings and rid in postings[t]:
            score += 0.5
    return score


def select_rules_with_index(
    registry: Dict[str, Any],
    index: Dict[str, Any],
    *,
    diff: str = "",
    changed_files: str = "",
    max_rules: int = 40,
    token_budget: int = 12000,
    dimension_priority: List[str] | None = None,
) -> Dict[str, Any]:
    blob = f"{diff or ''} {changed_files or ''}"
    local = select_rules_local(
        registry,
        diff=diff,
        changed_files=changed_files,
        max_rules=max_rules * 2,
        token_budget=token_budget * 2,
        dimension_priority=dimension_priority,
    )
    candidates = {c["id"]: c for c in local.get("selected") or []}
    for card in registry.get("rules") or []:
        rid = card["id"]
        extra = _index_score(rid, blob, index)
        if extra > 0 or card.get("always_on"):
            candidates[rid] = card

    dim_prio = {d: i for i, d in enumerate(dimension_priority or ["function", "spec", "style"])}
    scored: List[Tuple[float, Dict[str, Any]]] = []
    for card in candidates.values():
        rid = card["id"]
        s = _index_score(rid, blob, index)
        if card.get("always_on"):
            s += 100.0
        sev = {"high": 3.0, "medium": 2.0, "low": 1.0}.get(card.get("severity"), 1.5)
        s += sev
        s += 0.1 * (len(dim_prio) - dim_prio.get(card.get("dimension"), 3))
        scored.append((s, card))
    scored.sort(key=lambda x: -x[0])

    selected: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    chars = 0
    for _, card in scored:
        if len(selected) >= max_rules:
            break
        rid = card["id"]
        if rid in seen:
            continue
        block_len = len(card.get("text") or "") + 200
        if chars + block_len > token_budget and selected:
            continue
        seen.add(rid)
        selected.append(card)
        chars += block_len

    return {
        "selected": selected,
        "mode": "local_index",
        "candidate_count": len(scored),
        "chars_used": chars,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Skill 本地规则路由")
    parser.add_argument("--registry", default=str(DEFAULT_REGISTRY))
    parser.add_argument("--index", default=str(DEFAULT_INDEX))
    parser.add_argument("--cards-dir", default=str(DEFAULT_CARDS))
    parser.add_argument("--diff", default="")
    parser.add_argument("--diff-file", default="")
    parser.add_argument("--changed-files", default="")
    parser.add_argument("--max-rules", type=int, default=40)
    parser.add_argument("--token-budget", type=int, default=12000)
    parser.add_argument(
        "--work-dir",
        default=DEFAULT_WORK_DIR,
        help="本次 review 临时目录（相对 cwd，默认 review_tmp）",
    )
    parser.add_argument(
        "--out",
        default="",
        help="输出 markdown；默认 {work-dir}/selected_rules.md",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    work_dir = Path(args.work_dir)
    if not work_dir.is_absolute():
        work_dir = Path.cwd() / work_dir
    out_path = Path(args.out) if args.out else work_dir / "selected_rules.md"
    if not out_path.is_absolute():
        out_path = Path.cwd() / out_path

    diff = args.diff
    if args.diff_file:
        diff_path = Path(args.diff_file)
        if not diff_path.exists():
            print(f"[FAIL] diff-file 不存在: {diff_path.resolve()}", file=sys.stderr)
            print(
                "[提示] 先运行 prepare_review_context.py，或改用 --diff / 去掉 --diff-file",
                file=sys.stderr,
            )
            return 1
        diff = diff_path.read_text(encoding="utf-8")

    if not diff.strip() and not str(args.changed_files or "").strip():
        print(
            "[WARN] diff 与 changed_files 均为空，仅路由 always_on 规则",
            file=sys.stderr,
        )

    reg_path = Path(args.registry)
    idx_path = Path(args.index)
    cards_dir = Path(args.cards_dir)

    if not reg_path.exists():
        print(f"[FAIL] 找不到 registry: {reg_path}", file=sys.stderr)
        return 1
    if not cards_dir.exists():
        print(f"[FAIL] 找不到 cards 目录: {cards_dir}", file=sys.stderr)
        return 1

    registry = _load_registry(reg_path)
    index = _load_search_index(idx_path)
    result = select_rules_with_index(
        registry,
        index,
        diff=diff,
        changed_files=args.changed_files,
        max_rules=args.max_rules,
        token_budget=args.token_budget,
    )
    selected = result.get("selected") or []
    print(f"[路由] mode={result.get('mode')} selected={len(selected)} chars~{result.get('chars_used', 0)}")

    if not selected:
        print("[FAIL] 未路由到任何规则，请检查 diff / changed_files / registry", file=sys.stderr)
        return 1

    if args.dry_run:
        for c in selected:
            print(f"  - {c['id']} [{c.get('rule_tier')}] {str(c.get('text', ''))[:60]}")
        return 0

    md = render_selected_with_cards(selected, cards_dir)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(md, encoding="utf-8")
    print(f"[输出] work_dir={work_dir.resolve()}")
    print(f"[输出] → {out_path.resolve()}")
    print(f"[OK] selected_rules 已写入，L2 请读取 stdout 上的绝对路径")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
