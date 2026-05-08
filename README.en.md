<div align="center">

# ACE Harness (Agent Centric Engineering Harness)

English | [中文](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/README.md)

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png">
    <img src="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png" alt="ACEHarness" width="300">
</picture>

***Built by the Cangjie Team***

***An enterprise-grade AI multi-agent collaboration system powered by state machines / Supervisor routing / adversarial iteration / conversational creation***

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-Apache--2.0%20with%20Runtime%20Library%20Exception-blue.svg)

Your team of AIs, collaborating to get work done.

ACEHarness is a local AI Multi-Agent workbench for engineering tasks. It combines conversational creation, state-machine workflows, adversarial review, Supervisor routing, run history, and cost tracking so complex development work can be decomposed, executed, resumed, reviewed, and replayed.

![ACEHarness product overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/readme.en.png)

<p><strong>Core Capability Highlights</strong></p>
<p>From the product overview into daily work, these six modules form the ACEHarness engineering task loop.</p>

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/features-overview.en.svg">
    <img src="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/features-overview.en.svg" alt="ACEHarness">
</picture>

</div>

---

## Table of Contents

- [Quick Start](#quick-start)
- [Core Mechanisms](#core-mechanisms)
- [Architecture](#architecture)
- [Functional Modules](#functional-modules)
- [Workflow Cases](#workflow-cases)
- [Configuration and Engines](#configuration-and-engines)
- [Documentation](#documentation)
- [Developer Reference](#developer-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Quick Start

### Requirements

- Node.js `>= 20` / npm `>= 9`
- One AI execution engine: `claude-code`, `kiro-cli`, `opencode`, `nga`, `codegenie`, `cursor`, `codex`, `trae-cli`, or `cangjie-magic`

### Install and Run

Get started quickly:

```bash
npm install -g @cangjielang/aceharness

ace --help
ace
# ✔ Please select a language › English
# [ACE] Welcome. First launch will initialize local runtime settings.
# ...
# [ACE] Starting server: http://127.0.0.1:3000
# [ACEHarness] Server ready on http://0.0.0.0:3000
# [ACE] Open http://127.0.0.1:3000 in your browser
```

If you are a developer:

```bash
git clone https://gitcode.com/Cangjie-SIG/ACEHarness.git && cd ACEHarness

# Install dependencies
npm install

# Local development: builds the CLI first, then starts the dev server
ACE_HOST=0.0.0.0 ACE_PORT=3000 npm run dev

# Windows PowerShell:
# $env:ACE_HOST="0.0.0.0"
# $env:ACE_PORT="3000"
# npm run dev

# Production mode: build after the first clone or after updates
npm run build
ACE_HOST=0.0.0.0 ACE_PORT=3000 npm start
```

Open `http://127.0.0.1:3000` after startup. After entering the console, use Onboarding to learn the complete usage path and module guide. In PowerShell production mode, set `$env:ACE_HOST` and `$env:ACE_PORT` before running `npm start`.

---

## Core Mechanisms

![Core mechanisms overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/core-mechanisms-overview.en.svg)

ACEHarness is not just a chain of agents. It organizes engineering work into a loop that can be planned, rolled back, reviewed, resumed, observed, and reused:

- **Creation and planning**: create workflows from home chat or manual forms; Spec Coding turns the request into `requirements.md`, `design.md`, and `tasks.md`, then binds workflow steps to tasks before execution.
- **Execution and collaboration**: the state machine decides whether to continue, roll back, or pause at a human checkpoint; Supervisor routes missing context when agents need help.
- **Review and recovery**: Defender, Attacker, and Judge form an adversarial review loop; failed, restarted, or interrupted runs can resume from persisted records.
- **Observability and memory**: the workbench shows streams, state graphs, logs, cost, and prompt analysis; outputs can flow into Workspace, Notebook, Skills, or persistent Spec.

---

## Architecture

![System architecture SVG](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/system-architecture.en.svg)

Notes:
- Real-time communication uses SSE to push execution status to the frontend
- Persistent data is stored under `runs/{runId}/`, including state, output, and streamed content

## Functional Modules

![Interface overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/product-interface-overview.en.svg)

Screenshots: [Chat](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/chat.png) · [Dashboard](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/dashboard.png) · [Workbench design](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workbench-design.png) · [Workbench history](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workbench-history.png) · [Workflow management](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflows.png)

## Workflow Cases

![Workflow cases overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-cases-overview.en.svg)

Read the root-cause paths, execution data, and delivery results for all four cases in [Workflow Cases](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/workflow-cases.en.md).

## Configuration and Engines

### Environment Variables (`.env.local`)

Copy `.env.example` to `.env.local` and fill in real values. The table below lists variables that already exist in the example file.

| Variable | Description | Required |
|------|------|------|
| `ANTHROPIC_API_KEY` | Anthropic API key | Yes |
| `ANTHROPIC_BASE_URL` | Custom API endpoint (proxy or self-hosted gateway) | No |
| `ANTHROPIC_TIMEOUT` | Claude CLI request timeout in milliseconds | No |
| `OPENAI_API_KEY` | OpenAI API key | No |
| `OPENAI_BASE_URL` | OpenAI-compatible API endpoint | No |
| `NEXT_PUBLIC_API_BASE` | Backend address when frontend and backend are separated | No |

`server.js` also supports these runtime variables from the shell, process manager, or startup script:

| Variable | Description | Default |
|------|-------------|---------|
| `ACE_HOST` | Server bind address | `127.0.0.1` |
| `ACE_PORT` | ACEHarness service port | `3000` |
| `PORT` | Generic service port, with higher priority than `ACE_PORT` | unset |

### Execution Engine (`.engine.json`)

```json
{ "engine": "claude-code" }
```

Supported execution engines include `claude-code`, `kiro-cli`, `opencode`, `nga`, `codegenie`, `cursor` (Cursor CLI), `codex`, `trae-cli`, and `cangjie-magic` (CangjieMagic).

Child processes inherit `process.env`, so no extra setup is required. To switch engines, simply change the active CLI tool on the engine page.

---

## Documentation

- [Workflow Cases](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/workflow-cases.en.md): full retrospectives for the four workflow cases
- [ACP Code Agent integration checklist](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/acp-code-agent-integration-checklist.md): reference checklist for ACP Code Agent integration and validation

---

## Developer Reference

### Project Structure

| Path | Description |
|------|-------------|
| `bin/` | npm CLI entry; the `ace` command loads built `dist/cli.js` |
| `server.js` | Custom Next.js launcher for `.env*` loading, HTTP service startup, and Notebook collaboration WebSocket |
| `src/app/` | Next.js App Router pages and API routes |
| `src/components/` | Frontend components for workbench, chat, Notebook, workspace, and related views |
| `src/lib/` | Core workflow engine, Spec Coding, auth, run records, scheduling, models, and workspace logic |
| `configs/` | Workflow configuration and built-in agent/role configuration |
| `skills/` | Skills distributed with the package |
| `messages/` | Chinese and English UI messages |
| `public/` | Images used by the README and frontend |
| `tests/` | Vitest test cases |

### Common Commands

Commands come from `package.json`.

```bash
npm run dev              # Local development, builds the CLI first and starts dev mode
npm run build            # Build the CLI and Next.js app
npm start                # Start the production build
npm test                 # Run Vitest tests
npm run test:components  # Run component tests in jsdom
npm run lint             # Run Next.js lint
npm run check:engines    # Check available local AI execution engines
npm run clean            # Remove dist, .next, and dist-build
npm run publish:beta     # Build and publish the npm package with the beta tag
```

CLI commands come from `src/cli.ts`.

```bash
ace                # Start ACEHarness
ace start          # Start ACEHarness
ace reset --force  # Reset local ACE configuration
ace --help         # Show help
```

### Testing and Quality

The test framework is Vitest. `vitest.config.ts` matches `tests/**/*.test.ts` and `tests/**/*.test.tsx` by default.

```bash
npm test
npm run test:components
npm run lint
```

### Tech Stack

| Category | Technology |
|------|------|
| App framework | Next.js 16.1, React 18.2, TypeScript 5 |
| UI and interaction | Tailwind CSS 3.4, Shadcn/ui, Radix UI, Base UI, Framer Motion, Vaul |
| Editing and collaboration | Tiptap 3, Yjs, y-websocket, Monaco Editor |
| Workflow and configuration | Zod 4, YAML, node-cron, tar-stream, unzipper, yazl |
| Visualization | ReactFlow 11, Recharts 3, Mermaid 11 |
| Forms and drag-and-drop | React Hook Form 7, @dnd-kit |
| Markdown and docs | react-markdown, remark-gfm, rehype-raw, react-syntax-highlighter, KaTeX |
| AI SDKs and execution backends | Anthropic Claude Agent SDK, OpenAI Codex SDK, `claude-code` / `kiro-cli` / `opencode` / `nga` / `codegenie` / `cursor` / `codex` / `trae-cli` / `cangjie-magic` |
| Testing | Vitest 4, Testing Library, jsdom |
| Internationalization and themes | next-intl 4, next-themes |

### Documentation Maintenance

Update this README when any of the following changes:

- `package.json` scripts, `bin`, `files`, or publishing flow
- environment variables in `.env.example`
- `src/app/` page entries, API categories, or major user flows
- workflow, Spec Coding, engine, auth, Notebook, or other core mechanisms in `src/lib/`
- built-in agents, configs, or Skills
- release version, license wording, or repository URLs

---

## Contributing

This README keeps a simplified contribution flow. If the repository later adds a dedicated `CONTRIBUTING.md`, this section should link to the formal guide.

```bash
# Fork → create a branch → commit → PR
git checkout -b feature/your-feature
git commit -m "feat: add new feature"
git push origin feature/your-feature
```

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/): `feat` / `fix` / `docs` / `perf` / `refactor` / `test` / `chore`

---

## License

ACEHarness is licensed under Apache-2.0 with Runtime Library Exception. See [LICENSE](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/LICENSE).
