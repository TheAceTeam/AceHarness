#!/usr/bin/env node

const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { parseCommonArgs, printCommonHelp } = require('./check-wrapper-runner.cjs');

function buildArgs(options) {
  const args = [];
  if (options.engine) args.push('--engine', options.engine);
  if (options.driver) args.push('--driver', options.driver);
  if (options.model) args.push('--model', options.model);
  if (options.cwd) args.push('--cwd', options.cwd);
  if (options.timeoutMs) args.push('--timeout-ms', String(options.timeoutMs));
  if (options.runs) args.push('--runs', String(options.runs));
  if (options.json) args.push('--json');
  return args;
}

function runScript(scriptName, options) {
  const scriptPath = path.join(__dirname, scriptName);
  return spawnSync(process.execPath, [scriptPath, ...buildArgs(options)], {
    cwd: path.resolve(__dirname, '..'),
    stdio: 'inherit',
    env: process.env,
  });
}

function main() {
  const options = parseCommonArgs(process.argv.slice(2), {
    engine: 'opencode',
    driver: 'sdk',
    model: 'glm-4.7',
    timeoutMs: 180_000,
    runs: 1,
  });

  if (options.help) {
    printCommonHelp('check:spec-then-workflow', '\n示例:\n  npm run check:spec-then-workflow -- --engine opencode --driver sdk --model glm-4.7 --runs 3');
    process.exit(0);
  }

  const clarificationResult = runScript('check-clarification-qa.cjs', options);
  if (clarificationResult.status !== 0) {
    process.exit(clarificationResult.status || 1);
  }

  const specResult = runScript('check-spec-coding.cjs', options);
  if (specResult.status !== 0) {
    process.exit(specResult.status || 1);
  }

  const workflowResult = runScript('check-workflow-creator.cjs', options);
  process.exit(workflowResult.status || 0);
}

main();
