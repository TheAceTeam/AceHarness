"""整理黄军 Judge 输入：review_tmp、ACEHarness runs/outputs、蓝军步骤产出。"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

DEFAULT_REVIEW_WORK_DIR = "review_tmp"
DEFAULT_JUDGE_WORK_DIR = "judge_tmp"
EXCERPT_LIMIT = 6000
TIMESTAMP_OUTPUT_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T[\d-]+-(.+)$")
RUN_OUTPUTS_DIR_RE = re.compile(
    r"[`'\"]?(?P<path>(?:[A-Za-z]:)?[^\s`\"']+[/\\]runs[/\\][^/\\]+[/\\]outputs)[/`'\"]?",
    re.IGNORECASE,
)


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


def logical_output_stem(stem: str) -> str:
    match = TIMESTAMP_OUTPUT_RE.match(stem)
    return match.group(1) if match else stem


def extract_tagged_block(text: str, tag: str) -> str:
    pattern = re.compile(rf"<{tag}>\s*([\s\S]*?)\s*</{tag}>", re.IGNORECASE)
    match = pattern.search(text or "")
    return match.group(1).strip() if match else ""


def extract_json_objects(text: str) -> List[Any]:
    objects: List[Any] = []
    if not text:
        return objects

    for block in re.findall(r"```(?:json)?\s*([\s\S]*?)```", text, flags=re.IGNORECASE):
        chunk = block.strip()
        if not chunk:
            continue
        try:
            objects.append(json.loads(chunk))
        except json.JSONDecodeError:
            continue

    decoder = json.JSONDecoder()
    idx = 0
    while idx < len(text):
        start = text.find("{", idx)
        if start < 0:
            break
        try:
            obj, end = decoder.raw_decode(text[start:])
            objects.append(obj)
            idx = start + end
        except json.JSONDecodeError:
            idx = start + 1
    return objects


def normalize_issue(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    rule_id = str(item.get("rule_id") or item.get("ruleId") or "").strip()
    problem = str(item.get("problem") or item.get("description") or item.get("content") or "").strip()
    file_path = str(item.get("file") or item.get("path") or "").strip()
    line = str(item.get("line") or item.get("lineno") or "").strip()
    severity = str(item.get("severity") or item.get("level") or "").strip()
    if not rule_id and not problem:
        return None
    out: Dict[str, Any] = {}
    if rule_id:
        out["rule_id"] = rule_id
    if file_path:
        out["file"] = file_path
    if line:
        out["line"] = line
    if problem:
        out["problem"] = problem
    if severity:
        out["severity"] = severity
    return out or None


def issues_from_payload(payload: Any) -> List[Dict[str, Any]]:
    if isinstance(payload, list):
        raw_items = payload
    elif isinstance(payload, dict):
        raw_items = payload.get("issues")
        if isinstance(raw_items, list):
            pass
        elif isinstance(payload.get("findings"), list):
            raw_items = payload.get("findings")
        elif payload.get("rule_id") or payload.get("problem") or payload.get("description"):
            raw_items = [payload]
        else:
            raw_items = []
    else:
        return []

    issues: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        normalized = normalize_issue(item)
        if not normalized:
            continue
        key = json.dumps(normalized, ensure_ascii=False, sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        issues.append(normalized)
    return issues


def parse_issues_from_text(text: str) -> List[Dict[str, Any]]:
    issues: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for obj in extract_json_objects(text):
        for item in issues_from_payload(obj):
            key = json.dumps(item, ensure_ascii=False, sort_keys=True)
            if key in seen:
                continue
            seen.add(key)
            issues.append(item)
    return issues


def load_review_artifacts(repo: Path, review_work_dir: str) -> Dict[str, Optional[str]]:
    base = repo / review_work_dir
    names = {
        "issues_json": "issues.json",
        "review_diff": "review.diff",
        "pr_diff": "pr.diff",
        "selected_rules": "selected_rules.md",
        "review_context": "review_context.json",
    }
    out: Dict[str, Optional[str]] = {}
    for key, filename in names.items():
        path = base / filename
        out[key] = str(path.resolve()) if path.is_file() else None
    return out


def load_issues_from_review_tmp(repo: Path, review_work_dir: str) -> Tuple[List[Dict[str, Any]], Optional[str], bool]:
    path = repo / review_work_dir / "issues.json"
    if not path.is_file():
        return [], None, False
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return [], str(path.resolve()), False

    if isinstance(data, dict) and isinstance(data.get("issues"), list) and len(data["issues"]) == 0:
        return [], str(path.resolve()), True

    issues = issues_from_payload(data)
    if issues:
        return issues, str(path.resolve()), False
    if isinstance(data, dict) and (data.get("rule_id") or data.get("problem")):
        one = normalize_issue(data)
        if one:
            return [one], str(path.resolve()), False
    return [], str(path.resolve()), isinstance(data, dict) and isinstance(data.get("issues"), list)


def stem_matches(stem: str, step_keys: List[str], step_substring: str) -> bool:
    logical = logical_output_stem(stem)
    if step_keys:
        for key in step_keys:
            if stem == key or logical == key or logical.endswith(f"-{key}") or key in logical:
                return True
        return False
    if step_substring:
        return step_substring in stem or step_substring in logical
    return True


def list_blue_output_files(
    outputs_dir: Path,
    *,
    step_keys: List[str],
    step_substring: str,
) -> List[Path]:
    if not outputs_dir.is_dir():
        return []

    candidates = sorted(
        p for p in outputs_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".md", ".txt"} and stem_matches(p.stem, step_keys, step_substring)
    )
    if not candidates:
        return []

    grouped: Dict[str, List[Path]] = {}
    for path in candidates:
        grouped.setdefault(logical_output_stem(path.stem), []).append(path)

    selected: List[Path] = []
    for paths in grouped.values():
        paths.sort(key=lambda p: (p.stat().st_size, p.stat().st_mtime), reverse=True)
        selected.append(paths[0])
    return sorted(selected, key=lambda p: p.stat().st_mtime)


def summarize_blue_output(path: Path) -> Dict[str, Any]:
    raw = _read_text(path)
    conclusion = extract_tagged_block(raw, "step-conclusion")
    excerpt_source = conclusion or raw
    excerpt = excerpt_source[-EXCERPT_LIMIT:] if len(excerpt_source) > EXCERPT_LIMIT else excerpt_source
    parsed_issues = parse_issues_from_text(raw)
    return {
        "step_key": logical_output_stem(path.stem),
        "path": str(path.resolve()),
        "excerpt": excerpt.strip(),
        "has_step_conclusion": bool(conclusion),
        "parsed_issue_count": len(parsed_issues),
        "parsed_issues": parsed_issues,
        "raw_bytes": len(raw.encode("utf-8")),
    }


def parse_prior_output_text(text: str) -> List[Dict[str, Any]]:
    if not text.strip():
        return []
    return parse_issues_from_text(text)


def extract_run_outputs_dirs(text: str) -> List[str]:
    found: List[str] = []
    seen: set[str] = set()
    for match in RUN_OUTPUTS_DIR_RE.finditer(text or ""):
        path = match.group("path").rstrip("/\\")
        if path not in seen:
            seen.add(path)
            found.append(path)
    return found


def resolve_run_outputs_dir(
    explicit: Optional[Path],
    prompt_text: str,
) -> Tuple[Optional[Path], List[str]]:
    warnings: List[str] = []
    if explicit is not None:
        if explicit.is_dir():
            return explicit, warnings
        warnings.append(f"run-outputs-dir 不存在: {explicit}")
        explicit = None

    for candidate in extract_run_outputs_dirs(prompt_text):
        path = Path(candidate)
        if path.is_dir():
            return path.resolve(), warnings
        warnings.append(f"Prompt 中的 outputs 路径不存在: {candidate}")
    return None, warnings


def build_context(
    *,
    repo: Path,
    review_work_dir: str,
    run_outputs_dir: Optional[Path],
    step_keys: List[str],
    step_substring: str,
    prior_output_text: str,
) -> Dict[str, Any]:
    warnings: List[str] = []
    review_artifacts = load_review_artifacts(repo, review_work_dir)
    issues, issues_path, blue_confirmed_empty = load_issues_from_review_tmp(repo, review_work_dir)
    issues_source = "none"

    blue_team_outputs: List[Dict[str, Any]] = []
    if run_outputs_dir is not None:
        for path in list_blue_output_files(run_outputs_dir, step_keys=step_keys, step_substring=step_substring):
            blue_team_outputs.append(summarize_blue_output(path))

    if not issues:
        merged: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for source in (
            parse_prior_output_text(prior_output_text),
            *[item for out in blue_team_outputs for item in out.get("parsed_issues", [])],
        ):
            for item in source:
                key = json.dumps(item, ensure_ascii=False, sort_keys=True)
                if key in seen:
                    continue
                seen.add(key)
                merged.append(item)
        if merged:
            issues = merged
            issues_source = "parsed_from_workflow_outputs"
    elif issues_path:
        issues_source = "review_tmp/issues.json"

    if not issues and blue_confirmed_empty:
        issues_source = "review_tmp/issues.json (empty)"

    if not issues and not blue_confirmed_empty:
        warnings.append(
            "未找到蓝军 issues：请确认 review_tmp/issues.json、蓝军步骤产出或 Prompt 中的「前序步骤产出」。"
        )
    if not review_artifacts.get("issues_json") and not blue_team_outputs and not prior_output_text.strip():
        warnings.append("缺少蓝军结构化产物与工作流输出，Judge 可能无法完成复核。")

    diff_path = review_artifacts.get("review_diff") or review_artifacts.get("pr_diff")
    if not diff_path:
        warnings.append("未找到 review_tmp/review.diff 或 pr.diff，请用 git diff 或 Read 源文件补证据。")

    summary_parts = [
        f"issues={len(issues)}",
        f"blue_outputs={len(blue_team_outputs)}",
        f"source={issues_source}",
    ]
    if blue_confirmed_empty:
        summary_parts.append("blue_confirmed_empty=true")

    return {
        "summary": "；".join(summary_parts),
        "issues_source": issues_source,
        "issues_path": issues_path,
        "blue_review_confirmed_empty": blue_confirmed_empty,
        "issues": issues,
        "blue_team_outputs": [
            {k: v for k, v in item.items() if k != "parsed_issues"}
            for item in blue_team_outputs
        ],
        "review_artifacts": review_artifacts,
        "run_outputs_dir": str(run_outputs_dir.resolve()) if run_outputs_dir else None,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="整理黄军 Judge 输入上下文（ACEHarness / review_tmp）")
    parser.add_argument("--repo", default=".", help="被 review 的项目根目录（含 review_tmp）")
    parser.add_argument("--review-work-dir", default=DEFAULT_REVIEW_WORK_DIR, help="蓝军 review 临时目录名")
    parser.add_argument("--work-dir", default=DEFAULT_JUDGE_WORK_DIR, help="黄军产出目录（相对 cwd）")
    parser.add_argument(
        "--run-outputs-dir",
        default="",
        help="ACEHarness runs/{runId}/outputs 绝对路径；可省略若 --prompt-context-file 中含该路径",
    )
    parser.add_argument(
        "--blue-step-keys",
        default="",
        help="蓝军步骤产出文件名（不含扩展名），逗号分隔；如 实施-代码审查,代码审查",
    )
    parser.add_argument(
        "--blue-step-substring",
        default="审查",
        help="按文件名子串筛选蓝军步骤产出（默认：审查）",
    )
    parser.add_argument(
        "--prior-output-text-file",
        default="",
        help="保存 ACEHarness「前序步骤产出」注入文本的文件（可选）",
    )
    parser.add_argument(
        "--prompt-context-file",
        default="",
        help="当前 Judge 步骤完整 prompt 文本（用于自动解析 runs/.../outputs 路径）",
    )
    parser.add_argument("--json", action="store_true", help="向 stdout 打印 judge_context.json 路径与摘要")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    step_keys = [s.strip() for s in args.blue_step_keys.split(",") if s.strip()]
    prior_text = _read_text(Path(args.prior_output_text_file)) if args.prior_output_text_file else ""
    prompt_text = _read_text(Path(args.prompt_context_file)) if args.prompt_context_file else ""
    combined_prompt = "\n".join(part for part in (prior_text, prompt_text) if part.strip())

    explicit_outputs = Path(args.run_outputs_dir).resolve() if args.run_outputs_dir else None
    run_outputs_dir, dir_warnings = resolve_run_outputs_dir(explicit_outputs, combined_prompt)

    context = build_context(
        repo=repo,
        review_work_dir=args.review_work_dir,
        run_outputs_dir=run_outputs_dir,
        step_keys=step_keys,
        step_substring=args.blue_step_substring.strip(),
        prior_output_text=combined_prompt,
    )
    context["warnings"] = dir_warnings + (context.get("warnings") or [])

    work_dir = Path(args.work_dir)
    if not work_dir.is_absolute():
        work_dir = Path.cwd() / work_dir
    work_dir.mkdir(parents=True, exist_ok=True)
    out_path = work_dir / "judge_context.json"
    out_path.write_text(json.dumps(context, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(f"[OK] judge_context 已写入 → {out_path.resolve()}")
    print(f"[信息] issues={len(context.get('issues') or [])} source={context.get('issues_source')}")
    for warning in context.get("warnings") or []:
        print(f"[WARN] {warning}", file=sys.stderr)

    if args.json:
        payload = {"judge_context": str(out_path.resolve()), **context}
        print(json.dumps(payload, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
