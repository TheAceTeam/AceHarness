# ACEHarness 发行流程

本文面向 ACEHarness 维护者，固化从 GitCode tag 构建 npm 包、执行发布门禁、更新 npm dist-tag、创建 GitCode Release 和回读验证的完整流程。

正式发布统一使用 `npm run release:tag`。不要直接运行 `npm publish` 或 `npm run publish:beta` 代替正式流程，因为它们不会完成 tag 一致性检查、完整测试、包内容检查、GitCode Release 创建和发布后验证。

## 发布前提

- 目标 tag 已推送到 `Cangjie-SIG/ACEHarness`。
- tag、tag 内 `package.json` 和 `package-lock.json` 的版本完全一致，例如都为 `1.0.0-rc.13`。
- 本机满足目标版本声明的 Node.js/npm 版本，并已安装 `git`、`gc`、Python 3 和 `tar`。
- `gc` 已登录 GitCode。
- npm 和 GitCode 密钥只通过环境变量提供，不写入仓库或命令行参数。

建议使用新生成并按最小权限配置的 npm granular token。密钥一旦出现在聊天、终端历史或日志中，应立即轮换。

```bash
# 输入时终端不回显；不要把真实值写进文档或提交。
read -s ACE_NPM_TOKEN
export ACE_NPM_TOKEN

read -s gitcode_token
export gitcode_token
```

Power GitCode 同时支持 `gitcode_password`。如果已经配置该变量，无需再设置 `gitcode_token`。

## 标准操作

先执行无外部写入的完整预演：

```bash
npm run release:tag -- 1.0.0-rc.13 --dry-run
```

预演会拉取并检查远端 tag，在临时 worktree 中完成以下门禁：

1. 校验 tag 与两个 npm manifest 的版本。
2. 查询 npm 版本与 GitCode Release，识别全新发布或可恢复的部分发布。
3. 使用 `npm ci --engine-strict` 安装锁定依赖。
4. 执行 TypeScript、ESLint 和完整 Vitest 测试。
5. 执行 `npm pack`，即通过 `prepack` 构建正式发布内容。
6. 校验包名、版本、CLI 入口、归档路径和敏感文件名，并计算 SHA-1/SHA-256。
7. 清理临时 worktree、依赖、构建产物和日志。

预演通过后执行正式发布：

```bash
npm run release:tag -- 1.0.0-rc.13
```

脚本会展示 tag、commit 和外部状态，并要求再次输入完整 tag。已经获得明确发布授权的自动化任务可以使用 `--yes`：

```bash
npm run release:tag -- 1.0.0-rc.13 --yes
```

正式发布按固定顺序执行：

1. 发布经过验证的同一份 npm tarball。
2. 将 `latest`、`beta`、`release` 同步到目标版本。
3. 使用 Power GitCode 为既有 tag 创建 Release。
4. 回读 npm 版本、三个 dist-tag、包校验值和 GitCode Release 目标 commit。
5. 无论成功或失败，都删除临时 npm 凭据文件和临时 worktree。

## 发行说明

默认发行说明取上一 npm `release` 版本对应 Git tag 到目标 tag 之间的非合并提交，并自动追加安装命令、发布门禁和目标 commit。

需要人工整理亮点时，提供只包含 Markdown 正文的文件：

```bash
npm run release:tag -- 1.0.0-rc.13 --notes-file ./release-notes.md
```

脚本会把该文件放入“版本亮点”一节，其余安装和验证信息仍自动生成。正式执行时可以同时加 `--yes`。

## 断点恢复与失败边界

脚本可以安全重跑同一 tag：

- npm 已发布、GitCode Release 未创建：重新构建 tag tarball；优先比较精确 SHA-1，因归档元数据或 TanStack manifest chunk 的构建目录与等价 hash 文件名导致 SHA 不同时再下载已发布包。脚本只规范化该 manifest 中的临时 worktree 前缀、生成文件名及其引用，其余路径、执行位和文件内容必须完全一致，才继续修复 dist-tag 并创建 Release。
- npm 与 GitCode Release 都已存在：校验包哈希或解包内容指纹以及 Release 目标 commit，一致时跳过重复创建并完成回读。
- npm 已有同版本且解包内容指纹不同：立即停止，不更新 dist-tag，不创建 Release，并列出首批差异路径。
- GitCode Release 已存在但 npm 版本不存在：立即停止，要求先人工核对不一致的外部状态。
- Release 指向错误 commit：立即停止，不自动改写既有 Release。

如果进程被强制终止并遗留 worktree，可先检查再清理：

```bash
git worktree list
git worktree prune
```

不要删除列表中不属于本次发布的 worktree。

## 降低自动化开销

下次只需提供目标 tag，并说明“按仓库固化发布流程执行”。自动化应直接调用：

```bash
npm run release:tag -- <tag> --yes
```

脚本会把完整命令输出写入临时日志，成功时只显示摘要，失败时显示日志尾部，从而减少无效输出和重复诊断。完整测试与发布后回读不会为了节省时间而跳过。

依赖下载缓存默认复用系统临时目录中的 `aceharness-release-npm-cache`，不包含 npm 凭据；可以通过 `ACE_RELEASE_NPM_CACHE` 指定其他缓存目录。包含密钥的临时 npm 配置仍会在每次运行结束时删除。
