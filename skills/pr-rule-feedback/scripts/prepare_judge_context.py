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


def _read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return ""


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


def load_issues_from_review_tmp(repo: Path, review_work_dir: str) -> Tuple[List[Dict[str, Any]], Optional[str]]:
    path = repo / review_work_dir / "issues.json"
    if not path.is_file():
        return [], None
    try:
        data = json.loads(path.read_text(encoding="utf-8-sig"))
    except (OSError, json.JSONDecodeError):
        return [], str(path.resolve())
    issues = issues_from_payload(data)
    if issues:
        return issues, str(path.resolve())
    # 兼容顶层即为单条 issue 的 JSON
    if isinstance(data, dict) and (data.get("rule_id") or data.get("problem")):
        one = normalize_issue(data)
        if one:
            return [one], str(path.resolve())
    return [], str(path.resolve())


def list_blue_output_files(
    outputs_dir: Path,
    *,
    step_keys: List[str],
    step_substring: str,
) -> List[Path]:
    if not outputs_dir.is_dir():
        return []

    files = sorted(
        p for p in outputs_dir.iterdir()
        if p.is_file() and p.suffix.lower() in {".md", ".txt"}
    )
    if step_keys:
        wanted = {k.strip() for k in step_keys if k.strip()}
        files = [p for p in files if p.stem in wanted]
    if step_substring:
        files = [p for p in files if step_substring in p.stem]
    return files


def summarize_blue_output(path: Path) -> Dict[str, Any]:
    raw = _read_text(path)
    conclusion = extract_tagged_block(raw, "step-conclusion")
    excerpt_source = conclusion or raw
    excerpt = excerpt_source[-EXCERPT_LIMIT:] if len(excerpt_source) > EXCERPT_LIMIT else excerpt_source
    parsed_issues = parse_issues_from_text(raw)
    return {
        "step_key": path.stem,
        "path": str(path.resolve()),
        "excerpt": excerpt.strip(),
        "has_step_conclusion": bool(conclusion),
        "parsed_issue_count": len(parsed_issues),
        "parsed_issues": parsed_issues,
    }


def parse_prior_output_text(text: str) -> List[Dict[str, Any]]:
    if not text.strip():
        return []
    return parse_issues_from_text(text)


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
    issues, issues_path = load_issues_from_review_tmp(repo, review_work_dir)
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

    if not issues:
        warnings.append("未找到蓝军 issues：请确认 review_tmp/issues.json、蓝军步骤产出或 prompt 中的前序步骤产出。")
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

    return {
        "summary": "；".join(summary_parts),
        "issues_source": issues_source,
        "issues_path": issues_path,
        "issues": issues,
        "blue_team_outputs": [
            {k: v for k, v in item.items() if k != "parsed_issues"}
            for item in blue_team_outputs
        ],
        "review_artifacts": review_artifacts,
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
        help="ACEHarness runs/{runId}/outputs 绝对路径",
    )
    parser.add_argument(
        "--blue-step-keys",
        default="",
        help="蓝军步骤产出文件名（不含扩展名），逗号分隔；如 实施-代码审查,代码审查",
    )
    parser.add_argument(
        "--blue-step-substring",
        default="",
        help="按文件名子串筛选蓝军步骤产出（如 审查、pr-hard）",
    )
    parser.add_argument(
        "--prior-output-text-file",
        default="",
        help="保存 ACEHarness「前序步骤产出」注入文本的文件（可选）",
    )
    parser.add_argument("--json", action="store_true", help="向 stdout 打印 judge_context.json 路径与摘要")
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    run_outputs_dir = Path(args.run_outputs_dir).resolve() if args.run_outputs_dir else None
    step_keys = [s.strip() for s in args.blue_step_keys.split(",") if s.strip()]
    prior_text = ""
    if args.prior_output_text_file:
        prior_text = _read_text(Path(args.prior_output_text_file))

    context = build_context(
        repo=repo,
        review_work_dir=args.review_work_dir,
        run_outputs_dir=run_outputs_dir,
        step_keys=step_keys,
        step_substring=args.blue_step_substring.strip(),
        prior_output_text=prior_text,
    )

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
        print(json.dumps({"judge_context": str(out_path.resolve()), **context}, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
