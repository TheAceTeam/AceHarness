#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { resolve, basename, join } from 'path';

function fail(message) {
  console.error(`OpenSpec 校验失败: ${message}`);
  process.exitCode = 1;
}

function info(message) {
  console.log(`OpenSpec: ${message}`);
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function read(path) {
  return readFileSync(path, 'utf-8');
}

function listDirs(path) {
  if (!isDirectory(path)) return [];
  return readdirSync(path, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function requirePattern(content, pattern, file, message) {
  if (!pattern.test(content)) {
    fail(`${file}: ${message}`);
  }
}

function extractTaskEntries(content) {
  const lines = content.split(/\r?\n/);
  const tasks = [];

  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^-\s\[( |x)\]\s(\d+\.\d+)\s+(.+)$/);
    if (!match) continue;

    const details = [];
    for (let j = i + 1; j < lines.length; j += 1) {
      const line = lines[j];
      if (/^##\s+/.test(line) || /^-\s\[( |x)\]\s/.test(line)) break;
      if (/^\s{2,}-\s+/.test(line) || /^\s{2,}\S/.test(line)) {
        details.push(line.trim());
      }
    }

    tasks.push({
      id: match[2],
      title: match[3].trim(),
      details,
    });
  }

  return tasks;
}

function countTasksContaining(tasks, matcher) {
  return tasks.filter((task) => matcher(task)).length;
}

function validateMainSpec(file) {
  if (!isFile(file)) {
    fail(`${file}: 缺少 spec.md`);
    return;
  }
  const content = read(file);
  requirePattern(content, /^# .+规范/m, file, '必须以一级标题“<领域名>规范”开头');
  requirePattern(content, /^## 目的$/m, file, '缺少 `## 目的`');
  requirePattern(content, /^## 需求$/m, file, '缺少 `## 需求`');
  requirePattern(content, /^### 需求:.+/m, file, '至少需要一个 `### 需求:`');
  requirePattern(content, /^#### 场景:.+/m, file, '至少需要一个 `#### 场景:`');
}

function validateDeltaSpec(file) {
  if (!isFile(file)) {
    fail(`${file}: 缺少增量 spec.md`);
    return;
  }
  const content = read(file);
  requirePattern(content, /^# .+增量规范/m, file, '必须以一级标题“<领域名>增量规范”开头');
  requirePattern(content, /^## (新增需求|修改需求|删除需求)$/m, file, '缺少增量节标题（新增需求/修改需求/删除需求）');
  requirePattern(content, /^### 需求:.+/m, file, '至少需要一个 `### 需求:`');
  requirePattern(content, /^#### 场景:.+/m, file, '至少需要一个 `#### 场景:`');
}

function validateProposal(file) {
  if (!isFile(file)) {
    fail(`${file}: 缺少 proposal.md`);
    return;
  }
  const content = read(file);
  requirePattern(content, /^# Proposal: .+/m, file, '必须以 `# Proposal: <change-id>` 开头');
  requirePattern(content, /^## Intent$/m, file, '缺少 `## Intent`');
  requirePattern(content, /^## Scope$/m, file, '缺少 `## Scope`');
  requirePattern(content, /^Includes:$/m, file, '缺少 `Includes:`');
  requirePattern(content, /^Excludes:$/m, file, '缺少 `Excludes:`');
  requirePattern(content, /^## Approach$/m, file, '缺少 `## Approach`');
}

function validateDesign(file) {
  if (!isFile(file)) {
    fail(`${file}: 缺少 design.md`);
    return;
  }
  const content = read(file);
  requirePattern(content, /^# Design: .+/m, file, '必须以 `# Design: <change-id>` 开头');
  requirePattern(content, /^## Overview$/m, file, '缺少 `## Overview`');
  requirePattern(content, /^## Technical Approach$/m, file, '缺少 `## Technical Approach`');
  requirePattern(content, /^## Architecture$/m, file, '缺少 `## Architecture`');
  requirePattern(content, /^## Data Flow$/m, file, '缺少 `## Data Flow`');
  requirePattern(content, /^## Core Logic Pseudocode$/m, file, '缺少 `## Core Logic Pseudocode`');
  requirePattern(content, /^## Data Models$/m, file, '缺少 `## Data Models`');
  requirePattern(content, /^## Interfaces And Contracts$/m, file, '缺少 `## Interfaces And Contracts`');
  requirePattern(content, /^## Assumptions And Unknowns$/m, file, '缺少 `## Assumptions And Unknowns`');
  requirePattern(content, /^## Key Decisions$/m, file, '缺少 `## Key Decisions`');
  requirePattern(content, /^## Affected Areas$/m, file, '缺少 `## Affected Areas`');
  requirePattern(content, /^## Risks And Tradeoffs$/m, file, '缺少 `## Risks And Tradeoffs`');

  const mermaidBlocks = content.match(/```mermaid[\s\S]*?```/g) || [];
  if (mermaidBlocks.length < 2) {
    fail(`${file}: 至少需要 2 个 Mermaid 图块，用于表达架构/执行链路和数据流`);
  }

  const pseudocodeBlock = content.match(/## Core Logic Pseudocode[\s\S]*?```(?:text|pseudo|plaintext)?[\s\S]*?```/m);
  if (!pseudocodeBlock) {
    fail(`${file}: ` + '必须在 `## Core Logic Pseudocode` 下提供伪代码代码块');
  }

  const placeholderPattern = /<[^>\n]+>/;
  if (placeholderPattern.test(content)) {
    fail(`${file}: 仍包含未替换的模板占位符，请补成真实节点、组件、字段或规则`);
  }

  const decisionCount = (content.match(/^### Decision: .+/gm) || []).length;
  if (decisionCount < 3) {
    fail(`${file}: 关键决策不足，至少需要 3 条 \`### Decision:\` 条目`);
  }
}

function validateTasks(file) {
  if (!isFile(file)) {
    fail(`${file}: 缺少 tasks.md`);
    return;
  }
  const content = read(file);
  requirePattern(content, /^# Tasks$/m, file, '必须以 `# Tasks` 开头');
  requirePattern(content, /^## \d+\.\s.+/m, file, '至少需要一个二级任务分组标题，如 `## 1. ...`');
  requirePattern(content, /^- \[( |x)\] \d+\.\d+\s.+/m, file, '至少需要一个复选框任务，如 `- [ ] 1.1 ...`');

  const tasks = extractTaskEntries(content);
  if (tasks.length < 3) {
    fail(`${file}: 任务数量过少，至少需要 3 个复选框任务，不能只有零散条目`);
  }

  const emptyDetailTasks = tasks.filter((task) => task.details.length === 0);
  if (emptyDetailTasks.length > 0) {
    fail(`${file}: 以下任务缺少展开说明，不能只写标题：${emptyDetailTasks.map((task) => task.id).join(', ')}`);
  }

  const tooThinTasks = tasks.filter((task) => task.details.length < 2);
  if (tooThinTasks.length > 0) {
    fail(`${file}: 以下任务说明过短，至少补充 2 行以上细节：${tooThinTasks.map((task) => task.id).join(', ')}`);
  }

  const placeholderPattern = /<[^>\n]+>/;
  const placeholderTasks = tasks.filter((task) =>
    placeholderPattern.test(task.title) || task.details.some((detail) => placeholderPattern.test(detail))
  );
  if (placeholderTasks.length > 0) {
    fail(`${file}: 以下任务仍包含未替换的模板占位符：${placeholderTasks.map((task) => task.id).join(', ')}`);
  }

  if (countTasksContaining(tasks, (task) => task.details.some((detail) => /^(验证方式|验收方式)：/.test(detail))) === 0) {
    fail(`${file}: 至少需要一个任务明确写出“验证方式”或“验收方式”`);
  }

  if (countTasksContaining(tasks, (task) => task.details.some((detail) => /^完成标准：/.test(detail))) === 0) {
    fail(`${file}: 至少需要一个任务明确写出“完成标准”`);
  }

  if (countTasksContaining(tasks, (task) => task.details.some((detail) => /^具体改动对象：/.test(detail))) === 0) {
    fail(`${file}: 至少需要一个任务明确写出“具体改动对象”，避免任务只有抽象描述`);
  }

  if (countTasksContaining(tasks, (task) => task.details.some((detail) => /^交付产物：/.test(detail))) === 0) {
    fail(`${file}: 至少需要一个任务明确写出“交付产物”`);
  }
}

function validateChange(changeDir, specsRoot) {
  const changeId = basename(changeDir);
  const proposal = join(changeDir, 'proposal.md');
  const design = join(changeDir, 'design.md');
  const tasks = join(changeDir, 'tasks.md');
  const changeSpecsRoot = join(changeDir, 'specs');

  validateProposal(proposal);
  validateDesign(design);
  validateTasks(tasks);

  if (!isDirectory(changeSpecsRoot)) {
    fail(`${changeDir}: 缺少 specs/ 目录`);
    return;
  }

  const domains = listDirs(changeSpecsRoot);
  if (domains.length === 0) {
    fail(`${changeDir}: specs/ 下至少需要一个 domain`);
    return;
  }

  for (const domain of domains) {
    const deltaSpec = join(changeSpecsRoot, domain, 'spec.md');
    validateDeltaSpec(deltaSpec);

    const mainSpec = join(specsRoot, domain, 'spec.md');
    if (!isFile(mainSpec)) {
      fail(`${changeId}: 引用了 domain \`${domain}\`，但主规范 ${mainSpec} 不存在`);
    }
  }
}

function validateRoot(rootDir) {
  const specsRoot = join(rootDir, 'specs');
  const changesRoot = join(rootDir, 'changes');

  if (!isDirectory(rootDir)) {
    fail(`根目录不存在: ${rootDir}`);
    return;
  }
  if (!isDirectory(specsRoot)) {
    fail(`${rootDir}: 缺少 specs/ 目录`);
    return;
  }
  if (!isDirectory(changesRoot)) {
    fail(`${rootDir}: 缺少 changes/ 目录`);
    return;
  }

  const mainDomains = listDirs(specsRoot);
  if (mainDomains.length === 0) {
    fail(`${specsRoot}: 至少需要一个 domain`);
  }
  for (const domain of mainDomains) {
    validateMainSpec(join(specsRoot, domain, 'spec.md'));
  }

  const changeDirs = listDirs(changesRoot);
  if (changeDirs.length === 0) {
    fail(`${changesRoot}: 至少需要一个 change 目录`);
  }
  for (const changeId of changeDirs) {
    validateChange(join(changesRoot, changeId), specsRoot);
  }
}

const input = process.argv[2];
if (!input) {
  console.error('用法: node validate-openspec.mjs <openspec-root>');
  process.exit(1);
}

const rootDir = resolve(input);
validateRoot(rootDir);

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

info(`校验通过: ${rootDir}`);
