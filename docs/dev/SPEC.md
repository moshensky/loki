# snapvrt Specification

## Overview

Opinionated visual regression testing for Storybook 10+.

**Tagline:** Snap. Test. Ship.

## Design Principles

1. **Rust + MIT** - Single binary CLI, permissive license
2. **Docker-first** - Screenshots and diffs run in containers for cross-platform consistency
3. **Storybook 10 only** - No legacy API support
4. **Zero configuration** - Sensible defaults, minimal setup
5. **Fast** - Parallel workers, native tools
6. **Pluggable** - Simple protocols enable alternative backends

## Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Host Machine                                                              │
│                                                                           │
│  ┌──────────────┐    ┌──────────────────────────────────────────────────┐ │
│  │ Storybook    │    │ snapvrt CLI (orchestrator)                       │ │
│  │ :6006        │◄───│                                                  │ │
│  └──────────────┘    │  1. Fetch index.json (story discovery)           │ │
│                      │  2. Spawn M screenshot workers                   │ │
│                      │  3. Distribute tasks (round-robin), collect PNGs │ │
│                      │  4. Spawn diff container                         │ │
│                      │  5. Compare against references                   │ │
│                      │  6. Report results                               │ │
│                      └───────────────┬──────────────┬───────────────────┘ │
│                                      │              │                     │
│         ┌────────────────────────────┤              │                     │
│         │                            │              │                     │
│         ▼                            ▼              ▼                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐        │
│  │ Worker 1        │    │ Worker M        │    │ Diff Container  │        │
│  │ (Docker)        │    │ (Docker)        │    │ (Docker)        │        │
│  │                 │    │                 │    │                 │        │
│  │ Chrome          │    │ Chrome          │    │ PNG ─► Score    │        │
│  │ ├─Tab 1 ─► PNG  │    │ ├─Tab 1 ─► PNG  │    │                 │        │
│  │ ├─Tab 2 ─► PNG  │    │ ├─Tab 2 ─► PNG  │    └─────────────────┘        │
│  │ ├─Tab 3 ─► PNG  │    │ ├─Tab 3 ─► PNG  │                               │
│  │ └─Tab N ─► PNG  │    │ └─Tab N ─► PNG  │    Total parallelism:         │
│  └─────────────────┘    └─────────────────┘    M workers × N tabs         │
│                                                                           │
│  .snapvrt/                                                                │
│  ├── reference/  ◄───────────────────────────────────┐                    │
│  ├── current/    ◄── screenshots saved here          │ mounted            │
│  └── difference/ ◄── diff images written here ───────┘                    │
└───────────────────────────────────────────────────────────────────────────┘

Alternative screenshot workers (same protocol):
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ AWS Lambda       │    │ Browserstack     │    │ Local Chrome     │
└──────────────────┘    └──────────────────┘    └──────────────────┘

Alternative diff engines (same protocol):
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ dssim            │    │ pixelmatch       │    │ looks-same       │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Separation of Concerns

| Component              | Responsibility                                |
| ---------------------- | --------------------------------------------- |
| **CLI (orchestrator)** | Story discovery, task distribution, reporting |
| **Screenshot Worker**  | Receive URL → Return PNG buffer               |
| **Diff Container**     | Compare images → Return scores + diff images  |

### Why This Design

- **Docker-first** - Consistent screenshots AND diffs across all platforms
- **Parallelization** - Spawn N screenshot workers for speed
- **Pluggable** - Simple protocols enable alternative backends
- **CLI has context** - Access to git, filesystem, config
- **Workers are stateless** - Just URLs in, PNGs out

## Modules

### CLI & Service (Rust binary, MIT license)

> Design doc: [design/orchestrator.md](design/orchestrator.md)

| Crate/Module  | Responsibility                             |
| ------------- | ------------------------------------------ |
| `cli`         | Command parsing (clap)                     |
| `config`      | Load from .snapvrt/config.toml             |
| `stories`     | Fetch and filter stories from Storybook    |
| `docker`      | Spawn and manage containers (bollard)      |
| `worker_pool` | Distribute tasks to workers                |
| `reporter`    | Terminal output and HTML report generation |
| `service`     | HTTP API server (axum)                     |
| `review`      | Review UI serving                          |

### Screenshot Worker (Rust binary in Docker)

| Module       | Responsibility                    |
| ------------ | --------------------------------- |
| `server`     | HTTP endpoint (axum)              |
| `browser`    | Chrome CDP (chromiumoxide)        |
| `tab_pool`   | Manages N concurrent tabs         |
| `screenshot` | Navigate, wait for ready, capture |

Worker manages tab pooling internally. CLI sends requests; worker assigns to available tab.

### Diff Container (Docker, license varies by engine)

| Module | Responsibility                  |
| ------ | ------------------------------- |
| `diff` | Compare images, output scores   |
| `cli`  | Parse args, process directories |

## Dependencies

> **Note:** All crates listed below are examples. Final choices will be researched and selected based on the finalized architecture.

### CLI (Rust)

| Crate     | Purpose                     | License |
| --------- | --------------------------- | ------- |
| `clap`    | Command line parsing        | MIT     |
| `tokio`   | Async runtime               | MIT     |
| `bollard` | Docker API client           | Apache  |
| `reqwest` | HTTP client                 | MIT     |
| `axum`    | HTTP server (for review UI) | MIT     |
| `serde`   | Serialization               | MIT     |
| `toml`    | Config parsing              | MIT     |

**Why bollard over direct `docker` CLI commands:**

- Single persistent connection to Docker socket (vs N processes for N workers)
- Native async - parallel container operations with no spawn overhead
- Typed API for health checks, log streaming, cleanup
- Better error handling (no output parsing)

### Screenshot Worker (Rust)

| Crate           | Purpose                  | License |
| --------------- | ------------------------ | ------- |
| `axum`          | HTTP server              | MIT     |
| `chromiumoxide` | Chrome DevTools Protocol | MIT     |
| `tokio`         | Async runtime            | MIT     |

Worker starts with tab pool size from env: `SNAPVRT_TABS=4`

### Diff Container

Engine-specific, see Pluggable Engines section.

## Protocols

### Story Discovery

```
GET http://localhost:6006/index.json
```

Response:

```json
{
  "v": 5,
  "entries": {
    "example-button--primary": {
      "type": "story",
      "id": "example-button--primary",
      "name": "Primary",
      "title": "Example/Button",
      "tags": ["dev", "test"],
      "importPath": "./src/components/Button.stories.tsx"
    }
  }
}
```

Filtering:

- Only `type: "story"` (exclude docs)
- Skip stories with `snapvrt-skip` tag

### Worker Protocol

Two separate endpoints for web and PDF content:

#### Web Screenshot

```
POST /screenshot/web
Content-Type: application/json

{
  "url": "http://host.docker.internal:6006/iframe.html?id=button--primary",
  "viewport": { "width": 1366, "height": 768, },
  "deviceScaleFactor": 1
}
```

| Field               | Description                                    |
| ------------------- | ---------------------------------------------- |
| `url`               | Web page URL                                   |
| `viewport.width`    | Viewport width in CSS pixels                   |
| `viewport.height`   | Viewport height in CSS pixels                  |
| `deviceScaleFactor` | Pixel density ratio (1 = standard, 2 = retina) |

#### PDF Screenshot

```
POST /screenshot/pdf
Content-Type: application/json

{
  "url": "http://host.docker.internal:9999/invoice.pdf",
  "dpi": 144,
  "pages": "all",
  "merge": true
}
```

| Field   | Description                                          |
| ------- | ---------------------------------------------------- |
| `url`   | PDF URL                                              |
| `dpi`   | Resolution (72 = low, 144 = high, default: 144)      |
| `pages` | `"all"`, `"1"`, `"1-3"`, `"1,3,5"` (default: all)    |
| `merge` | `true`: single PNG (stacked), `false`: per-page PNGs |

**Response when `merge: true` (default):**

- Single PNG with all pages vertically stacked

**Response when `merge: false`:**

```json
{
  "pages": [
    { "page": 1, "png": "<base64>" },
    { "page": 2, "png": "<base64>" }
  ]
}
```

#### Response (both endpoints)

Success:

```
HTTP 200 OK
Content-Type: image/png
X-Timing-Navigate: <ms>
X-Timing-Render: <ms>
X-Timing-Screenshot: <ms>
X-Pages: <count>

<raw PNG bytes>
```

Error:

```
HTTP 500 Internal Server Error
Content-Type: text/plain

<error message>
```

## Screenshot Capture

### URL Format

CLI derives the container-accessible URL from `storybook_url` config:

| Host Config                 | Container URL                                      |
| --------------------------- | -------------------------------------------------- |
| `http://localhost:6006`     | `http://host.docker.internal:6006/iframe.html?...` |
| `http://127.0.0.1:6006`     | `http://host.docker.internal:6006/iframe.html?...` |
| `http://my-server.com:6006` | `http://my-server.com:6006/iframe.html?...`        |

**Linux note:** `host.docker.internal` requires Docker 20.10+ with `--add-host=host.docker.internal:host-gateway`. The CLI adds this flag automatically when spawning containers.

### Chrome DevTools Protocol Flow

1. Launch Chrome with `--headless --disable-gpu --hide-scrollbars --no-sandbox`
2. Connect via CDP (Chrome DevTools Protocol)
3. For each story:
   a. Create new tab
   b. Inject helper scripts (disable animations, pointer events)
   c. Navigate to story URL
   d. Wait for UI ready (see below)
   e. Get `<body>` bounding box
   f. Capture screenshot cropped to content
   g. Close tab

### Ready Detection

Wait until all conditions are met (with 10s timeout):

1. Network idle (no pending requests for 500ms, ignoring WebSocket/EventSource)
2. Fonts loaded (`document.fonts.ready`)
3. DOM stable (no mutations for 100ms)

**Note:** Long-lived connections (HMR websocket, polling) are excluded from network idle detection to prevent hangs.

### Screenshot Cropping

Crop to `<body>` bounding box, not full viewport. This handles varying component sizes.

### Injected Styles

```css
/* Disable CSS animations/transitions */
*,
*::before,
*::after {
  transition: none !important;
  animation: none !important;
}

/* Disable pointer events (prevent hover states) */
* {
  pointer-events: none !important;
}

/* Hide input carets */
* {
  caret-color: transparent !important;
}
```

## Image Comparison

### Diff Pipeline (Optimized)

Three-phase approach to minimize Docker calls:

```
┌─────────────────────────────────────────────────────────────┐
│ Phase 1: Hash Compare (instant)                             │
│ SHA-256(current) == SHA-256(reference)?                     │
│ ├── Match → DONE (unchanged)                                │
│ └── Differ → Phase 2                                        │
├─────────────────────────────────────────────────────────────┤
│ Phase 2: Fast Pixel Check (in-process, ~5ms)                │
│ Decode PNGs, compare raw pixels                             │
│ ├── Match → DONE (same pixels, different encoding)          │
│ └── Differ → Phase 3                                        │
├─────────────────────────────────────────────────────────────┤
│ Phase 3: Full Diff (Docker, ~50ms)                          │
│ Run diff engine, generate score + diff image                │
│ └── Return { score, diff.png }                              │
└─────────────────────────────────────────────────────────────┘
```

**Why this helps:**

| Scenario                       | Without optimization | With optimization |
| ------------------------------ | -------------------- | ----------------- |
| 100 unchanged (same hash)      | 100 Docker calls     | 0 Docker calls    |
| 100 unchanged (re-encoded PNG) | 100 Docker calls     | 0 Docker calls    |
| 95 unchanged, 5 changed        | 100 Docker calls     | 5 Docker calls    |

**Fast pixel check (Rust, in-process):**

```rust
fn pixels_identical(reference: &Path, current: &Path) -> Result<bool> {
    let ref_img = image::open(reference)?;
    let cur_img = image::open(current)?;

    if ref_img.dimensions() != cur_img.dimensions() {
        return Ok(false);
    }

    Ok(ref_img.as_bytes() == cur_img.as_bytes())
}
```

### Diff Engine

Using [dssim](https://github.com/kornelski/dssim) for perceptual diff (in Docker):

```bash
dssim -o diff.png reference.png current.png
```

- Score of `0` = identical
- Score of `> 0` = difference detected
- Configurable threshold for acceptable variance

## Directory Structure

```
.snapvrt/
├── config.toml
├── .gitignore
├── snapshots/
│   │
│   │ # Single-image snapshots (web, merged PDF)
│   ├── button-primary/
│   │   ├── reference.png        # Baseline (committed)
│   │   ├── current.png          # Current run (ignored)
│   │   └── diff.png             # Difference (ignored)
│   │
│   │ # Per-page snapshots (multi-page PDF)
│   ├── invoice/
│   │   ├── manifest.json        # Metadata (committed)
│   │   ├── reference/           # Baseline pages (committed)
│   │   │   ├── page-001.png
│   │   │   └── page-002.png
│   │   ├── current/             # Current run (ignored)
│   │   │   ├── page-001.png
│   │   │   └── page-002.png
│   │   └── diff/                # Differences (ignored)
│   │       └── page-002.png
│   │
└── report.html                  # Visual comparison report (ignored)
```

### Manifest (Per-Page Snapshots)

Per-page snapshots include a `manifest.json` for metadata and change detection:

```json
{
  "schemaVersion": 1,
  "snapshotName": "invoice",
  "snapshotMode": "per-page",
  "hashAlgorithm": "sha256",
  "lastUpdated": "2024-01-15T10:30:00Z",
  "source": {
    "dpi": 144
  },
  "pages": [
    { "page": 1, "hash": "a1b2c3...", "width": 1700, "height": 2200 },
    { "page": 2, "hash": "d4e5f6...", "width": 1700, "height": 2200 }
  ]
}
```

Benefits:

- **Fast change detection** via hash comparison (skip full image diff if unchanged)
- **Page count tracking** (detect added/removed pages)
- **Dimension tracking** (detect layout changes)

### Page Count Changes

When PDF page count changes between reference and current:

| Scenario         | Handling                                                                      |
| ---------------- | ----------------------------------------------------------------------------- |
| **Page added**   | Create synthetic diff with teal banner: "New page X (not in reference)"       |
| **Page removed** | Create synthetic diff with amber banner: "Missing page X (in reference only)" |
| **Same count**   | Normal image comparison                                                       |

Synthetic diff example:

```
┌─────────────────────────────────┐
│  ████ NEW PAGE 3 ████           │  ← Teal (#1ABC9C)
│  (not in reference)             │
│                                 │
│  [Current page image below]     │
│                                 │
└─────────────────────────────────┘
```

### Filename Padding

Zero-padded page numbers for correct sorting:

| Page Count    | Format         |
| ------------- | -------------- |
| 1-9 pages     | `page-1.png`   |
| 10-99 pages   | `page-01.png`  |
| 100-999 pages | `page-001.png` |

Padding adjusts when page count crosses digit boundaries.

### Atomic Writes

All file writes use atomic operations (temp file + rename) to prevent partial artifacts:

```rust
// Write to temp file first
let temp = path.with_extension("tmp");
fs::write(&temp, data)?;

// Atomic rename
fs::rename(&temp, &path)?;
```

### Git Strategy

Reference snapshots are committed; transient files are ignored.

`.snapvrt/.gitignore`:

```
**/current/
**/current.png
**/diff/
**/diff.png
report.html
```

### Init Command

`snapvrt init` creates the directory structure, gitignore, and config:

```bash
$ snapvrt init
Created .snapvrt/
Created .snapvrt/config.toml
Created .snapvrt/captureshots/
Created .snapvrt/.gitignore
Ready! Run 'snapvrt update' to capture initial screenshots.
```

## Configuration

Config in `.snapvrt/config.toml`:

```toml
storybook_url = "http://localhost:6006"
diff_engine = "dssim"

# Parallelism: workers × tabs_per_worker
workers = 1           # Docker containers to spawn
tabs_per_worker = 4   # Concurrent browser tabs per worker

[viewports.desktop]
width = 1366
height = 768

[viewports.mobile]
width = 375
height = 667
device_scale_factor = 2

[engine_options.dssim]
threshold = 0.0001

[engine_options.pixelmatch]
threshold = 0.1
include_aa = false
```

### Options

| Option            | Default                 | Description                        |
| ----------------- | ----------------------- | ---------------------------------- |
| `storybook_url`   | `http://localhost:6006` | Storybook server URL               |
| `workers`         | `1`                     | Number of worker containers        |
| `tabs_per_worker` | `4`                     | Concurrent browser tabs per worker |
| `diff_engine`     | `dssim`                 | Diff engine to use                 |
| `viewports`       | `{ desktop: {...} }`    | Viewport configurations            |
| `engine_options`  | `{}`                    | Per-engine configuration           |

**Parallelism:** Total = `workers` × `tabs_per_worker` (default: 1 × 4 = 4)

## Installation

### npm (recommended for Storybook projects)

```bash
npm install -D snapvrt
```

Uses platform-specific packages with prebuilt Rust binaries:

```
snapvrt
├── optionalDependencies:
│   ├── @snapvrt/cli-darwin-arm64
│   ├── @snapvrt/cli-darwin-x64
│   ├── @snapvrt/cli-linux-x64
│   └── @snapvrt/cli-win32-x64
```

### Standalone

```bash
# macOS
brew install snapvrt

# Linux
curl -fsSL https://snapvrt.dev/install.sh | sh

# Cargo
cargo install snapvrt
```

### Requirements

- Docker (for screenshot workers and diff containers)

Docker images are pulled automatically on first run.

## CLI Commands

| Command                              | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `snapvrt init`                       | Initialize project (create dirs, gitignore) |
| `snapvrt test`                       | Run tests, compare against references       |
| `snapvrt test --storybook-dir <dir>` | Use static build (see Static Builds below)  |
| `snapvrt update`                     | Capture new reference screenshots           |
| `snapvrt approve [story-id]`         | Copy current to reference (accept changes)  |
| `snapvrt review`                     | Interactive review UI (see below)           |

## Static Builds

With `--storybook-dir`, snapvrt serves the static build locally:

```bash
snapvrt test --storybook-dir ./storybook-static
```

1. CLI starts an HTTP server on an available port (e.g., 9222)
2. Serves the static build directory
3. Workers connect to `http://host.docker.internal:9222/...`
4. Server shuts down after test run completes

This avoids needing a running Storybook dev server.

## Interactive Review

`snapvrt review` launches an interactive UI for reviewing and approving changes:

```bash
$ snapvrt review
Starting review server on http://localhost:4040
Opening browser...

Press Ctrl+C to exit
```

### How It Works

1. CLI starts local HTTP server on available port
2. Opens browser to review UI
3. UI communicates with server via HTTP/WebSocket
4. Approve actions trigger file operations on server
5. Server exits on Ctrl+C or when browser tab closes

### Server Endpoints

| Endpoint                  | Method | Description                         |
| ------------------------- | ------ | ----------------------------------- |
| `/`                       | GET    | Serve review UI                     |
| `/api/stories`            | GET    | List all stories with status        |
| `/api/images/:type/:name` | GET    | Serve reference/current/diff images |
| `/api/approve/:story-id`  | POST   | Copy current → reference for story  |
| `/api/approve-all`        | POST   | Approve all pending changes         |
| `/ws`                     | WS     | Live updates when files change      |

### UI Actions

| Action            | Effect                                      |
| ----------------- | ------------------------------------------- |
| **[Approve]**     | POST to server, updates reference instantly |
| **[Approve All]** | Approves all failures, refreshes UI         |
| **[Reject]**      | Deletes current screenshot                  |
| **Close tab**     | Server detects disconnect, exits            |

## HTML Report (Static)

For CI or sharing, `snapvrt test` also generates a static HTML report:

```
.snapvrt/report.html
```

### Features

| Feature              | Description                                        |
| -------------------- | -------------------------------------------------- |
| **Side-by-side**     | Reference, current, and diff images in columns     |
| **Overlay toggle**   | Switch between side-by-side and overlay comparison |
| **Filter by status** | Show all / failures only / passed only             |
| **Keyboard nav**     | Arrow keys to navigate between stories             |
| **Search**           | Filter stories by name                             |

### Layout

```
┌─────────────────────────────────────────────────────────────────┐
│ snapvrt Report                          [All] [Failed] [Passed] │
├─────────────────────────────────────────────────────────────────┤
│ Search: [________________]                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ✗ Button/Primary (desktop)                                      │
│ ┌─────────────┐ ┌─────────────┐ ┌─────────────┐                 │
│ │  Reference  │ │   Current   │ │    Diff     │                 │
│ │             │ │             │ │             │                 │
│ └─────────────┘ └─────────────┘ └─────────────┘                 │
│                                                                 │
│ ✓ Button/Secondary (desktop)                                    │
│ ┌─────────────┐ ┌─────────────┐                                 │
│ │  Reference  │ │   Current   │  (no diff - identical)          │
│ └─────────────┘ └─────────────┘                                 │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Note:** Static report is view-only. Use `snapvrt review` for interactive approval, or `snapvrt approve` CLI command.

### Self-contained

The HTML report is a single file with:

- Embedded CSS (no external stylesheets)
- Inline images (base64 encoded)
- Vanilla JS (no framework dependencies)

This allows easy sharing and viewing without a web server.

## Docker Configuration

> **Note:** Flags below are based on loki's working configuration. Review and adjust as needed.

### Container Launch

CLI uses bollard (Docker API) to spawn containers. Equivalent `docker run` for reference:

```bash
docker run \
  --rm \
  -d \
  --shm-size=1g \
  --security-opt=seccomp=unconfined \
  --add-host=host.docker.internal:host-gateway \
  -e SNAPVRT_TABS=4 \
  -p ${PORT}:3000 \
  snapvrt/capture
```

| Flag                                  | Purpose                                        |
| ------------------------------------- | ---------------------------------------------- |
| `--rm`                                | Auto-remove container on exit                  |
| `-d`                                  | Run detached                                   |
| `--shm-size=1g`                       | Chrome needs shared memory for stability       |
| `--security-opt=seccomp=unconfined`   | Chrome sandboxing workaround (review security) |
| `--add-host=host.docker.internal:...` | Linux: map hostname to host gateway            |
| `-e SNAPVRT_TABS=4`                   | Number of concurrent browser tabs              |
| `-p ${PORT}:3000`                     | Map worker HTTP port                           |

### Chrome Launch (inside container)

```bash
chromium \
  --headless \
  --disable-gpu \
  --hide-scrollbars \
  --no-sandbox \
  --disable-dev-shm-usage \
  --remote-debugging-address=0.0.0.0 \
  --remote-debugging-port=9222
```

| Flag                         | Purpose                                    |
| ---------------------------- | ------------------------------------------ |
| `--headless`                 | No UI                                      |
| `--disable-gpu`              | Avoid GPU issues in containers             |
| `--hide-scrollbars`          | Consistent screenshots                     |
| `--no-sandbox`               | Required when running as root in container |
| `--disable-dev-shm-usage`    | Use /tmp instead of /dev/shm               |
| `--remote-debugging-address` | Allow external CDP connections             |
| `--remote-debugging-port`    | CDP port                                   |

## Docker Images

### Screenshot Worker

Contains Rust binary + Chrome. Minimal image size (no Node.js runtime).

```dockerfile
FROM debian:bookworm-slim

# Install Chrome and fonts
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    fonts-noto-color-emoji \
    && rm -rf /var/lib/apt/lists/*

# Copy pre-built Rust binary
COPY target/release/capture /usr/local/bin/

EXPOSE 3000
ENTRYPOINT ["capture"]
```

### Diff Container (dssim example)

```dockerfile
FROM rust:alpine AS builder
RUN cargo install dssim

FROM alpine:latest
COPY --from=builder /usr/local/cargo/bin/dssim /usr/local/bin/
COPY target/release/snapvrt-diff /usr/local/bin/

ENTRYPOINT ["snapvrt-diff"]
```

### Image Comparison

Diff tool runs in Docker for consistency across dev machines and CI.

#### Diff Protocol

Single container processes all images at once (avoids container startup overhead):

```bash
docker run --rm \
  -v .snapvrt:/work \
  snapvrt/diff-dssim \
  --reference /work/reference \
  --current /work/current \
  --output /work/difference \
  --threshold 0.0001
```

Output (JSON to stdout):

```json
{
  "results": [
    { "name": "button-primary.png", "score": 0, "match": true },
    { "name": "button-secondary.png", "score": 0.00042, "match": false }
  ],
  "summary": { "total": 2, "passed": 1, "failed": 1 }
}
```

Diff images written to `--output` directory only for failures.

#### Pluggable Engines

Separate Docker images per engine (avoids license conflicts):

| Engine        | Image                      | License    | Notes                    |
| ------------- | -------------------------- | ---------- | ------------------------ |
| `dssim`       | `snapvrt/diff-dssim`       | AGPL-3.0   | Perceptual, human vision |
| `pixelmatch`  | `snapvrt/diff-pixelmatch`  | ISC        | Fast, pixel-by-pixel     |
| `imagemagick` | `snapvrt/diff-imagemagick` | Apache-2.0 | Various algorithms       |
| `looks-same`  | `snapvrt/diff-lookssame`   | MIT        | Antialiasing-tolerant    |

All images implement the same protocol - only the comparison algorithm differs.

Configure engine in `.snapvrt/config.toml` (see Configuration section).

### Reusable Diff Container

The diff container is designed for reuse beyond snapvrt. Any tool needing consistent cross-platform image comparison can use it:

```bash
# From snapvrt (Rust)
docker run snapvrt/diff-dssim --reference a.png --current b.png

# From pdf-visual-diff (Node.js)
const { execSync } = require('child_process');
execSync('docker run snapvrt/diff-dssim ...');

# From any language
POST http://localhost:3001/diff { reference, current } → { score, diff }
```

Potential consumers:

- **snapvrt** - Storybook visual regression
- **pdf-visual-diff** - PDF visual regression
- **Other tools** - Any image comparison needing cross-platform consistency

## Project Structure

```
snapvrt/
├── Cargo.toml              # Workspace
├── crates/
│   ├── snapvrt/            # CLI binary (published to crates.io)
│   │   ├── Cargo.toml
│   │   └── src/
│   │       ├── main.rs
│   │       ├── cli.rs
│   │       ├── config.rs
│   │       ├── stories.rs
│   │       ├── docker.rs
│   │       ├── worker_pool.rs
│   │       ├── reporter.rs
│   │       └── review.rs
│   └── capture/            # Capture worker (internal, Docker only)
│       ├── Cargo.toml
│       └── src/
│           ├── main.rs
│           ├── server.rs
│           └── screenshot.rs
├── docker/
│   ├── capture/
│   │   └── Dockerfile
│   └── diff/
│       ├── dssim/
│       │   └── Dockerfile
│       ├── pixelmatch/
│       │   └── Dockerfile
│       ├── lookssame/
│       │   └── Dockerfile
│       └── imagemagick/
│           └── Dockerfile
├── packages/               # npm packages
│   ├── snapvrt/            # Main npm package
│   ├── client/             # @snapvrt/client
│   └── jest/               # @snapvrt/jest
└── web/                    # Review UI (static HTML/CSS/JS)
    └── index.html
```

## Exit Codes

| Code | Meaning                               |
| ---- | ------------------------------------- |
| 0    | All tests passed                      |
| 1    | Visual differences detected           |
| 2    | Error (config, Docker, network, etc.) |

## Service Mode

snapvrt can run as a long-running service for integration with test frameworks (Jest, Vitest, etc.).

### Use Case

- **Batch mode (CLI):** `snapvrt test` - Storybook screenshots, runs once
- **Service mode:** `snapvrt service start` - Long-running, serves test assertions

Service mode enables fast assertions without container startup per test.

### Starting the Service

```bash
# From project root (reads .snapvrt/config.toml)
snapvrt service start

# Service manages:
# - .snapvrt/reference/    (reads)
# - .snapvrt/current/      (writes)
# - .snapvrt/difference/   (writes on mismatch)
```

### Service API

| Endpoint       | Method | Input                                 | Description                        |
| -------------- | ------ | ------------------------------------- | ---------------------------------- |
| `/health`      | GET    | -                                     | Health check                       |
| `/compare/web` | POST   | `{ name, url, viewport }`             | Screenshot URL + compare           |
| `/compare/pdf` | POST   | `{ name, pdf, dpi?, pages?, merge? }` | Screenshot PDF + compare           |
| `/update/web`  | POST   | `{ name, url, viewport }`             | Screenshot URL + save as reference |
| `/update/pdf`  | POST   | `{ name, pdf, dpi?, pages? }`         | Screenshot PDF + save as reference |
| `/approve`     | POST   | `{ name }`                            | Copy current → reference           |
| `/approve-all` | POST   | -                                     | Approve all pending                |
| `/status`      | GET    | -                                     | List pending diffs                 |

### Compare Flow

**Single-image (web, merged PDF):**

```
POST /compare/web { name: "button-primary", url, viewport }

1. Screenshot URL → PNG
2. Save to snapshots/button-primary/current.png
3. Compare with snapshots/button-primary/reference.png
4. If mismatch: write diff.png
5. Return { match: false, score: 0.0042 }
```

**Per-page (PDF with merge: false):**

```
POST /compare/pdf { name: "invoice", pdf, merge: false }

1. Render PDF → page PNGs
2. Load manifest.json (page hashes, count)
3. For each page:
   a. Compute hash, compare with manifest
   b. If hash matches → skip (fast path)
   c. If hash differs → full image diff
4. Handle page count changes (added/removed)
5. Update manifest with new hashes
6. Return { match: false, pages: [...] }
```

### JavaScript Client

Lightweight client (~50 lines, no native deps):

```javascript
// @snapvrt/client
import { compareWeb, comparePdf, approve } from '@snapvrt/client';

// Compare web page against snapshot
const result = await compareWeb({
  name: 'button-primary',
  url: 'http://localhost:6006/iframe.html?id=button--primary',
  viewport: { width: 1366, height: 768 },
});
// { match: true, score: 0 }

// Compare PDF against snapshot (merged)
const result = await comparePdf({
  name: 'invoice',
  pdf: pdfBuffer,
  dpi: 144,
});
// { match: false, score: 0.0042 }

// Compare PDF per-page (separate snapshots)
const result = await comparePdf({
  name: 'report',
  pdf: pdfBuffer,
  merge: false,
});
// Result:
// {
//   match: false,
//   pages: [
//     { page: 1, match: true, skipped: true },      // Hash unchanged, skipped
//     { page: 2, match: false, score: 0.0012 },     // Changed, diff generated
//     { page: 3, status: 'added' },                 // New page in current
//   ],
//   pagesAdded: 1,
//   pagesRemoved: 0
// }

// Approve pending change
await approve({ name: 'invoice' });
```

### Jest Integration

```javascript
// @snapvrt/jest
import { toMatchPdfSnapshot, toMatchWebSnapshot } from '@snapvrt/jest';
expect.extend({ toMatchPdfSnapshot, toMatchWebSnapshot });

test('invoice renders correctly', async () => {
  const pdf = await generateInvoice();

  // Merged (default) - single snapshot
  await expect(pdf).toMatchPdfSnapshot();

  // Per-page - separate snapshots for each page
  await expect(pdf).toMatchPdfSnapshot({ merge: false });
  // Creates: invoice-renders-correctly-page-1.png, etc.
});

test('button primary', async () => {
  await expect(
    'http://localhost:6006/iframe.html?id=button--primary'
  ).toMatchWebSnapshot({ viewport: { width: 1366, height: 768 } });
});
```

### Workflow

```bash
# 1. Start service (once)
snapvrt service start

# 2. Run tests (many compare calls, fast)
npm test

# 3. Review failures
snapvrt review

# 4. Approve or fix
snapvrt approve invoice
snapvrt approve --all

# 5. Stop service
snapvrt service stop
```

### CLI Commands (Service)

| Command                  | Description                          |
| ------------------------ | ------------------------------------ |
| `snapvrt service start`  | Start long-running service           |
| `snapvrt service stop`   | Stop service                         |
| `snapvrt service status` | Check if running, show pending diffs |

### Packages

| Package           | Description                        |
| ----------------- | ---------------------------------- |
| `snapvrt`         | Rust CLI (npm binary distribution) |
| `@snapvrt/client` | JS client for service API          |
| `@snapvrt/jest`   | Jest matchers                      |
| `@snapvrt/vitest` | Vitest matchers (future)           |

### Benefits

| Benefit                  | Explanation                                |
| ------------------------ | ------------------------------------------ |
| **Fast assertions**      | HTTP call vs container startup per test    |
| **Consistent rendering** | Chrome (Docker) renders PDFs + URLs        |
| **Consistent diffs**     | Same diff container for all comparisons    |
| **Unified workflow**     | Same `snapvrt review` for Storybook + PDFs |
| **Light JS client**      | No native dependencies in test code        |

## Extensibility

### Required Traits

Define abstractions upfront for future backends (implement only Docker in v1):

```rust
/// Screenshot capture backend
trait ScreenshotBackend: Send + Sync {
    async fn start(&self, count: usize) -> Result<()>;
    async fn capture(&self, req: ScreenshotRequest) -> Result<Png>;
    async fn shutdown(&self) -> Result<()>;
}

/// Image comparison backend
trait DiffBackend: Send + Sync {
    async fn compare(&self, reference: &Path, current: &Path) -> Result<DiffResult>;
}
```

**v1 implementations:** `DockerScreenshotBackend`, `DockerDiffBackend`

### Future Backends

The simple protocols enable alternative implementations:

| Backend      | Screenshots | Diffs  | Use Case                              |
| ------------ | ----------- | ------ | ------------------------------------- |
| Docker (v1)  | ✅          | ✅     | Default, consistent                   |
| Local Chrome | Future      | -      | Faster dev iteration                  |
| AWS Lambda   | Future      | -      | Scale to thousands                    |
| WASM         | -           | Future | Docker-free (pairs with Local Chrome) |

**Note:** WASM diffs only make sense if non-Docker screenshots are added. If Docker is already required, Docker diffs are faster.

### Remote Worker URL Access (Future)

Remote workers (Lambda, Browserstack) cannot access `localhost`. Solutions:

| Scenario                                    | Resolution                         |
| ------------------------------------------- | ---------------------------------- |
| `storybook_url` is public                   | Use directly                       |
| `storybook_url` is localhost + static build | Upload to S3/temp hosting          |
| `storybook_url` is localhost + dev server   | Require public URL or static build |

CLI resolves URL before passing to backend:

```rust
impl ScreenshotBackend for LambdaBackend {
    async fn start(&self, config: WorkerConfig) -> Result<()> {
        // config.storybook_url already resolved:
        // - "http://localhost:6006" → error or auto-upload static
        // - "https://staging.example.com" → use directly
        // - static build → uploaded to S3, URL provided
    }
}
```

Design constraint: backends receive **resolved URLs**, not raw config. URL resolution happens in CLI before spawning workers.

### Local Chrome Detection (Future)

When local Chrome backend is added, detection order:

1. Config: `chrome_path = "/path/to/chrome"`
2. Env: `SNAPVRT_CHROME_PATH`
3. Platform-specific common locations
4. PATH lookup
5. Error with helpful message

## Project Infrastructure

### Branding

| Element     | Value               |
| ----------- | ------------------- |
| **Name**    | snapvrt             |
| **Tagline** | "Snap. Test. Ship." |

**Tagline placement:**

| Location            | Format                                                       |
| ------------------- | ------------------------------------------------------------ |
| GitHub README       | `# snapvrt` <br> `Snap. Test. Ship.`                         |
| npm description     | "Visual regression testing for Storybook. Snap. Test. Ship." |
| Landing page hero   | Large heading with tagline                                   |
| `snapvrt --version` | `snapvrt 0.1.0 - Snap. Test. Ship.`                          |

### Repository

| Platform         | Location             |
| ---------------- | -------------------- |
| **GitHub org**   | `snapvrt`            |
| **Repository**   | `snapvrt/capturevrt` |
| **GitHub Pages** | `snapvrt.github.io`  |

Product-focused org for clean branding. Personal credit via contributions visible on your GitHub profile.

### Packages

| Registry       | Namespace  | Examples                                           |
| -------------- | ---------- | -------------------------------------------------- |
| **npm**        | `@snapvrt` | `@snapvrt/cli`, `@snapvrt/client`, `@snapvrt/jest` |
| **Docker Hub** | `snapvrt`  | `snapvrt/capture`, `snapvrt/diff-dssim`            |
| **crates.io**  | `snapvrt`  | `snapvrt`                                          |

All namespaces unified under `snapvrt`.

### Domain (Future)

| Domain        | Purpose              | Priority                    |
| ------------- | -------------------- | --------------------------- |
| `snapvrt.dev` | Product landing/docs | When project gains traction |

Start with GitHub Pages. Add custom domain when/if needed.

### Hosting Strategy

| Phase           | Hosting                      | URL                 |
| --------------- | ---------------------------- | ------------------- |
| **Initial**     | GitHub Pages                 | `snapvrt.github.io` |
| **With domain** | GitHub Pages + custom domain | `snapvrt.dev`       |
| **Growth**      | Vercel/Netlify (if needed)   | `snapvrt.dev`       |

## Published Artifacts

### crates.io

| Crate     | Purpose    | Install                 |
| --------- | ---------- | ----------------------- |
| `snapvrt` | CLI binary | `cargo install snapvrt` |

### npm

**Main package (unscoped):**

| Package   | Purpose                                          | Install                  |
| --------- | ------------------------------------------------ | ------------------------ |
| `snapvrt` | Main package, downloads platform-specific binary | `npm install -D snapvrt` |

**Platform binaries (optionalDependencies of `snapvrt`):**

| Package                     | Platform          |
| --------------------------- | ----------------- |
| `@snapvrt/cli-darwin-arm64` | macOS ARM (M1/M2) |
| `@snapvrt/cli-darwin-x64`   | macOS Intel       |
| `@snapvrt/cli-linux-x64`    | Linux x64         |
| `@snapvrt/cli-linux-arm64`  | Linux ARM64       |
| `@snapvrt/cli-win32-x64`    | Windows x64       |

**JavaScript libraries (scoped):**

| Package           | Purpose                   |
| ----------------- | ------------------------- |
| `@snapvrt/client` | JS client for service API |
| `@snapvrt/jest`   | Jest matchers             |
| `@snapvrt/vitest` | Vitest matchers (future)  |

### Docker Hub

**Capture worker:**

| Image             | Purpose                                  |
| ----------------- | ---------------------------------------- |
| `snapvrt/capture` | Screenshot worker (Chrome + Rust binary) |

**Diff engines:**

| Image                      | Engine      | License    |
| -------------------------- | ----------- | ---------- |
| `snapvrt/diff-dssim`       | dssim       | AGPL-3.0   |
| `snapvrt/diff-pixelmatch`  | pixelmatch  | ISC        |
| `snapvrt/diff-lookssame`   | looks-same  | MIT        |
| `snapvrt/diff-imagemagick` | imagemagick | Apache-2.0 |

### GitHub Releases

| Asset                         | Description        |
| ----------------------------- | ------------------ |
| `snapvrt-darwin-arm64.tar.gz` | macOS ARM binary   |
| `snapvrt-darwin-x64.tar.gz`   | macOS Intel binary |
| `snapvrt-linux-x64.tar.gz`    | Linux x64 binary   |
| `snapvrt-linux-arm64.tar.gz`  | Linux ARM64 binary |
| `snapvrt-win32-x64.zip`       | Windows x64 binary |
| `checksums.txt`               | SHA256 checksums   |

### Homebrew (Future)

| Formula   | Tap                                                   |
| --------- | ----------------------------------------------------- |
| `snapvrt` | `snapvrt/tap` (initially), homebrew-core (if popular) |

## Out of Scope (Initial Release)

- Storybook < 10
- React Native / mobile apps
- Non-Docker backends (traits defined, implementations future)
- Incremental testing / TurboSnap-style `--changed-since` (git-based story filtering)
