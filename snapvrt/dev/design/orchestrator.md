# Orchestrator Design Document

> Part of [snapvrt specification](../SPEC.md)

The **orchestrator** is the main `snapvrt` binary that coordinates all operations: CLI commands, HTTP API service, Docker container management, and user interactions.

## Open Questions

> These questions need answers before implementation.

### Q1: Should batch commands reuse a running service?

If `snapvrt service start` is already running, what should `snapvrt test` do?

| Option                      | Description                               | Pros                        | Cons                             |
| --------------------------- | ----------------------------------------- | --------------------------- | -------------------------------- |
| **A: Always standalone**    | Batch commands never use existing service | Simple, predictable         | Duplicate containers, slower     |
| **B: Connect if available** | Detect running service, use it            | Fast, reuse warm containers | Complex detection, state sharing |
| **C: Require explicit**     | `snapvrt test --use-service`              | User controls behavior      | Extra flag to remember           |

**Current leaning:** B - Connect if available

**Rationale:** Best DX for the primary use case (Jest/Vitest integration). When tests run, developers likely already have the service running for the review UI. Detection is simple: check if port 4040 responds to `/health`. If not available, fall back to standalone operation. The "state sharing" concern is minimal since coordination happens via the filesystem (`.snapvrt/`) regardless.

---

### Q2: Container lifecycle in service mode

How long should Docker containers (capture, diff) stay running?

| Option              | Description                           | Pros                     | Cons                              |
| ------------------- | ------------------------------------- | ------------------------ | --------------------------------- |
| **A: Always warm**  | Start with service, stop with service | Fast responses           | Uses resources when idle          |
| **B: Idle timeout** | Stop after N seconds of inactivity    | Balance                  | Complexity, cold start after idle |
| **C: Per-request**  | Start/stop for each request           | Clean, minimal resources | Slow (~2-5s startup per request)  |

**Current leaning:** B - Idle timeout (300s default)

**Rationale:** Standard pattern used by connection pools, Lambda warm starts, etc. Always-warm wastes resources during idle periods (lunch, meetings, overnight). Per-request adds 2-5s cold start penalty per operation which compounds painfully during active development. A 5-minute idle timeout balances fast responses with resource efficiency. Containers spin up on first request, stay warm during active work, then clean up automatically.

---

### Q3: Concurrent batch operations

What if `/storybook/test` is called while another is running?

| Option          | Description                | Pros                | Cons                          |
| --------------- | -------------------------- | ------------------- | ----------------------------- |
| **A: Reject**   | Return 409 Conflict        | Simple, predictable | User must retry               |
| **B: Queue**    | Queue and run sequentially | No lost requests    | Complexity, unclear wait time |
| **C: Parallel** | Run simultaneously         | Fast                | Resource contention, complex  |

**Current leaning:** A - Reject (for v1)

**Rationale:** Storybook test runs read/write to `.snapvrt/` directory. Running two simultaneously creates race conditions: both reading stories, both writing diffs, potentially overwriting each other's results. A 409 Conflict with a clear message ("Test run already in progress, started at HH:MM:SS") is predictable and easy to understand. Users can check `/status` to see what's running. We can add queuing in a future version if there's demand, but it adds complexity around timeout handling, queue depth limits, and progress reporting for queued items.

---

### Q4: Service binding and access

Who can access the service API?

| Option                | Description                       | Pros              | Cons                       |
| --------------------- | --------------------------------- | ----------------- | -------------------------- |
| **A: Localhost only** | Bind to 127.0.0.1                 | Secure by default | Can't use from Docker/CI   |
| **B: All interfaces** | Bind to 0.0.0.0                   | Flexible          | Security risk              |
| **C: Configurable**   | Default localhost, config to open | Balance           | User must configure for CI |

**Current leaning:** C - Configurable (default localhost)

**Rationale:** Secure by default is the right approach for a tool that might expose internal application screenshots. Default to `127.0.0.1`. For CI/Docker scenarios, provide `--host` flag and config option:

- `snapvrt service start --host 0.0.0.0`
- Or in config: `service.host = "0.0.0.0"`

Docker users can also use host networking or expose the port explicitly. This keeps the default secure while remaining flexible.

---

### Q5: Review mode relationship to service

Is `snapvrt review` a separate mode or just service + browser?

| Option                   | Description                                | Pros        | Cons                      |
| ------------------------ | ------------------------------------------ | ----------- | ------------------------- |
| **A: Separate**          | Own mini-server, no full API               | Lightweight | Duplicate code            |
| **B: Service + browser** | Start service, open browser, exit on close | Reuse code  | Heavier for simple review |
| **C: Connect or start**  | Connect to running service, or start new   | Flexible    | Complex                   |

**Current leaning:** C - Connect or start

**Rationale:** Best user experience. When user runs `snapvrt review`:

1. Check if service is already running (via `/health`)
2. If running: open browser to existing service's review UI
3. If not running: start service, open browser, stop service when browser tab closes (via WebSocket disconnect)

This handles all common scenarios gracefully:

- Developer with service already running → instant review
- Quick review without thinking about service → just works
- Multiple review sessions → share same service

The "heavier" concern for option B is negligible since we need to serve files regardless.

---

### Q6: Daemon mode necessity

Do we need `--daemon` mode at all for v1?

| Option                   | Description                                  | Pros              | Cons            |
| ------------------------ | -------------------------------------------- | ----------------- | --------------- |
| **A: Yes, from v1**      | Full daemon support with PID file            | Complete solution | More complexity |
| **B: No, defer**         | Foreground only, user can `&` or use systemd | Simpler v1        | Less convenient |
| **C: Just --background** | Simple `&` wrapper, no PID management        | Middle ground     | No clean stop   |

**Current leaning:** B - No, defer to post-v1

**Rationale:** Foreground mode covers all use cases adequately for v1:

- Local dev: terminal in background or use shell's `&`
- CI: `snapvrt service start &` then run tests
- Production/long-running: systemd, launchd, Docker, or supervisor

Proper daemon mode requires PID file management, signal handling, log rotation, and clean shutdown semantics. That's significant complexity for a v1 feature that isn't strictly necessary. Users who need daemon mode today have mature tools (systemd, launchd) that do it better than we would in v1.

**Revisit when:** Users specifically request it, or we need tight IDE integration.

---

## Proposed Architecture

Based on decisions above:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ CLI COMMAND FLOW                                                           │
│                                                                            │
│  User runs: snapvrt test | update | approve | review                       │
│                                                                            │
│                                 │                                          │
│                                 ▼                                          │
│                    ┌────────────────────────┐                              │
│                    │  GET :{port}/health    │                              │
│                    │  (is service running?) │                              │
│                    └────────────────────────┘                              │
│                          │           │                                     │
│                   200 OK │           │ connection refused                  │
│                          ▼           ▼                                     │
│              ┌────────────────┐  ┌────────────────┐                        │
│              │ DELEGATE       │  │ STANDALONE     │                        │
│              │                │  │                │                        │
│              │ POST /storybook│  │ 1. Start Docker│                        │
│              │ POST /compare  │  │ 2. Execute     │                        │
│              │ etc.           │  │ 3. Stop Docker │                        │
│              └────────────────┘  └────────────────┘                        │
│                          │           │                                     │
│                          └─────┬─────┘                                     │
│                                ▼                                           │
│                    ┌────────────────────────┐                              │
│                    │  .snapvrt/             │                              │
│                    │  ├── reference/        │                              │
│                    │  ├── current/          │                              │
│                    │  └── diff/             │                              │
│                    └────────────────────────┘                              │
└────────────────────────────────────────────────────────────────────────────┘


┌────────────────────────────────────────────────────────────────────────────┐
│ SERVICE MODE (snapvrt service start)                                       │
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ HTTP API (:{port}, default 4040)                                     │  │
│  │                                                                      │  │
│  │  GET  /health ─────────── returns 200 (enables CLI detection)        │  │
│  │  GET  /status ─────────── pending diffs, running operations          │  │
│  │  POST /compare/web ────── compare web page screenshot                │  │
│  │  POST /compare/pdf ────── compare PDF                                │  │
│  │  POST /storybook/test ─── run Storybook test (409 if busy)           │  │
│  │  POST /approve ────────── approve single snapshot                    │  │
│  │  GET  /review ─────────── serve review UI                            │  │
│  │  WS   /ws ─────────────── live updates                               │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                   │                                        │
│                                   ▼                                        │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │ Container Manager                                                    │  │
│  │                                                                      │  │
│  │  ┌────────────┐  ┌────────────┐     5-minute idle timeout            │  │
│  │  │  capture   │  │   diff     │     Auto-stop when idle              │  │
│  │  │  (Chrome)  │  │  (dssim)   │     Restart on next request          │  │
│  │  └────────────┘  └────────────┘                                      │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────────┘
```

**Flow:**

1. CLI command starts (test, update, approve, review)
2. First action: `GET :{port}/health` - is service running? (port from `--port` flag or config, default 4040)
3. **200 OK** → delegate to service API
4. **Connection refused** → run standalone (start containers, execute, cleanup)
5. Both paths read/write to same `.snapvrt/` directory

## Commands

### Batch Commands

| Command                  | Description                                   | Exit Code                     |
| ------------------------ | --------------------------------------------- | ----------------------------- |
| `snapvrt test`           | Run Storybook tests (uses service if running) | 0 = pass, 1 = fail, 2 = error |
| `snapvrt update`         | Capture new references                        | 0 = success, 2 = error        |
| `snapvrt approve [name]` | Copy current → reference                      | 0 = success                   |
| `snapvrt approve --all`  | Approve all pending                           | 0 = success                   |
| `snapvrt init`           | Initialize project                            | 0 = success                   |

### Service Commands

| Command                                | Description                               |
| -------------------------------------- | ----------------------------------------- |
| `snapvrt service start`                | Start HTTP API (foreground)               |
| `snapvrt service start --host 0.0.0.0` | Bind to all interfaces (for CI/Docker)    |
| `snapvrt service start --port 5050`    | Use custom port                           |
| `snapvrt service status`               | Show if running, pending diffs            |
| `snapvrt review`                       | Open review UI (starts service if needed) |

### Global Flags

| Flag              | Default        | Description                             |
| ----------------- | -------------- | --------------------------------------- |
| `--port <PORT>`   | `4040`         | Port for service (used by all commands) |
| `--config <FILE>` | `snapvrt.toml` | Config file path                        |

**Note:** No `--daemon` flag in v1. Use shell backgrounding (`&`) or systemd/launchd for long-running services.

## Service API

| Endpoint            | Method | Description                                                   |
| ------------------- | ------ | ------------------------------------------------------------- |
| `/health`           | GET    | Health check (used for service detection)                     |
| `/status`           | GET    | List pending diffs, running operations                        |
| `/compare/web`      | POST   | Compare web page                                              |
| `/compare/pdf`      | POST   | Compare PDF                                                   |
| `/update/web`       | POST   | Update web reference                                          |
| `/update/pdf`       | POST   | Update PDF reference                                          |
| `/approve`          | POST   | Approve single snapshot                                       |
| `/approve-all`      | POST   | Approve all pending                                           |
| `/storybook/test`   | POST   | Run Storybook batch test (409 if already running)             |
| `/storybook/update` | POST   | Update Storybook references                                   |
| `/review`           | GET    | Serve review UI                                               |
| `/ws`               | WS     | Live updates (diff results, progress, review close detection) |

## Configuration

```toml
[service]
port = 4040
host = "127.0.0.1"           # Default localhost, use 0.0.0.0 for CI/Docker
open_browser = true          # Auto-open browser for `snapvrt review`

[service.containers]
idle_timeout = 300           # Seconds before stopping idle containers (0 = never)
```

## Module Structure

The `snapvrt` crate (main binary) is organized into these modules:

```
snapvrt/src/
├── main.rs
├── cli.rs       # CLI interface
├── config.rs    # Configuration
├── server.rs    # HTTP API
├── engine.rs    # Core operations
├── docker.rs    # Container management
└── store.rs     # Snapshot storage
```

### Module Responsibilities

| Module   | Responsibility                                                                                                         |
| -------- | ---------------------------------------------------------------------------------------------------------------------- |
| `cli`    | Clap definitions, arg parsing, command dispatch. Calls `engine` directly (standalone) or delegates to running service. |
| `config` | Load config file (TOML), env vars, CLI args. Merge with precedence: CLI > env > file > defaults.                       |
| `server` | Axum HTTP handlers. Thin layer that validates requests and calls `engine`. WebSocket for live updates.                 |
| `engine` | Core business logic. Both `cli` and `server` call into this. Operations: capture, compare, approve, test batch.        |
| `docker` | Docker container lifecycle. Start/stop capture and diff containers. Health checks. Idle timeout management.            |
| `store`  | Filesystem operations for `.snapvrt/`. Read/write reference, current, diff images. List pending diffs.                 |

### Module Dependencies (compile-time)

```
                     ┌─────┐
                     │ cli │
                     └──┬──┘
            ┌───────────┼───────────┐
            ▼           ▼           │
       ┌────────┐  ┌────────┐       │
       │ config │  │ server │       │
       └────────┘  └───┬────┘       │
                       │            │
                       └──────┬─────┘
                              ▼
                         ┌────────┐
                         │ engine │
                         └───┬────┘
                       ┌─────┴─────┐
                       ▼           ▼
                  ┌────────┐  ┌────────┐
                  │ docker │  │ store  │
                  └────────┘  └────────┘
```

| From     | To                     |
| -------- | ---------------------- |
| `cli`    | config, server, engine |
| `server` | engine                 |
| `engine` | docker, store          |

### Runtime Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ snapvrt <command>                                                           │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
                              ┌─────────────────┐
                              │  config::load() │
                              └────────┬────────┘
                                       │
                                       ▼
                         ┌─────────────────────────────┐
                         │ command = "service start"? │
                         └─────────────┬───────────────┘
                                       │
                      ┌────────────────┴────────────────┐
                      │ yes                             │ no
                      ▼                                 ▼
          ┌───────────────────────┐        ┌───────────────────────┐
          │ server::start(engine) │        │ GET :{port}/health    │
          │                       │        └───────────┬───────────┘
          │ (blocks, serves HTTP) │                    │
          └───────────────────────┘       ┌────────────┴────────────┐
                                          │ 200 OK                  │ refused
                                          ▼                         ▼
                              ┌─────────────────────┐  ┌─────────────────────┐
                              │ delegate to service │  │ engine::run(cmd)    │
                              │                     │  │                     │
                              │ POST :{port}/...    │  │ (standalone mode)   │
                              └─────────────────────┘  └─────────────────────┘
```

**Paths:**

- `service start` → start HTTP server, block
- batch + service running → delegate via HTTP
- batch + no service → run engine directly (standalone)

### Key Types (Draft)

```rust
// config.rs
pub struct Config {
    pub port: u16,
    pub host: IpAddr,
    pub snapshot_dir: PathBuf,
    pub storybook_url: Option<Url>,
    pub containers: ContainerConfig,
}

// engine.rs
pub struct Engine {
    config: Arc<Config>,
    docker: Docker,
    store: Store,
}

impl Engine {
    pub async fn compare_web(&self, req: CompareWebRequest) -> Result<CompareResult>;
    pub async fn compare_pdf(&self, req: ComparePdfRequest) -> Result<CompareResult>;
    pub async fn test_storybook(&self) -> Result<TestResult>;
    pub async fn update_storybook(&self) -> Result<UpdateResult>;
    pub async fn approve(&self, name: &str) -> Result<()>;
    pub async fn approve_all(&self) -> Result<()>;
    pub async fn status(&self) -> Result<Status>;
}

// store.rs
pub struct Store {
    root: PathBuf,  // .snapvrt/
}

impl Store {
    pub fn reference_path(&self, name: &str) -> PathBuf;
    pub fn current_path(&self, name: &str) -> PathBuf;
    pub fn diff_path(&self, name: &str) -> PathBuf;
    pub fn list_pending(&self) -> Result<Vec<PendingDiff>>;
    pub fn approve(&self, name: &str) -> Result<()>;
}
```

## Implementation Notes

### Service Detection

Batch commands detect running service via:

```rust
fn detect_service(port: u16) -> Option<ServiceClient> {
    let url = format!("http://127.0.0.1:{}/health", port);
    match reqwest::blocking::get(&url) {
        Ok(resp) if resp.status().is_success() => Some(ServiceClient::new(port)),
        _ => None,
    }
}
```

### Container Idle Timeout

Service tracks last activity timestamp. Background task checks periodically:

```rust
loop {
    tokio::time::sleep(Duration::from_secs(60)).await;
    let idle_duration = Instant::now() - last_activity;
    if idle_duration > config.idle_timeout {
        stop_containers().await;
    }
}
```

Containers restart automatically on next request.

### Review Mode Lifecycle

```
snapvrt review
    │
    ├── Check /health
    │   ├── Running → open browser to http://localhost:4040/review
    │   └── Not running → start service, open browser
    │
    └── If we started service:
        └── Monitor WebSocket connections
            └── Last connection closed → stop service (with grace period)
```
