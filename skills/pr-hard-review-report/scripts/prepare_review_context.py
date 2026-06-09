"""准备 review 所需的 diff 与 changed_files（git / 编码 agent 上下文）。"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import List, Optional, Tuple

DEFAULT_WORK_DIR = "review_tmp"


def _run_git(repo: Path, *args: str) -> Tuple[int, str]:
    proc = subprocess.run(
        ["git", "-C", str(repo), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    out = (proc.stdout or "").strip()
    if proc.returncode != 0 and proc.stderr:
        err = proc.stderr.strip()
        if err and proc.returncode != 0:
            return proc.returncode, err
    return proc.returncode, out


def find_repo_root(start: Path) -> Optional[Path]:
    code, out = _run_git(start, "rev-parse", "--show-toplevel")
    if code != 0 or not out:
        return None
    return Path(out)


def detect_base_branch(repo: Path) -> str:
    for candidate in ("main", "master", "origin/main", "origin/master"):
        code, _ = _run_git(repo, "rev-parse", "--verify", candidate)
        if code == 0:
            return candidate
    return "HEAD~1"


def collect_changed_files(
    repo: Path,
    *,
    base: str,
    include_unstaged: bool,
    include_staged: bool,
    extra_files: List[str],
) -> List[str]:
    files: set[str] = set()
    for f in extra_files:
        f = f.strip()
        if f:
            files.add(f.replace("\\", "/"))

    code, listed = _run_git(repo, "diff", "--name-only", base)
    if code == 0 and listed:
        files.update(line.strip().replace("\\", "/") for line in listed.splitlines() if line.strip())

    if include_staged:
        code, listed = _run_git(repo, "diff", "--cached", "--name-only")
        if code == 0 and listed:
            files.update(line.strip().replace("\\", "/") for line in listed.splitlines() if line.strip())

    if include_unstaged:
        code, listed = _run_git(repo, "diff", "--name-only")
        if code == 0 and listed:
            files.update(line.strip().replace("\\", "/") for line in listed.splitlines() if line.strip())

    return sorted(files)


def collect_diff(
    repo: Path,
    *,
    base: str,
    include_unstaged: bool,
    include_staged: bool,
) -> str:
    parts: List[str] = []

    code, diff = _run_git(repo, "diff", base)
    if code == 0 and diff:
        parts.append(diff)

    if include_staged:
        code, diff = _run_git(repo, "diff", "--cached")
        if code == 0 and diff:
            parts.append(diff)

    if include_unstaged:
        code, diff = _run_git(repo, "diff")
        if code == 0 and diff:
            parts.append(diff)

    return "\n".join(p for p in parts if p).strip()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="从 git 或编码 agent 提供的文件列表准备 diff + changed_files",
    )
    parser.add_argument(
        "--repo",
        default=".",
        help="被 review 的 git 仓库根目录（默认当前目录）",
    )
    parser.add_argument(
        "--base",
        default="",
        help="对比基线分支/commit（默认自动检测 main/master）",
    )
    parser.add_argument(
        "--changed-files",
        default="",
        help="编码 agent 已知的变更文件，逗号分隔；会与 git 结果合并",
    )
    parser.add_argument(
        "--no-unstaged",
        action="store_true",
        help="不包含工作区未暂存改动",
    )
    parser.add_argument(
        "--no-staged",
        action="store_true",
        help="不包含已暂存改动",
    )
    parser.add_argument(
        "--work-dir",
        "--out-dir",
        dest="work_dir",
        default=DEFAULT_WORK_DIR,
        help="本次 review 临时目录（默认 review_tmp，相对 cwd）",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="向 stdout 输出 JSON（含 diff、changed_files）",
    )
    args = parser.parse_args()

    repo = find_repo_root(Path(args.repo).resolve())
    if repo is None:
        extra = [f.strip() for f in args.changed_files.split(",") if f.strip()]
        if not extra:
            print("[FAIL] 不在 git 仓库内，且未提供 --changed-files", file=sys.stderr)
            return 1
        ctx = {
            "repo": str(Path(args.repo).resolve()),
            "source": "agent_context_only",
            "base": "",
            "changed_files": extra,
            "diff": "",
            "warning": "无 git diff；请结合对话中的代码片段做 L2 判定",
        }
        out_dir = Path(args.work_dir or DEFAULT_WORK_DIR)
        if not out_dir.is_absolute():
            out_dir = Path.cwd() / out_dir
        out_dir.mkdir(parents=True, exist_ok=True)
        (out_dir / "review_context.json").write_text(
            json.dumps(ctx, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        print(f"[输出] work_dir={out_dir.resolve()}")
        if args.json:
            print(json.dumps(ctx, ensure_ascii=False, indent=2))
        else:
            print(",".join(extra))
        return 0

    base = args.base.strip() or detect_base_branch(repo)
    extra_files = [f.strip() for f in args.changed_files.split(",") if f.strip()]
    changed_files = collect_changed_files(
        repo,
        base=base,
        include_unstaged=not args.no_unstaged,
        include_staged=not args.no_staged,
        extra_files=extra_files,
    )
    diff = collect_diff(
        repo,
        base=base,
        include_unstaged=not args.no_unstaged,
        include_staged=not args.no_staged,
    )

    ctx = {
        "repo": str(repo),
        "source": "git",
        "base": base,
        "changed_files": changed_files,
        "diff": diff,
    }
    if not diff and changed_files:
        ctx["warning"] = "有变更文件但 diff 为空，可能改动已提交；可改用 --base HEAD~N"

    out_dir = Path(args.work_dir or DEFAULT_WORK_DIR)
    if not out_dir.is_absolute():
        out_dir = Path.cwd() / out_dir
    out_dir.mkdir(parents=True, exist_ok=True)
    if diff:
        (out_dir / "review.diff").write_text(diff + "\n", encoding="utf-8")
    (out_dir / "review_context.json").write_text(
        json.dumps(ctx, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(f"[输出] work_dir={out_dir.resolve()}")

    if args.json:
        print(json.dumps(ctx, ensure_ascii=False, indent=2))
    else:
        print(f"repo={repo}")
        print(f"base={base}")
        print(f"changed_files={','.join(changed_files)}")
        print(f"diff_bytes={len(diff.encode('utf-8'))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
