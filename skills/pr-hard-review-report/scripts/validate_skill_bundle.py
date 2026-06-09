"""校验 Skill 包完整性（打包前 / 安装后自检）。"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS = SKILL_DIR / "scripts"

REQUIRED_ROOT = [
    "SKILL.md",
    "rules.md",
    "rules_registry.json",
    "checkpoint_rules.json",
    "review-examples.md",
    "final-97-rules.md",
    "rules/search_index.json",
    "requirements.txt",
]

REQUIRED_SCRIPTS = [
    "select_rules.py",
    "rule_router.py",
    "prepare_review_context.py",
    "report_issues.py",
    "report_issue.ps1",
    "validate_skill_bundle.py",
]


def _fail(msg: str) -> int:
    print(f"[FAIL] {msg}", file=sys.stderr)
    return 1


def main() -> int:
    missing = [p for p in REQUIRED_ROOT if not (SKILL_DIR / p).exists()]
    missing += [f"scripts/{s}" for s in REQUIRED_SCRIPTS if not (SCRIPTS / s).exists()]
    if missing:
        return _fail("缺少文件: " + ", ".join(missing))

    reg = json.loads((SKILL_DIR / "rules_registry.json").read_text(encoding="utf-8"))
    rule_ids = {r["id"] for r in reg.get("rules") or [] if r.get("id")}
    cards = {p.stem for p in (SKILL_DIR / "rules" / "cards").glob("*.md")}
    if rule_ids != cards:
        only_reg = sorted(rule_ids - cards)[:5]
        only_cards = sorted(cards - rule_ids)[:5]
        return _fail(
            f"registry/card 不一致: rules={len(rule_ids)} cards={len(cards)} "
            f"only_reg={only_reg} only_cards={only_cards}"
        )

    sample_diff = """diff --git a/src/stdx/net/http/utils.cj b/src/stdx/net/http/utils.cj
--- a/src/stdx/net/http/utils.cj
+++ b/src/stdx/net/http/utils.cj
@@ -541,6 +541,8 @@
 private func isValidContentLengthFormat(s: String): Bool {
+    if (s[0] < b'1') { return false }
+    return true
 }
diff --git a/stdlib/libs/std/sync/semaphore.cj b/stdlib/libs/std/sync/semaphore.cj
--- a/stdlib/libs/std/sync/semaphore.cj
+++ b/stdlib/libs/std/sync/semaphore.cj
@@ -94,8 +94,8 @@
-            for (_ in 0..amount) {
+            for (_ in 0..newValue) {
                 monitor.notify()
             }
"""
    with tempfile.TemporaryDirectory(prefix="skill_validate_") as tmp:
        work = Path(tmp)
        sample_path = work / "review.diff"
        sample_path.write_text(sample_diff, encoding="utf-8")
        out_md = work / "selected_rules.md"
        cmd = [
            sys.executable,
            str(SCRIPTS / "select_rules.py"),
            "--diff-file",
            str(sample_path),
            "--changed-files",
            "src/stdx/net/http/utils.cj,stdlib/libs/std/sync/semaphore.cj",
            "--work-dir",
            str(work),
            "--max-rules",
            "40",
        ]
        p = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            cwd=str(work),
        )
        if p.returncode != 0:
            return _fail(f"select_rules 自检失败: {p.stderr or p.stdout}")
        if not out_md.exists():
            return _fail(f"selected_rules 未生成: {out_md}")
        md = out_md.read_text(encoding="utf-8")
    hits = (
        "style-uncategorized-a43193a05d51",
        "style-formatting-0506a640d9f4",
        "style-uncategorized-6d987850e488",
        "Content-Length",
    )
    if not any(h in md for h in hits):
        return _fail("select_rules 未路由到 demo 相关规则（Content-Length / Semaphore）")

    issues = {
        "summary": "bundle validate",
        "issues": [
            {
                "rule_id": "style-formatting-0506a640d9f4",
                "file": "src/stdx/net/http/utils.cj",
                "line": "541",
                "problem": "validate dry-run",
                "severity": "低",
            }
        ],
    }
    issues_path = SKILL_DIR / "_validate_issues.json"
    issues_path.write_text(json.dumps(issues, ensure_ascii=False), encoding="utf-8")
    rep = subprocess.run(
        [sys.executable, str(SCRIPTS / "report_issues.py"), str(issues_path), "--dry-run"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    issues_path.unlink(missing_ok=True)
    if rep.returncode != 0:
        return _fail(f"report_issues dry-run 失败: {rep.stderr or rep.stdout}")

    print(f"[OK] Skill 包完整: rules={len(rule_ids)} scripts={len(REQUIRED_SCRIPTS)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
