---
name: loopx
description: "Govern long-running, multi-step, or cross-session Hermes tasks with LoopX — a provider-neutral state kernel that preserves goals, gates, todos, quota, and evidence between agent turns. Use when a task spans many agent loops, needs durable progress tracking, or requires human gates before risky writes."
version: 1.0.0
author: GauTown (Hermes integration)
license: MIT
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [loopx, long-task, governance, persistence, agent-loop, other-agent]
    homepage: https://github.com/huangruiteng/loopx
    trigger: "User says /loopx, '/loopx <goal>', or 'use loopx to govern this task', or the task is clearly long-running/multi-step."
---

# LoopX — Long-Task Governance for Hermes

LoopX is a lightweight, agent-agnostic **control plane** for long-horizon work. Hermes
talks to it through the `loopx` CLI (already installed globally; `loopx --version`
must print `0.5.2` or newer). Hermes is connected in LoopX's `other-agent` mode:
the agent drives bounded turns, LoopX holds the durable state that survives between
them (goals, todos, gates, quota, evidence, handoffs).

This skill makes `/loopx` a real trigger in Hermes. Do NOT fabricate loopx output —
every status read comes from the actual CLI.

## When to use
- The task needs many agent loops to finish (research, long engineering, multi-agent work).
- Progress must survive across sessions / restarts.
- A step needs human judgment before proceeding (publish, prod write, private data).

Single-shot tasks do NOT need LoopX.

## Preconditions (verify once)
- `loopx --version` resolves on PATH. If not: `python3 -m pip install --upgrade loopx`
  then re-check. (User PATH was set persistently; open a fresh terminal if an old
  shell can't see it.)
- The working directory should be a LoopX project. First time in a repo/dir:
  `loopx bootstrap --project . --goal-id <kebab-goal> --adapter-kind read_only_project_map_v0 --adapter-status connected-read-only`
  This writes `.loopx/registry.json` (state lives under `.loopx/` and the user-level
  registry). Reuse existing state if already connected — never re-bootstrap blindly.

## Protocol (run these as real commands)
1. **Inspect first** — `loopx status`
   Shows current goals, gates, and the next safe action. Bare `/loopx` is read/status-first.
2. **Start a goal** — `loopx start-goal --guided --project . --goal-text "<goal>"`
   Plans ordered todos. Do the planning checkpoint BEFORE writing todos.
3. **Each loop turn**:
   - `loopx quota should-run` → decide whether the next agent turn should run.
   - `loopx todo --help` → add / claim / complete / update / archive todos in priority order.
   - `loopx evidence-log --goal-id <id> --agent-id <id> --thin` → read this agent's thin
     ledger before replanning.
4. **Human gate** — when a step needs human judgment (publish, prod write, private data),
   stop at a LoopX gate and ask the user. Do not cross it autonomously.
5. **Global view** — `loopx doctor` (install/PATH health), `loopx-global-summary` style
   commands for manager-level digest.

## Trigger surface
- `/loopx` → inspect current project LoopX state / next action.
- `/loopx <goal text>` → start a concrete goal and enter the quota-gated loop.
- "用 loopx 治理这个任务" / "把这个长任务交给 loopx" → same as `/loopx <goal text>`.

## Notes
- State is durable: `.loopx/` (project) + user-level registry. Add `.loopx/` and
  `.codex/goals/` to `.gitignore` if goal state contains private evidence.
- `read_window_below` and other Hermes features are unaffected.
- This skill mirrors the protocol in `$HERMES_HOME/USER.md` (global config). Keep them in sync.
