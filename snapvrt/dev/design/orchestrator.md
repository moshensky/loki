# Orchestrator Design Document

> Part of [snapvrt specification](../SPEC.md)

The **orchestrator** is the main `snapvrt` binary that coordinates all operations: CLI commands, HTTP API service, Docker container management, and user interactions.

## Open Questions

> These questions need answers before implementation.

### Q1: Should batch commands reuse a running service?

If `snapvrt service start` is already running, what should `snapvrt test` do?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Always standalone** | Batch commands never use existing service | Simple, predictable | Duplicate containers, slower |
| **B: Connect if available** | Detect running service, use it | Fast, reuse warm containers | Complex detection, state sharing |
| **C: Require explicit** | `snapvrt test --use-service` | User controls behavior | Extra flag to remember |

**Current leaning:** ?

---

### Q2: Container lifecycle in service mode

How long should Docker containers (capture, diff) stay running?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Always warm** | Start with service, stop with service | Fast responses | Uses resources when idle |
| **B: Idle timeout** | Stop after N seconds of inactivity | Balance | Complexity, cold start after idle |
| **C: Per-request** | Start/stop for each request | Clean, minimal resources | Slow (~2-5s startup per request) |

**Current leaning:** ?

---

### Q3: Concurrent batch operations

What if `/storybook/test` is called while another is running?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Reject** | Return 409 Conflict | Simple, predictable | User must retry |
| **B: Queue** | Queue and run sequentially | No lost requests | Complexity, unclear wait time |
| **C: Parallel** | Run simultaneously | Fast | Resource contention, complex |

**Current leaning:** ?

---

### Q4: Service binding and access

Who can access the service API?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Localhost only** | Bind to 127.0.0.1 | Secure by default | Can't use from Docker/CI |
| **B: All interfaces** | Bind to 0.0.0.0 | Flexible | Security risk |
| **C: Configurable** | Default localhost, config to open | Balance | User must configure for CI |

**Current leaning:** ?

---

### Q5: Review mode relationship to service

Is `snapvrt review` a separate mode or just service + browser?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Separate** | Own mini-server, no full API | Lightweight | Duplicate code |
| **B: Service + browser** | Start service, open browser, exit on close | Reuse code | Heavier for simple review |
| **C: Connect or start** | Connect to running service, or start new | Flexible | Complex |

**Current leaning:** ?

---

### Q6: Daemon mode necessity

Do we need `--daemon` mode at all for v1?

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A: Yes, from v1** | Full daemon support with PID file | Complete solution | More complexity |
| **B: No, defer** | Foreground only, user can `&` or use systemd | Simpler v1 | Less convenient |
| **C: Just --background** | Simple `&` wrapper, no PID management | Middle ground | No clean stop |

**Current leaning:** ?

---

## Proposed Architecture

Once questions are answered, this section will be finalized.

```
┌─────────────────────────────────────────────────────────────────┐
│ snapvrt CLI                                                      │
│                                                                  │
│  Batch Commands              Service Mode                        │
│  ┌─────────────┐            ┌─────────────────────────────────┐ │
│  │ test        │───────────►│ HTTP API (:4040)                │ │
│  │ update      │  (Q1?)     │                                 │ │
│  │ approve     │            │ /health                         │ │
│  └─────────────┘            │ /compare/web, /compare/pdf      │ │
│                             │ /storybook/test, /update        │ │
│        │                    │ /review (UI)                    │ │
│        │ direct             │ /approve, /approve-all          │ │
│        │ file op            │ /status                         │ │
│        ▼                    │                                 │ │
│  ┌─────────────┐            │ Manages:                        │ │
│  │ .snapvrt/   │◄───────────│ ├── Docker containers (Q2?)     │ │
│  │ snapshots/  │            │ └── WebSocket (live updates)    │ │
│  └─────────────┘            └─────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

## Commands (Draft)

### Batch Commands

| Command | Description | Exit Code |
|---------|-------------|-----------|
| `snapvrt test` | Run Storybook tests | 0 = pass, 1 = fail, 2 = error |
| `snapvrt update` | Capture new references | 0 = success, 2 = error |
| `snapvrt approve [name]` | Copy current → reference | 0 = success |
| `snapvrt approve --all` | Approve all pending | 0 = success |
| `snapvrt init` | Initialize project | 0 = success |

### Service Commands

| Command | Description |
|---------|-------------|
| `snapvrt service start` | Start HTTP API (foreground) |
| `snapvrt service start --daemon` | Start in background (Q6?) |
| `snapvrt service stop` | Stop background service (Q6?) |
| `snapvrt service status` | Show if running, pending diffs |
| `snapvrt review` | Review UI (Q5?) |

## Service API (Draft)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/status` | GET | List pending diffs |
| `/compare/web` | POST | Compare web page |
| `/compare/pdf` | POST | Compare PDF |
| `/update/web` | POST | Update web reference |
| `/update/pdf` | POST | Update PDF reference |
| `/approve` | POST | Approve single snapshot |
| `/approve-all` | POST | Approve all pending |
| `/storybook/test` | POST | Run Storybook batch test (Q3?) |
| `/storybook/update` | POST | Update Storybook references |
| `/review` | GET | Serve review UI |
| `/ws` | WS | Live updates |

## Configuration (Draft)

```toml
[service]
port = 4040
host = "127.0.0.1"           # Q4: localhost vs 0.0.0.0
open_browser = true          # Auto-open for review

[service.containers]
idle_timeout = 300           # Q2: seconds, 0 = never
```

## Notes

- Add notes and decisions as we discuss
