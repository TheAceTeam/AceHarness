#!/usr/bin/env node
/**
 * check-batch-report.cjs
 *
 * 全并行运行 clarification-qa / spec-coding / workflow-creator 各 N 轮（共 3×N 并行），
 * 输出汇总表格 + 详细日志文件。
 */

const fs = require('fs');
const path = require('path');
const { parseCommonArgs, printCommonHelp, runCheckSuite } = require('./check-wrapper-runner.cjs');

const checks = [
  { name: 'clarification-qa', get definition() { return require('./check-clarification-qa.cjs').definition; } },
  { name: 'spec-coding', get definition() { return require('./check-spec-coding.cjs').definition; } },
  { name: 'workflow-creator', get definition() { return require('./check-workflow-creator.cjs').definition; } },
];

function formatDuration(ms) {
  if (!Number.isFinite(ms)) return '-';
  return `${(ms / 1000).toFixed(1)}s`;
}

function aggregateRuns(name, runs, engine, driver, model) {
  const firstAttemptPassed = runs.filter((r) => r.firstAttemptOk).length;
  return {
    name,
    summary: {
      ok: runs.every((r) => r.ok),
      passed: runs.filter((r) => r.ok).length,
      firstAttemptPassed,
      firstAttemptPassRate: runs.length ? firstAttemptPassed / runs.length : 0,
      total: runs.length,
      passRate: runs.length ? runs.filter((r) => r.ok).length / runs.length : 0,
      engine,
      driver,
      model,
      runs,
    },
  };
}

function printTable(results) {
  const headers = ['阶段', '首次通过', '首次通过率', '最终通过', '最终通过率', '平均耗时'];
  const rows = results.map((r) => {
    const avgMs = r.summary.runs.length
      ? r.summary.runs.reduce((sum, run) => sum + (run.durationMs || 0), 0) / r.summary.runs.length
      : 0;
    return [
      r.name,
      `${r.summary.firstAttemptPassed}/${r.summary.total}`,
      `${(r.summary.firstAttemptPassRate * 100).toFixed(0)}%`,
      `${r.summary.passed}/${r.summary.total}`,
      `${(r.summary.passRate * 100).toFixed(0)}%`,
      formatDuration(avgMs),
    ];
  });

  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cells) => `| ${cells.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;

  console.log(line(headers));
  console.log(sep);
  for (const row of rows) console.log(line(row));
}

function printRunDetails(results) {
  for (const r of results) {
    console.log(`\n--- ${r.name} 详细 ---`);
    for (const run of r.summary.runs) {
      const label = run.ok ? 'PASS' : 'FAIL';
      const firstLabel = run.firstAttemptOk ? '1st' : (run.ok ? 'retry' : 'fail');
      console.log(`  Run ${run.run}: ${label} (${firstLabel}) ${formatDuration(run.durationMs)} session=${run.sessionId || '-'}`);
      for (const a of (run.attempts || [])) {
        const stageTag = a.stage === 'success' ? 'OK' : a.stage.replace('_error', '').toUpperCase();
        console.log(`    attempt ${a.attempt}: [${stageTag}] ${formatDuration(a.durationMs)} output=${a.output.length}chars`);
        if (a.error) console.log(`      error: ${String(a.error).slice(0, 200)}`);
        if (a.validationErrors?.length) {
          for (const e of a.validationErrors.slice(0, 5)) console.log(`      - ${e}`);
          if (a.validationErrors.length > 5) console.log(`      ... +${a.validationErrors.length - 5} more`);
        }
      }
    }
  }
}

function saveDetailedLogs(results, logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  for (const r of results) {
    const logPath = path.join(logDir, `${r.name}.json`);
    fs.writeFileSync(logPath, JSON.stringify({
      name: r.name,
      engine: r.summary.engine,
      driver: r.summary.driver,
      model: r.summary.model,
      total: r.summary.total,
      passed: r.summary.passed,
      passRate: r.summary.passRate,
      firstAttemptPassed: r.summary.firstAttemptPassed,
      firstAttemptPassRate: r.summary.firstAttemptPassRate,
      runs: r.summary.runs.map((run) => ({
        run: run.run,
        ok: run.ok,
        firstAttemptOk: run.firstAttemptOk,
        durationMs: run.durationMs,
        sessionId: run.sessionId,
        error: run.error,
        validationErrors: run.validationErrors,
        attempts: (run.attempts || []).map((a) => ({
          attempt: a.attempt,
          prompt: a.prompt,
          output: a.output,
          durationMs: a.durationMs,
          stage: a.stage,
          error: a.error,
          validationErrors: a.validationErrors,
        })),
      })),
    }, null, 2));
  }
  const summaryPath = path.join(logDir, 'summary.json');
  fs.writeFileSync(summaryPath, JSON.stringify(
    results.map((r) => ({
      name: r.name,
      total: r.summary.total,
      passed: r.summary.passed,
      passRate: r.summary.passRate,
      firstAttemptPassed: r.summary.firstAttemptPassed,
      firstAttemptPassRate: r.summary.firstAttemptPassRate,
    })),
    null, 2,
  ));
}

async function runWithConcurrencyLimit(tasks, limit) {
  const results = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, () => worker()));
  return results;
}

async function runSingleCheck(definition, options, runIndex) {
  const singleRunOptions = { ...options, runs: 1 };
  const result = await runCheckSuite(definition, singleRunOptions);
  const run = result.runs[0];
  if (run) run.run = runIndex + 1;
  return run;
}

async function main() {
  const options = parseCommonArgs(process.argv.slice(2), {
    engine: 'opencode',
    driver: 'sdk',
    model: 'glm-4.7',
    timeoutMs: 180_000,
    runs: 10,
  });

  if (options.help) {
    printCommonHelp('check:batch-report', '\n全并行运行 clarification-qa / spec-coding / workflow-creator 各 N 轮（共 3×N 并行）。\n\n示例:\n  npm run check:batch-report -- --engine opencode --driver sdk --model glm-4.7 --runs 10');
    process.exit(0);
  }

  const totalRuns = checks.length * options.runs;
  const concurrency = options.concurrency || 5;
  const totalStart = Date.now();
  console.log(`=== CSIHarness Check Batch Report (${options.engine}/${options.driver}, ${options.model}, ${options.runs} runs) ===\n`);
  console.log(`启动 ${totalRuns} 个任务 (${checks.length} checks × ${options.runs} runs)，并发=${concurrency}...\n`);

  const taskFns = [];
  for (const check of checks) {
    for (let i = 0; i < options.runs; i++) {
      const runIndex = i;
      taskFns.push(async () => {
        const run = await runSingleCheck(check.definition, options, runIndex);
        const label = run?.ok ? 'PASS' : 'FAIL';
        completed++;
        console.log(`[${completed}/${totalRuns}] ${check.name} #${runIndex + 1}: ${label} (${formatDuration(run?.durationMs)})`);
        return { name: check.name, run };
      });
    }
  }

  let completed = 0;
  const taskResults = await runWithConcurrencyLimit(taskFns, concurrency);

  const grouped = {};
  for (const check of checks) grouped[check.name] = [];
  for (const { name, run } of taskResults) {
    if (run) grouped[name].push(run);
  }

  const model = options.model;
  const results = checks.map((check) =>
    aggregateRuns(check.name, grouped[check.name], options.engine, options.driver, model),
  );

  const totalMs = Date.now() - totalStart;
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const logDir = path.join(__dirname, '.check-batch-logs', timestamp);
  saveDetailedLogs(results, logDir);

  console.log(`\n=== 汇总 (${formatDuration(totalMs)}) ===\n`);
  printTable(results);
  printRunDetails(results);
  console.log(`\n详细日志: ${logDir}`);

  if (options.json) {
    const jsonPath = path.join(logDir, 'full-report.json');
    fs.writeFileSync(jsonPath, JSON.stringify({ totalMs, results: results.map((r) => ({ name: r.name, ...r.summary })) }, null, 2));
    console.log(`JSON 报告: ${jsonPath}`);
  }

  const allOk = results.every((r) => r.summary.ok);
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
