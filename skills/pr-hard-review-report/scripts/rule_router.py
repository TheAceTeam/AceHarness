"""Skill 内置规则路由（无 data_flywheel 依赖）。"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Set, Tuple


def _exts_from_files(changed_files: str) -> Set[str]:
    exts: Set[str] = set()
    for part in re.split(r"[\s,;]+", changed_files or ""):
        part = part.strip()
        if "." in part:
            exts.add(part.rsplit(".", 1)[-1].lower())
    return exts


def _glob_match(card: Dict[str, Any], changed_files: str) -> bool:
    globs = card.get("file_globs") or []
    if not globs:
        return True
    text = changed_files or ""
    for g in globs:
        g = str(g).replace("**/", "").replace("*.", ".")
        if g.strip(".") in text:
            return True
    return False


def _keyword_hits(card: Dict[str, Any], diff: str) -> int:
    hits = 0
    blob = (diff or "") + " " + (card.get("text") or "")
    for kw in card.get("keyword_triggers") or []:
        if str(kw).lower() in blob.lower():
            hits += 1
    for kw in re.findall(r"[\u4e00-\u9fff]{2,}", card.get("text") or ""):
        if kw in (diff or ""):
            hits += 1
    return hits


def _severity_weight(card: Dict[str, Any]) -> float:
    return {"high": 3.0, "medium": 2.0, "low": 1.0}.get(card.get("severity"), 1.5)


def select_rules_local(
    registry: Dict[str, Any],
    *,
    diff: str = "",
    changed_files: str = "",
    max_rules: int = 60,
    token_budget: int = 12000,
    dimension_priority: Optional[List[str]] = None,
    soft_only: bool = False,
) -> Dict[str, Any]:
    dim_prio = {d: i for i, d in enumerate(dimension_priority or ["function", "spec", "style"])}
    candidates: List[Tuple[float, Dict[str, Any]]] = []
    always_on: List[Dict[str, Any]] = []

    for card in registry.get("rules", []):
        if soft_only and card.get("rule_tier") == "hard":
            continue
        if card.get("always_on") and not soft_only:
            always_on.append(card)
            continue
        if not _glob_match(card, changed_files):
            continue
        kh = _keyword_hits(card, diff)
        if kh == 0 and not diff:
            continue
        score = _severity_weight(card) + kh * 1.5
        score += 0.1 * (len(dim_prio) - dim_prio.get(card.get("dimension"), 3))
        score += 0.01 * int(card.get("support_count") or 1)
        if kh > 0 or score >= 2.5:
            candidates.append((score, card))

    candidates.sort(key=lambda x: -x[0])
    selected: List[Dict[str, Any]] = []
    seen: Set[str] = set()
    chars = 0

    def _add(card: Dict[str, Any]) -> None:
        nonlocal chars
        cid = card["id"]
        if cid in seen:
            return
        block = render_selected_rule_block(card)
        if chars + len(block) > token_budget and selected:
            return
        seen.add(cid)
        selected.append(card)
        chars += len(block)

    for card in always_on:
        if len(selected) >= max_rules:
            break
        _add(card)
    for _, card in candidates:
        if len(selected) >= max_rules:
            break
        _add(card)

    return {
        "selected": selected,
        "always_on_count": len(always_on),
        "candidate_count": len(candidates),
        "mode": "local",
    }


def render_selected_rule_block(card: Dict[str, Any]) -> str:
    e = card.get("enrichment") or {}
    lines = [
        f"### [{card['id']}] {card.get('category', '')}",
        f"**规则**: {card.get('text', '')}",
    ]
    if e.get("positive_signals"):
        lines.append(f"**触发现象**: {'；'.join(e['positive_signals'][:3])}")
    if e.get("negative_guards"):
        lines.append(f"**误报边界**: {'；'.join(e['negative_guards'][:2])}")
    if e.get("review_questions"):
        lines.append(f"**审查问题**: {'；'.join(e['review_questions'][:2])}")
    if e.get("fix_hint"):
        lines.append(f"**修复建议**: {str(e['fix_hint'])[:120]}")
    if card.get("action_level"):
        lines.append(f"**级别**: {card['action_level']} ({card.get('severity', 'medium')})")
    lines.append("")
    return "\n".join(lines)


def render_selected_with_cards(selected: List[Dict[str, Any]], cards_dir) -> str:
    parts: List[str] = ["# 本次适用规则", ""]
    for card in selected:
        parts.append(render_selected_rule_block(card))
        card_path = cards_dir / f"{card['id']}.md"
        if card_path.exists():
            parts.append(f"<!-- card: {card_path.name} -->")
            parts.append(card_path.read_text(encoding="utf-8"))
            parts.append("")
    return "\n".join(parts)
