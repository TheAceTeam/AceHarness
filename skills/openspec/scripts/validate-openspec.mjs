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
  requirePattern(content, /^## Technical Approach$/m, file, '缺少 `## Technical Approach`');
  requirePattern(content, /^## Key Decisions$/m, file, '缺少 `## Key Decisions`');
  requirePattern(content, /^## Affected Areas$/m, file, '缺少 `## Affected Areas`');
  requirePattern(content, /^## Risks And Tradeoffs$/m, file, '缺少 `## Risks And Tradeoffs`');
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
