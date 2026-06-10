"""校验黄军 Skill 包完整性（可独立运行、打包前自检）。"""
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
SCRIPTS = SKILL_DIR / "scripts"

REQUIRED = [
    "SKILL.md",
    "judge_prompt.md",
    "judge-examples.md",
    "requirements.txt",
    "rules_registry.json",
    "rules.md",
    "checkpoint_rules.json",
    "rules/search_index.json",
    "templates/feedbacks.template.json",
]

REQUIRED_SCRIPTS = [
    "prepare_judge_context.py",
    "report_feedback.py",
    "report_feedback.ps1",
    "validate_skill_bundle.py",
]

FORBIDDEN_SCRIPTS = ["prepare_context.py", "run_judge.py", "load_context.py"]


def _fail(msg: str) -> int:
    print(f"[FAIL] {msg}", file=sys.stderr)
    return 1


def main() -> int:
    missing = [p for p in REQUIRED if not (SKILL_DIR / p).exists()]
    missing += [f"scripts/{p}" for p in REQUIRED_SCRIPTS if not (SCRIPTS / p).exists()]

    stale = [p for p in FORBIDDEN_SCRIPTS if (SCRIPTS / p).exists()]
    if stale:
        return _fail("应移除已废弃脚本: " + ", ".join(stale))

    cards_dir = SKILL_DIR / "rules" / "cards"
    if not cards_dir.is_dir():
        missing.append("rules/cards/")
    else:
        n_cards = len(list(cards_dir.glob("*.md")))
        if n_cards < 1:
            missing.append("rules/cards/*.md")

    if missing:
        return _fail("缺少: " + ", ".join(missing))

    reg = json.loads((SKILL_DIR / "rules_registry.json").read_text(encoding="utf-8"))
    rule_ids = {r["id"] for r in reg.get("rules", []) if r.get("id")}
    cards = {p.stem for p in cards_dir.glob("*.md")}
    if rule_ids != cards:
        return _fail(
            f"registry/card 不一致: rules={len(rule_ids)} cards={len(cards)} "
            f"only_reg={sorted(rule_ids - cards)[:3]} only_cards={sorted(cards - rule_ids)[:3]}"
        )

    proc = subprocess.run(
        [sys.executable, str(SCRIPTS / "report_feedback.py"), "--help"],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        return _fail("report_feedback.py --help 失败")

    prep = subprocess.run(
        [sys.executable, str(SCRIPTS / "prepare_judge_context.py"), "--help"],
        capture_output=True,
        text=True,
    )
    if prep.returncode != 0:
        return _fail("prepare_judge_context.py --help 失败")

    prep = subprocess.run(
        [sys.executable, str(SCRIPTS / "prepare_judge_context.py"), "--help"],
        capture_output=True,
        text=True,
    )
    if prep.returncode != 0:
        return _fail("prepare_judge_context.py --help 失败")

    with tempfile.TemporaryDirectory(prefix="judge_skill_validate_") as tmp:
        tmp_path = Path(tmp)
        repo = tmp_path / "repo"
        review_tmp = repo / "review_tmp"
        review_tmp.mkdir(parents=True)
        (review_tmp / "issues.json").write_text(
            json.dumps(
                {
                    "summary": "自检",
                    "issues": [
                        {
                            "rule_id": next(iter(rule_ids)),
                            "file": "src/a.cj",
                            "line": "1",
                            "problem": "自检 issue",
                        }
                    ],
                },
                ensure_ascii=False,
            ),
            encoding="utf-8",
        )
        outputs_dir = tmp_path / "runs" / "run1" / "outputs"
        outputs_dir.mkdir(parents=True)
        blue_out = outputs_dir / "实施-代码审查.md"
        blue_out.write_text(
            '<step-conclusion>\n蓝军自检\n</step-conclusion>\n',
            encoding="utf-8",
        )
        ctx_path = tmp_path / "judge_tmp" / "judge_context.json"
        prep_run = subprocess.run(
            [
                sys.executable,
                str(SCRIPTS / "prepare_judge_context.py"),
                "--repo",
                str(repo),
                "--run-outputs-dir",
                str(outputs_dir),
                "--blue-step-substring",
                "审查",
                "--work-dir",
                str(ctx_path.parent),
            ],
            capture_output=True,
            text=True,
        )
        if prep_run.returncode != 0:
            return _fail(f"prepare_judge_context.py 自检失败: {prep_run.stderr}")
        if not ctx_path.is_file():
            return _fail("prepare_judge_context.py 未写出 judge_context.json")
        ctx = json.loads(ctx_path.read_text(encoding="utf-8"))
        if not ctx.get("issues"):
            return _fail("prepare_judge_context.py 未解析出 issues")

        fb_path = tmp_path / "feedbacks.json"
        sample = {
            "summary": "自检",
            "feedbacks": [
                {
                    "rule_ids": [next(iter(rule_ids))],
                    "content": "判定：自检。规则修改：无。",
                    "agent": True,
                }
            ],
        }
        before = json.dumps(sample, ensure_ascii=False, indent=2)
        fb_path.write_text(before, encoding="utf-8")

        sys.path.insert(0, str(SCRIPTS))
        from report_feedback import load_valid_rule_ids, refresh_feedbacks_file, validate_feedback  # noqa: E402

        err = validate_feedback(
            sample["feedbacks"][0],
            load_valid_rule_ids(),
            require_rule_ids=False,
        )
        if err:
            return _fail(f"report_feedback 校验失败: {err}")

        if json.loads(fb_path.read_text(encoding="utf-8")) != json.loads(before):
            return _fail("校验阶段不应修改 feedbacks.json")

        refresh_feedbacks_file(
            fb_path,
            pending=[],
            reported_count=1,
        )
        cleared = json.loads(fb_path.read_text(encoding="utf-8"))
        if cleared.get("feedbacks"):
            return _fail("上报成功后 feedbacks.json 应被清空")

    print(f"[OK] pr-rule-feedback 可独立运行（{len(rule_ids)} 条规则，{len(cards)} 张卡片）")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
