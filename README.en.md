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
- `claude-code` / `kiro-cli` / `opencode` / `cursor-cli` / `codex` / `trae-cli` / `Cangjie Magic`

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

### 1. Adversarial Iteration: Red Team vs Blue Team

Each workflow stage can define three roles:

| Role | Responsibility | Example Agents |
|------|------|-----------|
| **Defender** (Red Team) | Defend the plan, implement the change, and provide evidence | architect, developer, fix-hunter, ... |
| **Attacker** (Blue Team) | Attack the proposal, review quality, and find defects | fix-breaker, design-breaker, stress-tester, ... |
| **Judge** | Arbitrate both sides and output a verdict | fix-judge, code-judge, design-judge, ... |

The Judge produces a structured verdict, and the system decides whether to pass or continue iterating:

```json
{ "verdict": "fail", "remaining_issues": 3, "summary": "Edge cases are still uncovered" }
```

ACEHarness ships with specialized agents for architecture design, implementation, security auditing, performance testing, documentation, and more. Some agents also include a Review Panel mode, where multiple sub-agents review in parallel from different angles.

### 2. Automated Analysis: More Than Just Running Tasks

The system does not merely "run agents in order". It analyzes execution as it goes:

- **Regression test decisions**: automatically determines which tests to run for O0/O1/O2 optimization levels instead of always running the full suite
- **Rollback-path analysis**: visualizes rollback counts and hot states in the transition graph to help identify workflow bottlenecks
- **Cost tracking**: records token usage and cost for every step, enabling cost optimization decisions
- **Prompt analysis**: evaluates historical prompts and suggests quality improvements

### 3. Human-in-the-Loop Checkpoints

Critical decisions can be guarded by manual approval gates:

- Confirm whether coding should begin after design is completed
- Decide whether to continue iterating or accept the result after a code fix
- Support **feedback injection**: add extra instructions to the agent at any time during iteration
- Support **forced jumps**: jump directly to any state if the current path is unsatisfactory

### 4. State Machine Workflow Engine: Beyond Linear Pipelines

Traditional AI workflows tend to run from start to finish linearly. ACEHarness introduces a **finite-state machine** model where every state can decide the next step dynamically based on the agent's structured verdict:

![State machine workflow execution view](https://raw.gitcode.com/Cangjie-SIG/ACEHarness/files/main/public/images/hero-state-machine.png)

- **Conditional transitions**: when an agent outputs `{"verdict": "fail"}`, the workflow can automatically roll back to an upstream state for re-analysis
- **Maximum transition protection**: prevents infinite loops, such as `maxTransitions: 50`
- **State-scoped context**: each state maintains its own context while also sharing global information
- **Crash recovery**: after a service restart, interrupted runs are detected automatically and can resume from checkpoints

In real execution logs, when fixing a compiler ICE issue, the workflow automatically rolled back **three times** between root-cause analysis and solution design before moving forward with the actual fix. That is the practical value of a state-machine workflow.

### 5. Spec Coding: A Traceable Loop from Requirement to Task

Spec Coding turns an initial request into formal planning artifacts before execution. A typical Spec includes `requirements.md`, `design.md`, and `tasks.md`, and workflow creation binds workflow steps to Spec tasks before the run starts.

This closes the gap where an AI may change the plan while running and leave users unsure what actually happened:

- **Binding at creation time**: when AI generates a workflow draft, it receives structured Spec task context and outputs `specTaskBinding.taskIds` for each step
- **System-owned status**: task start, completion, failure, and restart status are maintained by the runtime system rather than by free-form agent text
- **Runtime overview**: the workbench overview can show top-level tasks and subtasks bound to workflow steps
- **Revision loop**: Supervisor revisions, user workflow edits, and imported Specs trigger binding validation so steps and tasks remain aligned
- **Persistent mode**: when persistent Spec is enabled, runtime plan revisions and task progress are written to the repository delta directory; persistent files do not overwrite runtime state unless the user explicitly imports them

### 6. Conversational Workflow Creation: Build It by Saying It

The chat interface on the home page is not just for conversation. It includes multiple action commands that cover the full workflow lifecycle:

- "Help me create a workflow to fix Issue #3116" — AI guides you through mode selection, agent configuration, and iteration strategy
- "Switch fix-hunter to opus" — updates the agent configuration directly
- "Start the oh-cangjiedev-sm workflow" — launches with one command
- "Help me submit a PR with the title ..." — integrates GitCode operations

Actions in the conversation are classified by risk level: safe operations run automatically, change operations require confirmation, and destructive operations require a second confirmation.

### 7. Supervisor Smart Routing: Let AI Decide Who Should Work on What

**The core problem**: in traditional multi-agent workflows, agents execute in a fixed sequence and passively consume upstream output. When information is missing, they can only guess, and humans must iterate after poor results. In other words, agents do not know what they do not know, and they have no proactive way to ask the right teammate.

**Architecture**: ACEHarness includes a Supervisor-Lite architecture that separates collaboration into three layers of responsibility:

- **Agent** declares only what information it needs through the `[NEED_INFO]` protocol, without knowing the team roster
- **Supervisor** performs routing only, moving from keyword matching to lightweight LLM routing and then to user fallback when needed
- **WorkflowManager** handles state transitions and persistence only, without making routing decisions

Routing happens in two layers: keyword hits route with near-zero cost, lightweight semantic routing runs only when needed, and the final fallback asks the user. The entire process is embedded in a configurable Plan loop so the agent executes only after it has enough information.

**Key advantages**:

- **Agent-agnostic collaboration**: prompts do not include an injected agent list, so each agent stays focused on its own domain while routing is delegated entirely to Supervisor
- **Near-zero routing cost**: most routing is handled by keyword matching, and a single LLM routing decision costs roughly $0.001, much cheaper than reruns caused by missing information
- **Breaks linear information flow**: an analyst can actively consult an implementation expert mid-execution instead of waiting for that expert's turn in the sequence
- **Progressive, zero-intrusion adoption**: add one line such as `enablePlanLoop: true` to a step to enable it; leave it out and the original execution path is unchanged. A three-level fallback prevents deadlock

The Supervisor view in the workbench can replay every decision round and clearly show why a route was chosen.

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

Supported engines include `claude-code`, `kiro-cli`, `opencode`, `cursor-cli`, `codex`, `trae-cli`, and `Cangjie Magic`.

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
| AI SDKs and execution backends | Anthropic Claude Agent SDK, OpenAI Codex SDK, `claude-code` / `codex` / `opencode` CLI engines |
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
