"""从 judge feedbacks JSON 批量上报到 rule-feedback-reports 接口。

上报成功后刷新源文件（清空或仅保留失败项），避免重复 POST。
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

import requests
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

SKILL_DIR = Path(__file__).resolve().parent.parent
REGISTRY_JSON = SKILL_DIR / "rules_registry.json"

DEFAULT_SERVER_URL = "https://opencsitool.com/opencsitool"
DEFAULT_TIMEOUT_SEC = 20
DEFAULT_RETRIES = 3
DEFAULT_RETRY_BACKOFF_SEC = 2.0
DEFAULT_VERIFY_SSL = False
DEFAULT_AGENT = True


def load_valid_rule_ids() -> Set[str]:
    if not REGISTRY_JSON.exists():
        return set()
    data = json.loads(REGISTRY_JSON.read_text(encoding="utf-8"))
    return {str(r["id"]).strip() for r in data.get("rules", []) if r.get("id")}


def validate_feedback(
    item: Dict[str, Any],
    valid_ids: Set[str],
    *,
    require_rule_ids: bool,
) -> str | None:
    content = str(item.get("content") or "").strip()
    if not content:
        return "缺少 content"
    agent = item.get("agent")
    if agent is None:
        return None
    if not isinstance(agent, bool):
        return "agent 必须为布尔 true/false"
    rule_ids = item.get("rule_ids")
    if rule_ids is None:
        if require_rule_ids:
            return "缺少 rule_ids"
        return None
    if not isinstance(rule_ids, list):
        return "rule_ids 必须为数组"
    cleaned = [str(r).strip() for r in rule_ids if str(r).strip()]
    if require_rule_ids and not cleaned:
        return "rule_ids 不能为空数组"
    if valid_ids and cleaned:
        bad = [r for r in cleaned if r not in valid_ids]
        if bad:
            return f"rule_id 不在 registry 内: {', '.join(bad[:3])}"
    return None


def normalize_rule_ids(item: Dict[str, Any]) -> list[str]:
    raw = item.get("rule_ids")
    if not isinstance(raw, list):
        return []
    seen: set[str] = set()
    out: list[str] = []
    for r in raw:
        rid = str(r or "").strip()
        if not rid or rid in seen:
            continue
        seen.add(rid)
        out.append(rid)
    return out


def report_one(
    server_url: str,
    rule_ids: list[str],
    content: str,
    agent: bool,
    *,
    api_key: str = "",
    timeout_sec: int = DEFAULT_TIMEOUT_SEC,
    retries: int = DEFAULT_RETRIES,
    retry_backoff_sec: float = DEFAULT_RETRY_BACKOFF_SEC,
    verify_ssl: bool = DEFAULT_VERIFY_SSL,
) -> Tuple[Optional[Dict[str, Any]], Optional[str]]:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["X-API-Key"] = api_key
    payload: Dict[str, Any] = {
        "content": content,
        "agent": agent,
    }
    if rule_ids:
        payload["rule_ids"] = rule_ids
    url = f"{server_url.rstrip('/')}/api/v1/rule-feedback-reports"
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


def refresh_feedbacks_file(
    path: Path,
    *,
    pending: List[Dict[str, Any]],
    reported_count: int,
    dry_run: bool,
) -> None:
    """上报后刷新 feedbacks.json，防止下次误重复上报。"""
    if dry_run or str(path) == "-":
        return
    if reported_count <= 0:
        return

    if pending:
        payload = {
            "summary": f"待重试 {len(pending)} 条（{datetime.now(timezone.utc).isoformat()}）",
            "feedbacks": pending,
        }
        note = f"[REFRESH] 保留 {len(pending)} 条未成功项"
    else:
        payload = {"summary": "", "feedbacks": []}
        note = "[REFRESH] 已全部上报，feedbacks.json 已清空"

    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(note)


def main() -> int:
    parser = argparse.ArgumentParser(description="批量上报规则反馈 rule-feedback-reports")
    parser.add_argument("feedbacks_json", help="feedbacks JSON 文件路径，或 '-' 表示 stdin")
    parser.add_argument("--server", default=DEFAULT_SERVER_URL)
    parser.add_argument("--api-key", default="")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT_SEC)
    parser.add_argument("--retries", type=int, default=DEFAULT_RETRIES)
    parser.add_argument(
        "--verify-ssl",
        action="store_true",
        help="校验 HTTPS 证书（默认关闭，等同 curl -k）",
    )
    parser.add_argument(
        "--agent",
        choices=("true", "false"),
        default="true" if DEFAULT_AGENT else "false",
        help="默认 agent 字段（单条 feedback 未写 agent 时使用）",
    )
    parser.add_argument(
        "--require-rule-ids",
        action="store_true",
        help="强制每条 feedback 必须带 rule_ids",
    )
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--no-refresh",
        action="store_true",
        help="上报后不刷新 feedbacks.json（调试用，默认会上报后清空或仅保留失败项）",
    )
    args = parser.parse_args()

    feedbacks_path: Optional[Path] = None
    if args.feedbacks_json == "-":
        raw = sys.stdin.read()
    else:
        feedbacks_path = Path(args.feedbacks_json)
        raw = feedbacks_path.read_text(encoding="utf-8")
    data = json.loads(raw)
    items = data.get("feedbacks") if isinstance(data, dict) else data
    if not isinstance(items, list):
        print("[FAIL] JSON 需包含 feedbacks 数组", file=sys.stderr)
        return 1

    if not items:
        print("[SKIP] feedbacks 为空，不上报")
        return 0

    valid_ids = load_valid_rule_ids()
    default_agent = args.agent == "true"

    for i, item in enumerate(items):
        if not isinstance(item, dict):
            print(f"[FAIL] feedbacks[{i}] 非对象", file=sys.stderr)
            return 1
        err = validate_feedback(item, valid_ids, require_rule_ids=args.require_rule_ids)
        if err:
            print(f"[FAIL] feedbacks[{i}]: {err}", file=sys.stderr)
            return 1

    ok_count = 0
    fail_count = 0
    failed_items: list[str] = []
    pending_feedbacks: List[Dict[str, Any]] = []

    for i, item in enumerate(items):
        rule_ids = normalize_rule_ids(item)
        content = str(item.get("content") or "").strip()
        agent = item.get("agent")
        if agent is None:
            agent = default_agent
        elif not isinstance(agent, bool):
            agent = bool(agent)

        if args.dry_run:
            print(
                f"[DRY-RUN] feedbacks[{i}] agent={agent} "
                f"rule_ids={rule_ids}: {content[:80]}"
            )
            ok_count += 1
            continue

        result, post_err = report_one(
            args.server,
            rule_ids,
            content,
            agent,
            api_key=args.api_key,
            timeout_sec=args.timeout,
            retries=args.retries,
            verify_ssl=args.verify_ssl,
        )
        if result is not None:
            fid = result.get("feedback_id") or result.get("report_id") or ""
            print(f"[OK] feedbacks[{i}] agent={agent} feedback_id={fid}")
            ok_count += 1
        else:
            fail_count += 1
            failed_items.append(f"feedbacks[{i}]")
            pending_feedbacks.append(item)
            print(
                f"[WARN] feedbacks[{i}] 上报失败（已重试 {args.retries} 次，"
                f"timeout={args.timeout}s）: {post_err}",
                file=sys.stderr,
            )

    print(f"[DONE] 上报 {ok_count}/{len(items)} 条")

    if not args.no_refresh and feedbacks_path is not None:
        refresh_feedbacks_file(
            feedbacks_path,
            pending=pending_feedbacks,
            reported_count=ok_count,
            dry_run=args.dry_run,
        )
    if fail_count:
        print(
            f"[WARN] {fail_count} 条未上报成功。"
            f"请确认服务可访问（{args.server}/api/v1/rule-feedback-reports）。"
            f"失败项: {', '.join(failed_items)}",
            file=sys.stderr,
        )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
