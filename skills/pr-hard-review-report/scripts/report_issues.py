"""从 review issues JSON 批量上报到 rule-issue-reports 接口。"""
from __future__ import annotations

import argparse
import json
import sys
import time
import urllib3
from pathlib import Path
from typing import Any, Dict, Optional, Set, Tuple

import requests

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SKILL_DIR = Path(__file__).resolve().parent.parent
REGISTRY_JSON = SKILL_DIR / "rules_registry.json"
LEGACY_CHECKPOINT_JSON = SKILL_DIR / "checkpoint_rules.json"

DEFAULT_SERVER_URL = "https://opencsitool.com/opencsitool"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_RETRIES = 3
DEFAULT_RETRY_BACKOFF_SEC = 2.0
DEFAULT_VERIFY_SSL = False  # 等同 curl -k，跳过 HTTPS 证书校验


def load_valid_rule_ids() -> Set[str]:
    path = REGISTRY_JSON if REGISTRY_JSON.exists() else LEGACY_CHECKPOINT_JSON
    if not path.exists():
        repo_reg = SKILL_DIR.parents[2] / "output" / "prompts" / "latest" / "rules" / "rules_registry.json"
        if repo_reg.exists():
            path = repo_reg
        else:
            raise FileNotFoundError(f"找不到 rules_registry.json: {REGISTRY_JSON}")
    data = json.loads(path.read_text(encoding="utf-8"))
    if "rules" in data:
        return {str(r["id"]).strip() for r in data["rules"] if r.get("id")}
    return {str(r["rule_id"]).strip() for r in data.get("rules") or [] if r.get("rule_id")}


def format_issue_content(issue: Dict[str, Any]) -> str:
    problem = str(issue.get("problem") or issue.get("content") or "").strip()
    file_ = str(issue.get("file") or "").strip()
    line = str(issue.get("line") or "").strip()
    if file_ and line:
        prefix = f"{file_}:{line} — "
        if not problem.startswith(prefix):
            problem = prefix + problem
    elif file_ and file_ not in problem:
        problem = f"{file_} — {problem}"
    return problem


def validate_issue(issue: Dict[str, Any], valid_ids: Set[str]) -> str | None:
    rid = str(issue.get("rule_id") or "").strip()
    if not rid:
        return "缺少 rule_id"
    if rid not in valid_ids:
        return f"rule_id 不在 registry 内: {rid}"
    extra = issue.get("rule_ids")
    if isinstance(extra, list) and len(extra) > 1:
        return "一条 issue 只能对应一个 rule_id，禁止 rule_ids 多规则混传"
    if not str(issue.get("problem") or "").strip():
        return "缺少 problem/content"
    return None


def count_issues_by_rule_id(issues: list[Dict[str, Any]]) -> Dict[str, int]:
    """统计每个 rule_id 在本轮 review 中对应几条 issue。"""
    counts: Dict[str, int] = {}
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        rid = str(issue.get("rule_id") or "").strip()
        if rid:
            counts[rid] = counts.get(rid, 0) + 1
    return counts


def group_issues_by_rule_id(issues: list[Dict[str, Any]]) -> Dict[str, list[Dict[str, Any]]]:
    groups: Dict[str, list[Dict[str, Any]]] = {}
    for issue in issues:
        if not isinstance(issue, dict):
            continue
        rid = str(issue.get("rule_id") or "").strip()
        if not rid:
            continue
        groups.setdefault(rid, []).append(issue)
    return groups


def format_rule_batch_content(rule_issues: list[Dict[str, Any]]) -> str:
    """同一 rule_id 的多条 issue 合并为一条 content（批量上报）。"""
    return "\n\n".join(format_issue_content(i) for i in rule_issues)


def report_one(
    server_url: str,
    rule_id: str,
    content: str,
    review_issue_count: int,
    *,
    api_key: str = "",
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    retries: int = DEFAULT_RETRIES,
    retry_backoff_sec: float = DEFAULT_RETRY_BACKOFF_SEC,
    verify_ssl: bool = DEFAULT_VERIFY_SSL,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    """POST 上报；成功返回 (response, None)，失败返回 (None, error_message)。"""
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    payload = {
        "rule_ids": [rule_id],
        "content": content,
        "review_issue_count": review_issue_count,
    }
    url = f"{server_url.rstrip('/')}/api/v1/rule-issue-reports"
    last_err = "unknown error"

    for attempt in range(1, max(1, retries) + 1):
        try:
            resp = requests.post(
                url,
                json=payload,
                headers=headers,
                timeout=timeout_sec,
                verify=verify_ssl,
            )
            resp.raise_for_status()
            return resp.json(), None
        except requests.RequestException as exc:
            last_err = str(exc)
            if attempt < retries:
                time.sleep(retry_backoff_sec)

    return None, last_err


def main() -> int:
    parser = argparse.ArgumentParser(description="批量上报 PR review issues")
    parser.add_argument("issues_json", help="issues JSON 文件路径，或 '-' 表示 stdin")
    parser.add_argument("--server", default=DEFAULT_SERVER_URL)
    parser.add_argument("--api-key", default="")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC, help="单次请求超时（秒）")
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES, help="失败重试次数")
    parser.add_argument(
        "--verify-ssl",
        action="store_true",
        help="校验 HTTPS 证书（默认关闭，等同 curl -k）",
    )
    parser.add_argument(
        "--mode",
        choices=("per-issue", "per-rule"),
        default="per-issue",
        help="per-issue: 每条 issue 一次 POST；per-rule: 同一 rule_id 合并一次 POST",
    )
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    if args.issues_json == "-":
        raw = sys.stdin.read()
    else:
        raw = Path(args.issues_json).read_text(encoding="utf-8")
    data = json.loads(raw)
    issues = data.get("issues") if isinstance(data, dict) else data
    if not isinstance(issues, list):
        print("[FAIL] JSON 需包含 issues 数组", file=sys.stderr)
        return 1

    valid_ids = load_valid_rule_ids()
    n = len(issues)
    if n == 0:
        print("[SKIP] issues 为空，不上报")
        return 0

    for i, issue in enumerate(issues):
        if not isinstance(issue, dict):
            print(f"[FAIL] issue[{i}] 非对象", file=sys.stderr)
            return 1
        err = validate_issue(issue, valid_ids)
        if err:
            print(f"[FAIL] issue[{i}]: {err}", file=sys.stderr)
            return 1

    rule_counts = count_issues_by_rule_id(issues)
    ok_count = 0
    fail_count = 0
    failed_items: list[str] = []
    upload_total = n if args.mode == "per-issue" else len(rule_counts)

    if args.mode == "per-rule":
        for rid, rule_issues in group_issues_by_rule_id(issues).items():
            per_rule_count = len(rule_issues)
            content = format_rule_batch_content(rule_issues)
            if args.dry_run:
                print(
                    f"[DRY-RUN] {rid} review_issue_count={per_rule_count} "
                    f"issues={per_rule_count}: {content[:80]}"
                )
                ok_count += 1
                continue
            result, post_err = report_one(
                args.server,
                rid,
                content,
                per_rule_count,
                api_key=args.api_key,
                timeout_sec=args.timeout,
                retries=args.retries,
                verify_ssl=args.verify_ssl,
            )
            if result is not None:
                print(
                    f"[OK] rule={rid} review_issue_count={per_rule_count} "
                    f"report_id={result.get('report_id')}"
                )
                ok_count += 1
            else:
                fail_count += 1
                failed_items.append(f"rule={rid}")
                print(
                    f"[WARN] rule={rid} 上报失败（已重试 {args.retries} 次，"
                    f"timeout={args.timeout}s）: {post_err}",
                    file=sys.stderr,
                )
    else:
        for i, issue in enumerate(issues):
            rid = str(issue["rule_id"]).strip()
            per_rule_count = rule_counts[rid]
            content = format_issue_content(issue)
            if args.dry_run:
                print(
                    f"[DRY-RUN] issue[{i}] {rid} review_issue_count={per_rule_count}: "
                    f"{content[:60]}"
                )
                ok_count += 1
                continue

            result, post_err = report_one(
                args.server,
                rid,
                content,
                per_rule_count,
                api_key=args.api_key,
                timeout_sec=args.timeout,
                retries=args.retries,
                verify_ssl=args.verify_ssl,
            )
            if result is not None:
                print(
                    f"[OK] issue[{i}] rule={rid} review_issue_count={per_rule_count} "
                    f"report_id={result.get('report_id')}"
                )
                ok_count += 1
            else:
                fail_count += 1
                failed_items.append(f"issue[{i}] {rid}")
                print(
                    f"[WARN] issue[{i}] 上报失败（已重试 {args.retries} 次，"
                    f"timeout={args.timeout}s）: {post_err}",
                    file=sys.stderr,
                )

    print(f"[DONE] 上报 {ok_count}/{upload_total} 条（mode={args.mode}，issues 共 {n} 条）")
    if fail_count:
        print(
            f"[WARN] {fail_count} 条未上报成功。"
            f"请确认上报服务可访问（{args.server}/api/v1/rule-issue-reports）。"
            f"失败项: {', '.join(failed_items)}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
