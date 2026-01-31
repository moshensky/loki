# eyediff Specification

## Overview

Opinionated visual regression testing for Storybook 10+.

## Design Principles

1. **Docker-first** - Workers run in containers for consistency
2. **Storybook 10 only** - No legacy API support
3. **Zero configuration** - Sensible defaults, minimal setup
4. **Fast** - Parallel workers, native diff tools
5. **Pluggable** - Simple worker protocol enables alternative backends

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Host Machine                                                            │
│                                                                         │
│  ┌──────────────┐    ┌────────────────────────────────────────────────┐ │
│  │ Storybook    │    │ eyediff CLI (orchestrator)                     │ │
│  │ :6006        │◄───│                                                │ │
│  └──────────────┘    │  1. Fetch index.json (story discovery)         │ │
│                      │  2. Prepare screenshot tasks                   │ │
│                      │  3. Spawn worker(s)                            │ │
│                      │  4. Distribute tasks to workers                │ │
│                      │  5. Collect screenshot results                 │ │
│                      │  6. Diff against references (dssim)            │ │
│                      │  7. Report results                             │ │
│                      └──────────────┬─────────────────────────────────┘ │
│                                     │                                   │
│            ┌────────────────────────┼────────────────────────┐          │
│            ▼                        ▼                        ▼          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐   │
│  │ Worker 1         │    │ Worker 2         │    │ Worker N         │   │
│  │ (Docker)         │    │ (Docker)         │    │ (Docker)         │   │
│  │ Chrome ─► PNG    │    │ Chrome ─► PNG    │    │ Chrome ─► PNG    │   │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘

Alternative workers (same protocol):
┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ AWS Lambda       │    │ Browserstack     │    │ Local Chrome     │
└──────────────────┘    └──────────────────┘    └──────────────────┘
```

### Separation of Concerns

| Component              | Responsibility                                         |
| ---------------------- | ------------------------------------------------------ |
| **CLI (orchestrator)** | Story discovery, task distribution, diffing, reporting |
| **Worker**             | Receive URL → Screenshot → Return PNG buffer           |

### Why This Design

- **Parallelization** - Spawn N workers locally for speed
- **Pluggable workers** - Docker, Lambda, remote service, cloud browsers
- **CLI has context** - Access to git, filesystem, config, references
- **Workers are stateless** - No filesystem access needed, just URLs in, PNGs out
- **Diffing on host** - No need to transfer reference images to workers

## Modules

### CLI (npm package: `eyediff`)

| Module        | Responsibility                              |
| ------------- | ------------------------------------------- |
| `cli`         | Command parsing, entry point                |
| `config`      | Load from package.json or eyediff.config.js |
| `stories`     | Fetch and filter stories from Storybook     |
| `turbosnap`   | Detect changed stories via git diff         |
| `worker-pool` | Spawn, manage, and distribute tasks         |
| `diff`        | Compare screenshots using dssim             |
| `reporter`    | Output results to terminal                  |

### Worker (Docker image)

| Module       | Responsibility                        |
| ------------ | ------------------------------------- |
| `server`     | HTTP endpoint for screenshot requests |
| `browser`    | Chrome CDP connection and management  |
| `screenshot` | Navigate, wait for ready, capture     |

## Dependencies

> **Note:** All external tools and dependencies listed below are examples. Final choices will be researched and selected based on the finalized specification and architecture.

### CLI

| Dependency    | Purpose                              |
| ------------- | ------------------------------------ |
| `dssim`       | Perceptual image diff (prebuilt bin) |
| `dockerode`   | Spawn and manage Docker containers   |
| `cosmiconfig` | Load configuration                   |

### Worker

| Dependency                | Purpose           |
| ------------------------- | ----------------- |
| `chromium`                | Headless browser  |
| `puppeteer-core` or `cri` | CDP communication |

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
      "tags": ["dev", "test"]
      "importPath": "./src/components/Button.stories.tsx"
    }
  }
}
```

Filtering:

- Only `type: "story"` (exclude docs)
- Skip stories with `eyediff-skip` tag
- With `--changed-since`: match `importPath` against git diff

### Worker Protocol

Request:

```
POST /screenshot
Content-Type: application/json

{
  "url": "<storybook iframe URL>",
  "viewport": { "width": 1366, "height": 768, "deviceScaleFactor": 1 }
}
```

Success:

```
HTTP 200 OK
Content-Type: image/png
X-Timing-Navigate: <ms>
X-Timing-Render: <ms>
X-Timing-Screenshot: <ms>

<raw PNG bytes>
```

Error:

```
HTTP 500 Internal Server Error
Content-Type: text/plain

<error message>
```

### Screenshot URL Format

```

### Worker Lifecycle

```bash
# CLI spawns worker
docker run -d -p 3000:3000 ghcr.io/oblador/eyediff-worker

# CLI sends tasks
curl -X POST http://localhost:3000/screenshot -d '{"url": "...", "viewport": {...}}'

# CLI stops worker when done
docker stop <container_id>
```

## Screenshot Capture

### URL Format

```
http://host.docker.internal:6006/iframe.html?id={storyId}&viewMode=story
```

### Chrome DevTools Protocol Flow

1. Launch Chrome with `--headless --disable-gpu --hide-scrollbars`
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

Wait until all conditions are met:

```javascript
await Promise.all([
  // Network idle (no pending requests for 500ms)
  page.waitForNetworkIdle({ idleTime: 500 }),

  // Fonts loaded
  page.evaluate(() => document.fonts.ready),

  // No pending CSS animations
  page.evaluate(() =>
    getComputedStyle(document.body).animationName === 'none'
  ),
]);

// Additional quiet period (DOM mutations settled)
await waitForDomStable(page, { timeout: 1000 });
```

### Screenshot Cropping

Crop to `<body>` bounding box instead of fixed selector:

```javascript
const box = await page.evaluate(() => {
  const body = document.body;
  const rect = body.getBoundingClientRect();
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height
  };
});

await page.screenshot({ clip: box });
```

This handles varying component sizes without requiring a specific selector.

### Injected Scripts

```javascript
// Disable CSS animations/transitions
*, :before, :after {
  transition: none !important;
  animation: none !important;
}

// Disable pointer events (prevent hover states)
* { pointer-events: none !important; }

// Hide input carets
* { caret-color: transparent !important; }
```

## Image Comparison

Using [dssim](https://github.com/kornelski/dssim) for perceptual diff:

```bash
dssim -o diff.png reference.png current.png
```

- Score of `0` = identical
- Score of `> 0` = difference detected
- Configurable threshold for acceptable variance

## Directory Structure

```
.eyediff/
├── reference/           # Baseline screenshots
│   ├── chrome_laptop_Button_Primary.png
│   └── chrome_laptop_Button_Secondary.png
├── current/             # Current test run
│   └── ...
└── difference/          # Diff images (on failure)
    └── ...
```

## Configuration

Config in `package.json` or `eyediff.config.js`:

```json
{
  "eyediff": {
    "storybookUrl": "http://localhost:6006",
    "concurrency": 4,
    "diffThreshold": 0,
    "viewports": {
      "desktop": {
        "width": 1366,
        "height": 768
      },
      "mobile": {
        "width": 375,
        "height": 667,
        "mobile": true,
        "deviceScaleFactor": 2
      }
    }
  }
}
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `storybookUrl` | `http://localhost:6006` | Storybook server URL |
| `concurrency` | `4` | Number of parallel workers |
| `diffThreshold` | `0` | Acceptable dssim score (0 = exact match) |
| `viewports` | `{ desktop: {...} }` | Viewport configurations |
| `referenceDir` | `.eyediff/reference` | Baseline screenshots |
| `currentDir` | `.eyediff/current` | Current run screenshots |
| `diffDir` | `.eyediff/diff` | Diff images |

## CLI Commands

| Command                              | Description                                |
| ------------------------------------ | ------------------------------------------ |
| `eyediff test`                       | Run tests, compare against references      |
| `eyediff test --changed-since <ref>` | Only test stories affected by git changes  |
| `eyediff test --storybook-dir <dir>` | Use static build instead of live server    |
| `eyediff update`                     | Capture new reference screenshots          |
| `eyediff approve`                    | Copy current to reference (accept changes) |

## Incremental Testing (TurboSnap-style)

With `--changed-since`, eyediff only captures stories affected by code changes:

```bash
eyediff test --changed-since main
```

### How it works

1. Get list of changed files: `git diff --name-only main`
2. Parse `index.json` to get story → file mappings (`importPath`)
3. Only test stories whose `importPath` is in the changed files list
4. Reuse existing reference for unchanged stories

### Example

```
Changed files:
  src/components/Button.tsx
  src/components/Button.stories.tsx

Stories to test:
  ✓ example-button--primary     (importPath matches)
  ✓ example-button--secondary   (importPath matches)
  ⊘ example-header--default     (skipped, no changes)
  ⊘ example-page--logged-in     (skipped, no changes)
```

## Concurrency

```bash
# Default: 4 parallel workers
npx eyediff test

# Custom concurrency
npx eyediff test --concurrency 8
```

### Worker Pool

```javascript
class WorkerPool {
  constructor(concurrency) {
    this.workers = [];
    this.queue = [];
    this.concurrency = concurrency;
  }

  async spawn() {
    for (let i = 0; i < this.concurrency; i++) {
      const port = 3000 + i;
      const container = await docker.run({
        image: 'ghcr.io/oblador/eyediff-worker',
        ports: [`${port}:3000`],
        network: 'host.docker.internal:host-gateway'
      });
      this.workers.push({ port, container });
    }
  }

  async execute(task) {
    const worker = await this.getAvailableWorker();
    const result = await fetch(`http://localhost:${worker.port}/screenshot`, {
      method: 'POST',
      body: JSON.stringify(task)
    });
    return result.json();
  }

  async shutdown() {
    await Promise.all(this.workers.map(w => docker.stop(w.container)));
  }
}
```

## Exit Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | All tests passed                              |
| 1    | Visual differences detected                   |
| 2    | Error (stories not found, Chrome crash, etc.) |

## Worker Docker Image

Published to `ghcr.io/oblador/eyediff-worker`. Contains Chrome and HTTP screenshot service.

```dockerfile
FROM node:24

# Install Chrome
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    xdg-utils \
    && rm -rf /var/lib/apt/lists/*

# Copy worker source
WORKDIR /app
COPY worker/src ./src
COPY worker/package.json .
RUN npm install --production

EXPOSE 3000
ENTRYPOINT ["node", "/app/src/server.js"]
```

Note: dssim runs on the **host**. The npm package includes prebuilt binaries for:
- macOS (arm64, x64)
- Linux (x64)
- Windows (x64)

## Package Structure

```
eyediff/
├── bin/
│   └── eyediff              # CLI entry point
├── src/
│   ├── cli.js               # Command parsing
│   ├── runner.js            # Test orchestration
│   ├── stories.js           # Fetch from index.json
│   ├── worker-manager.js    # Spawn/manage Docker workers
│   ├── diff.js              # dssim wrapper
│   └── reporter.js          # Output results
├── worker/
│   ├── Dockerfile
│   ├── package.json
│   └── src/
│       ├── server.js        # HTTP server
│       └── screenshot.js    # Chrome CDP logic
└── package.json
```

## CLI Flow

```javascript
#!/usr/bin/env node

async function main() {
  // 1. Load config
  const config = await loadConfig();

  // 2. Discover stories
  const stories = await fetchStories(config.storybookUrl);

  // 3. Filter (--changed-since, tags)
  const filtered = filterStories(stories, options);

  // 4. Prepare tasks
  const tasks = prepareTasksForViewports(filtered, config.viewports);

  // 5. Spawn workers
  const workers = await spawnWorkers(config.concurrency);

  // 6. Distribute tasks and collect screenshots
  const results = await executeTasksInParallel(tasks, workers);

  // 7. Diff against references
  const diffs = await diffResults(results, config.referenceDir);

  // 8. Report
  report(diffs);

  // 9. Cleanup
  await stopWorkers(workers);
}
```

## Future: Alternative Workers

The worker protocol is simple enough to implement anywhere:

```
POST /screenshot { url, viewport } → 200 <PNG bytes>
```

Potential workers:
- **AWS Lambda** - Serverless, scales to thousands
- **Browserstack/Sauce Labs** - Real browsers, cross-browser testing
- **Local Chrome** - No Docker, direct CDP connection
- **Playwright Service** - Microsoft's cloud browsers

## Out of Scope

- Storybook < 10
- React Native
- Multiple diff engines (dssim only)
