<div align="center">

# ACE Harness (Agent Centric Engineering Harness)

English | [中文](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/README.md)

<picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png">
    <img src="https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/logo.png" alt="ACEHarness" width="300">
</picture>

***Built by the Cangjie Team***

***An enterprise-grade AI multi-agent collaboration system for Spec Driven Development / state-machine workflows / Supervisor routing / adversarial iteration / multi-agent Agora / long-term memory***

![Node.js](https://img.shields.io/badge/Node.js-20%2B-339933?logo=nodedotjs&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=nextdotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![License](https://img.shields.io/badge/License-Apache--2.0%20with%20Runtime%20Library%20Exception-blue.svg)

Your team of AIs, collaborating to get work done.

ACEHarness is a local AI Multi-Agent workbench for engineering tasks. It combines Spec Driven Development, state-machine workflows, Supervisor routing, adversarial iteration, multi-agent Agora rooms, Git-backed change checkpoints, layered long-term memory, Notebook knowledge capture, Skill-based extension, and model/engine diagnostics so complex development work can be planned, executed, collaborated on, reviewed, rolled back, resumed, and replayed.

![ACEHarness product overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/readme.en.png)

<p><strong>Core Capability Highlights</strong></p>
<p>From the product overview into daily work, ACEHarness organizes engineering tasks around planning, execution, collaboration, knowledge, extension, and external channels.</p>

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
- [Channel Integrations](#channel-integrations)
- [Documentation](#documentation)
- [Developer Reference](#developer-reference)
- [Contributing](#contributing)
- [License](#license)

---

## Quick Start

### Requirements

- Node.js `>= 20` / npm `>= 9`
- One AI execution engine: `claude-code`, `kiro-cli`, `opencode`, `nga`, `codegenie`, `cursor`, `codex`, `trae-cli`, or `magic-cli`

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

### Requirements and Plan Modeling

**Spec Driven Development mode**  
Start from requirement clarification, generate `requirements / design / tasks`, and bind them to workflow configuration and task execution so complex engineering work begins with a reviewable, traceable, and iterable plan.

### Workflow Orchestration and Execution Control

**Advanced state-machine transition strategies**  
Model engineering decisions with states, steps, conditions, and priorities, supporting rollback, retry, review, branching, and conditional transitions beyond a linear process.

**Concurrent state-machine steps**  
Run multiple steps or agent tasks in parallel within the same state for implementation, review, testing, and information gathering, then aggregate results in later states to decide the next transition.

**Supervisor routing**  
When agents need missing context or human input, the Supervisor identifies the request, routes it to the right agent or user, and brings the answer back into the current workflow.

**Adversarial iteration**  
Defender, Attacker, and Judge roles can form a red/blue review loop so plans, code, tests, and evidence are challenged and adjudicated before the workflow advances.

**Workflow Preflight checks**  
Run configured or automatically inferred quality checks before a workflow starts, catching environment, build, test, and dependency issues before the run proceeds.

**Human checkpoints with WeChat and email notification**  
Approvals, follow-up questions, risk confirmations, and key decisions can reach users through the page, WeChat, and email so long-running workflows pause and resume at the right moments.

**Git baseline and step-level change checkpoints**  
Create a Git-backed run baseline and record code-change snapshots per step, making AI edits observable, comparable, traceable, and rollback-ready.

### Multi-Agent Collaboration Spaces

**Workflow Agent Agora**  
Workflow runs can enter a multi-agent chat space where planning, disagreements, missing context, execution discussion, and retrospectives stay attached to the same topic.

**Topic-mode Agora**  
Standalone multi-agent topic rooms let teams use AI guests to discuss, compare approaches, make decisions, and collaborate outside a workflow run.

### Knowledge and Long-Term Context

**Layered persistent memory**  
Persist experience across role, project, workflow, and chat scopes, then recall relevant context in later runs to reduce repeated explanations and repeated mistakes.

**Cangjie Notebook collaborative documents**  
Use personal and team Notebook spaces to manage documents, notes, run outputs, and retrospectives with collaborative editing, snapshots, and sharing.

### Capability Extension and Model Governance

**Skill Marketplace integration**  
Install Skill packages from the marketplace, or import, export, and sync Skills so agents can use domain knowledge and specialized operating procedures in chat and workflows.

**Model and engine diagnostics workbench**  
Diagnose model, engine, SDK, ACP, and HTTP-driver behavior across connectivity, streaming events, structured output, coding, math, and reasoning to choose and troubleshoot execution backends.

### External Channel Access

**Chat mode binding for WeChat ClawBot sessions**  
Home chat can bind to an external WeChat session, bringing external messages into the same ACEHarness conversation context.

---

## Architecture

![System architecture SVG](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/system-architecture.en.svg)

Notes:
- Real-time communication uses SSE to push execution status to the frontend
- Persistent data is stored under `runs/{runId}/`, including state, output, and streamed content

## Functional Modules

![Interface overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/product-interface-overview.en.svg)

The ACEHarness interface is organized around daily engineering work:

- **Home chat**: regular AI conversations, workflow creation, Agora entry points, and WeChat ClawBot session binding.
- **Agora**: topic-based or workflow-bound multi-agent chat for design discussion, disagreement resolution, and retrospectives.
- **Workflow workbench**: state-machine execution, streamed step output, human checkpoints, Preflight results, Git step changes, and run recovery.
- **Workspace and Changes**: embedded file editing, directory browsing, Git diff, step-level change review, and baseline comparison.
- **Cangjie Notebook**: personal and team spaces for documents, notes, run outputs, and retrospectives with collaborative editing, snapshots, and sharing.
- **Model and engine diagnostics**: standard probes for model and execution-backend evaluation, including SDK, ACP, HTTP drivers, and streaming-event troubleshooting.

## Workflow Cases

![Workflow cases overview](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/workflow-cases-overview.en.svg)

Read the root-cause paths, execution data, and delivery results for all four cases in [Workflow Cases](https://gitcode.com/Cangjie-SIG/ACEHarness/blob/main/docs/workflow-cases.en.md).

## Configuration and Engines

## Channel Integrations

ACEHarness can bridge workflow runtime conversations, human checkpoints, and multi-agent Agora rooms to external chat platforms. Built-in provider templates include `Feishu`, `DingTalk`, `WeChat Bridge`, and `Generic Webhook`; `POST /api/channels/setup` can generate the webhook and shared secret, and external platforms or bridge services can deliver messages to `/api/channels/inbound/:integrationId`.

See [Channel Integrations](./docs/channel-integrations.md) for details.

### ACE Service

`server.js` loads `.env`, `.env.local`, and the mode-specific `.env.development*` / `.env.production*` files on startup. Values already present in the shell, process manager, or startup script take precedence and are not overwritten by env files.

Core startup and runtime-directory variables:

| Variable | Description | Default / precedence |
|------|-------------|----------------------|
| `ACE_HOST` | Server bind address | `127.0.0.1` |
| `ACE_PORT` | ACEHarness service port | `3000` |
| `PORT` | Generic service port | Higher priority than `ACE_PORT` |
| `ACE_HOME` | ACE runtime root; controls where `config/`, `data/`, `cache/`, `logs/`, and `workspace/` live | Falls back by platform when unset |
| `APPDATA` | Windows fallback root for `ACE_HOME` | `<APPDATA>/ACEHarness` |
| `XDG_DATA_HOME` | Linux / macOS fallback root for `ACE_HOME` | `<XDG_DATA_HOME>/aceharness` |
| `ACE_INSTALL_ROOT` | Install root used to locate `server.js`, `configs/`, `dist/`, and other packaged files | Auto-filled to the current install directory when unset |
| `ACE_LOCALE` | Default locale for the ACE CLI and service | Higher priority than `LANG` / `LC_ALL` |
| `LANG` | Locale fallback variable | Used when `ACE_LOCALE` is unset |
| `LC_ALL` | Locale fallback variable | Used when `ACE_LOCALE` and `LANG` are unset |
| `NODE_ENV` | Runtime mode; also affects `.env*` loading and some debug defaults | `production` for managed child services |

Public-origin and channel-recovery variables:

| Variable | Description | Default / precedence |
|------|-------------|----------------------|
| `ACE_PUBLIC_ORIGIN` | Absolute public origin used for webhook URLs, callbacks, and the official WeChat bridge | Highest priority |
| `NEXT_PUBLIC_ACE_ORIGIN` | Public-origin fallback | Lower priority than `ACE_PUBLIC_ORIGIN` |
| `NEXT_PUBLIC_APP_ORIGIN` | Public-origin fallback | Lower priority than `NEXT_PUBLIC_ACE_ORIGIN` |
| `ACE_WECHAT_AUTO_RESTORE` | Auto-restore official WeChat bridges after the service starts | Enabled by default; disable with `0` / `false` |
| `ACE_WECHAT_RESTORE_DELAY_MS` | Delay before official WeChat bridge restore (ms) | `3000` |

Diagnostics and ACP / streaming variables:

| Variable | Description | Default / precedence |
|------|-------------|----------------------|
| `ACE_TIMING_DEBUG` | Print service and ACP timing logs | On by default in local development, off in production / test |
| `ACE_ACP_TIMING_DEBUG` | Additional switch for ACP timing logs | Can be combined with `ACE_TIMING_DEBUG` |
| `ACE_ACP_STREAM_DEBUG` | Print ACP stream-event debug output | Follows engine diagnostic logging when unset |
| `ACE_ACP_INIT_TIMEOUT_MS` | ACP `connection.initialize` timeout in ms | `30000` |
| `ACE_ACP_NEW_SESSION_TIMEOUT_MS` | ACP `newSession` timeout in ms | `60000` |
| `ACE_ACP_LOAD_SESSION_TIMEOUT_MS` | ACP `session/load` timeout in ms | `30000` |
| `ACE_ACP_MODEL_DISCOVERY_TIMEOUT_MS` | Total timeout for model discovery in ms | `init + newSession + 15000` |
| `ACE_CHAT_STREAM_DEBUG` | Claude Code SDK streaming debug | Off by default |
| `ACE_CLAUDE_CODE_EXECUTABLE` | Explicit path to the Claude Code executable | Falls back to `CLAUDE_CODE_EXECUTABLE` or auto-discovery |
| `ACE_CLAUDE_API_RETRY_ATTEMPTS` | Max Claude Code SDK API retry attempts | `12` |
| `ACE_CLAUDE_API_RETRY_MIN_DELAY_MS` | Minimum Claude Code SDK API retry delay in ms | `10000` |

Engine-specific ACE variables:

| Variable | Description | Default / precedence |
|------|-------------|----------------------|
| `ACE_CODEGENIE_BIN` | Path to the CodeGenie executable | Auto-detected from PATH / SDK settings when unset |
| `ACE_CODEGENIE_SDK_BASE_URL` | CodeGenie SDK service URL | Uses the built-in default when unset |
| `ACE_CODEGENIE_SDK_COMMAND` | CodeGenie SDK launch command | Auto-detected from PATH / SDK settings when unset |
| `ACE_CODEGENIE_SDK_TIMEOUT_MS` | CodeGenie SDK request timeout in ms | Uses the built-in default when unset |
| `ACE_NGA_BIN` | Path to the NGA executable | Auto-detected from PATH / SDK settings when unset |
| `ACE_NGA_SDK_BASE_URL` | NGA SDK service URL | Uses the built-in default when unset |
| `ACE_NGA_SDK_COMMAND` | NGA SDK launch command | Auto-detected from PATH / SDK settings when unset |
| `ACE_NGA_SDK_TIMEOUT_MS` | NGA SDK request timeout in ms | Uses the built-in default when unset |

Global ACE Service CLI:

```bash
ace              # Start ACE Service
ace start        # Explicitly start ACE Service
ace service      # Inspect and stop managed ACE instances
```

The startup wizard can enable background mode directly. If daemon supervision is also enabled, ACE will keep the background service under a daemon and automatically restart it after unexpected exits.

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
ace service        # Inspect and stop ACE services
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
| Markdown and docs | react-markdown, remark-gfm, rehype-raw, KaTeX |
| AI SDKs and execution backends | Anthropic Claude Agent SDK, OpenAI Codex SDK, `claude-code` / `kiro-cli` / `opencode` / `nga` / `codegenie` / `cursor` / `codex` / `trae-cli` / `magic-cli` |
| Testing | Vitest 4, Testing Library, jsdom |
| Themes | next-themes |

### Documentation Maintenance

Update this README when any of the following changes:

- `package.json` scripts, `bin`, `files`, or publishing flow
- documented environment variable changes
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
