---
name: ottie
description: Ottie CLI reference for managing agents. Load this skill whenever you need to use ottie commands.
---

## Agent Commands

```bash
# List agents (directory-scoped by default)
ottie ls                 # Only shows agents for current directory
ottie ls -g              # All agents across all projects (global)
ottie ls --json          # JSON output for parsing

# Create and run an agent (blocks until completion by default, no timeout)
ottie run --mode bypassPermissions "<prompt>"
ottie run --mode bypassPermissions --name "task-name" "<prompt>"
ottie run --mode bypassPermissions --provider claude/opus "<prompt>"
ottie run --mode full-access --provider codex/gpt-5.4 "<prompt>"

# Wait timeout - limit how long run blocks (default: no limit)
ottie run --wait-timeout 30m "<prompt>"   # Wait up to 30 minutes
ottie run --wait-timeout 1h "<prompt>"    # Wait up to 1 hour

# Detached mode - runs in background, returns agent ID immediately
ottie run --detach "<prompt>"
ottie run -d "<prompt>"  # Short form

# Structured output - agent returns only matching JSON
ottie run --output-schema '{"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}' "<prompt>"
# NOTE: --output-schema blocks until completion (cannot be used with --detach)

# Worktrees - isolated git worktree for parallel feature development
ottie run --worktree feature-x "<prompt>"

# Check agent logs/output
ottie logs <agent-id>
ottie logs <agent-id> -f               # Follow (stream)
ottie logs <agent-id> --tail 10        # Last 10 entries
ottie logs <agent-id> --filter tools   # Only tool calls

# Wait for agent to complete or need permission
ottie wait <agent-id>
ottie wait <agent-id> --timeout 60     # 60 second timeout

# Send follow-up prompt to running agent
ottie send <agent-id> "<prompt>"
ottie send <agent-id> --image screenshot.png "<prompt>"  # With image
ottie send <agent-id> --no-wait "<prompt>"               # Queue without waiting

# Inspect agent details
ottie inspect <agent-id>

# Interrupt an agent's current run
ottie stop <agent-id>

# Archive an agent (soft-delete, removes from UI)
ottie archive <agent-id>
ottie archive <agent-id> --force  # Force archive running agent (interrupts first)

# Hard-delete an agent (interrupts first if needed)
ottie delete <agent-id>

# Attach to agent output stream (Ctrl+C to detach without stopping)
ottie attach <agent-id>

# Permissions management
ottie permit ls                # List pending permission requests
ottie permit allow <agent-id>  # Allow all pending for agent
ottie permit deny <agent-id> --all  # Deny all pending

# Output formats
ottie ls --json          # JSON output
ottie ls -q              # IDs only (quiet mode, useful for scripting)
```

## Loop Commands

Iterative worker loops: launch a worker agent, verify its output, repeat until done.

```bash
# Start a loop
ottie loop run "<worker prompt>" [options]
  --verify "<verifier prompt>"      # Verifier agent prompt
  --verify-check "<command>"        # Shell command that must exit 0 (repeatable)
  --name <name>                     # Optional loop name
  --sleep <duration>                # Delay between iterations (30s, 5m)
  --max-iterations <n>              # Maximum number of iterations
  --max-time <duration>             # Maximum total runtime (1h, 30m)
  --provider <provider/model>        # Worker agent provider/model (e.g. codex/gpt-5.4)
  --verify-provider <provider/model> # Verifier agent provider/model (e.g. claude/opus)
  --archive                         # Archive agents after each iteration

# Manage loops
ottie loop ls                       # List all loops
ottie loop inspect <id>             # Show loop details and iterations
ottie loop logs <id>                # Stream loop logs
ottie loop stop <id>                # Stop a running loop
```

## Schedule Commands

Recurring time-based execution: run a prompt on a cron or interval schedule.

```bash
# Create a schedule
ottie schedule create "<prompt>" [options]
  --every <duration>                # Fixed interval (5m, 1h)
  --cron <expr>                     # Cron expression
  --name <name>                     # Optional schedule name
  --target <self|new-agent|id>      # Run target
  --max-runs <n>                    # Maximum number of runs
  --expires-in <duration>           # Time to live for schedule

# Manage schedules
ottie schedule ls                   # List schedules
ottie schedule inspect <id>         # Inspect a schedule
ottie schedule logs <id>            # Show recent run logs
ottie schedule pause <id>           # Pause a schedule
ottie schedule resume <id>          # Resume a paused schedule
ottie schedule delete <id>          # Delete a schedule
```

## Chat Commands

Asynchronous agent coordination through persistent chat rooms.

```bash
# Create a chat room
ottie chat create <name> --purpose "<description>"

# List and inspect rooms
ottie chat ls
ottie chat inspect <name-or-id>

# Post a message
ottie chat post <room> "<message>"
ottie chat post <room> "<message>" --reply-to <msg-id>
ottie chat post <room> "@<agent-id> <message>"
ottie chat post <room> "@everyone <message>"

# Read messages
ottie chat read <room>
ottie chat read <room> --limit <n>
ottie chat read <room> --since <duration-or-timestamp>
ottie chat read <room> --agent <agent-id>

# Wait for new messages
ottie chat wait <room>
ottie chat wait <room> --timeout <duration>

# Delete a room
ottie chat delete <name-or-id>
```

## Terminal Commands

Manage workspace terminals: create, inspect, send keystrokes, capture output.

```bash
# List terminals (scoped to current directory by default)
ottie terminal ls                    # Terminals in current directory
ottie terminal ls --all              # All terminals across all workspaces
ottie terminal ls --cwd ~/dev/myapp  # Terminals in a specific directory

# Create a terminal
ottie terminal create                          # In current directory
ottie terminal create --cwd ~/dev/myapp        # In a specific directory
ottie terminal create --name "build-runner"    # With a custom name

# Kill a terminal (supports short ID prefixes and name matching)
ottie terminal kill <terminal-id>
ottie terminal kill abc123           # Short prefix
ottie terminal kill build-runner     # By name

# Capture terminal output as plain text (like tmux capture-pane -p)
ottie terminal capture <terminal-id>               # Visible pane only, ANSI stripped
ottie terminal capture <terminal-id> --scrollback   # Full scrollback + visible
ottie terminal capture <terminal-id> -S             # Short form of --scrollback
ottie terminal capture <terminal-id> --start 0 --end 10   # Line range (tmux-style)
ottie terminal capture <terminal-id> --start -5     # Last 5 lines
ottie terminal capture <terminal-id> --ansi         # Preserve ANSI escape codes
ottie terminal capture <terminal-id> --json         # JSON output with metadata

# Send keystrokes (like tmux send-keys)
ottie terminal send-keys <terminal-id> "ls -la" Enter
ottie terminal send-keys <terminal-id> "echo hello" Enter
ottie terminal send-keys <terminal-id> C-c          # Ctrl+C
ottie terminal send-keys <terminal-id> C-d          # Ctrl+D
ottie terminal send-keys <terminal-id> --literal "raw text"  # No special token interpretation
```

**Special key tokens** (interpreted by default, use `--literal` to send raw):
`Enter`, `Tab`, `Escape`, `Space`, `BSpace`, `C-c`, `C-d`, `C-z`, `C-l`, `C-a`, `C-e`

**Common pattern — launch a process and interact with it:**

```bash
id=$(ottie terminal create --name "my-shell" -q)
ottie terminal send-keys "$id" "claude" Enter
sleep 5
ottie terminal capture "$id" --scrollback   # See what happened
ottie terminal send-keys "$id" "Hello!" Enter
sleep 10
ottie terminal capture "$id" --scrollback   # See the response
ottie terminal send-keys "$id" "/exit" Enter
ottie terminal kill "$id"
```

## Available Models

**Claude (default provider):**

- `--provider claude/haiku` — Fast/cheap, ONLY for tests (not for real work)
- `--provider claude/sonnet` — Good for most tasks
- `--provider claude/opus` — For harder reasoning, complex debugging

**Codex:**

- `--provider codex/gpt-5.4` — Latest frontier agentic coding model (preferred for all engineering tasks)
- `--provider codex/gpt-5.4-mini` — Cheaper, faster, but less capable

## Permissions

Always launch agents fully permissioned. Use `--mode bypassPermissions` for Claude and `--mode full-access` for Codex. Always specify the model: `--provider claude/opus`, `--provider codex/gpt-5.4`, etc. Control behavior through **strict prompting**, not permission modes.

## Waiting for Agents

Both `ottie run` and `ottie wait` block until the agent completes. Trust them.

- `ottie run` waits **forever** by default (no timeout). Use `--wait-timeout` to set a limit.
- `ottie wait` also waits forever by default. Use `--timeout` to set a limit.
- Agent tasks can legitimately take 10, 20, or even 30+ minutes. This is normal.
- When a wait times out, **just re-run `ottie wait <id>`** — don't panic, don't start checking logs.
- Do NOT poll with `ottie ls`, `ottie inspect`, or `ottie logs` in a loop to "check on" the agent.
- **Never launch a duplicate agent** because a wait timed out. The original is still running.

## Composing Agents in Bash

`ottie run` blocks by default and `--output-schema` returns structured JSON, making it easy to compose agents in bash loops and pipelines.

**Detach + wait pattern for parallel work:**

```bash
api_id=$(ottie run -d --name "impl-api" "implement the API" -q)
ui_id=$(ottie run -d --name "impl-ui" "implement the UI" -q)

ottie wait "$api_id"
ottie wait "$ui_id"
```
