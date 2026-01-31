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

| Module        | Responsibility                             |
| ------------- | ------------------------------------------ |
| `cli`         | Command parsing, entry point               |
| `config`      | Load from .eyediff/config.js               |
| `stories`     | Fetch and filter stories from Storybook    |
| `turbosnap`   | Detect changed stories via git diff        |
| `worker-pool` | Spawn, manage, and distribute tasks        |
| `diff`        | Compare screenshots using dssim            |
| `reporter`    | Terminal output and HTML report generation |

### Worker (Docker image)

| Module       | Responsibility                        |
| ------------ | ------------------------------------- |
| `server`     | HTTP endpoint for screenshot requests |
| `browser`    | Chrome CDP connection and management  |
| `screenshot` | Navigate, wait for ready, capture     |

## Dependencies

> **Note:** All external tools and dependencies listed below are examples. Final choices will be researched and selected based on the finalized specification and architecture.

### CLI

| Dependency  | Purpose                              |
| ----------- | ------------------------------------ |
| `dssim`     | Perceptual image diff (prebuilt bin) |
| `dockerode` | Spawn and manage Docker containers   |

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

Viewport fields:

| Field               | Description                                    |
| ------------------- | ---------------------------------------------- |
| `width`             | Viewport width in CSS pixels                   |
| `height`            | Viewport height in CSS pixels                  |
| `deviceScaleFactor` | Pixel density ratio (1 = standard, 2 = retina) |

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
  page.evaluate(() => getComputedStyle(document.body).animationName === 'none'),
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
    height: rect.height,
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
├── config.js            # Configuration (committed)
├── .gitignore           # Ignore transient files
├── reference/           # Baseline screenshots (committed)
│   ├── chrome_laptop_Button_Primary.png
│   └── chrome_laptop_Button_Secondary.png
├── current/             # Current test run (ignored)
│   └── ...
├── difference/          # Diff images (ignored)
│   └── ...
└── report.html          # Visual comparison report (ignored)
```

### Git Strategy

Reference screenshots are committed; transient files are ignored.

`.eyediff/.gitignore`:

```
current/
difference/
report.html
```

### Init Command

`eyediff init` creates the directory structure, gitignore, and config:

```bash
$ eyediff init
Created .eyediff/
Created .eyediff/config.js
Created .eyediff/reference/
Created .eyediff/.gitignore
Ready! Run 'eyediff update' to capture initial screenshots.
```

## Configuration

Config in `.eyediff/config.js`:

```javascript
export default {
  storybookUrl: 'http://localhost:6006',
  concurrency: 4,
  diffThreshold: 0,
  viewports: {
    desktop: {
      width: 1366,
      height: 768,
    },
    mobile: {
      width: 375,
      height: 667,
      deviceScaleFactor: 2,
    },
  },
};
```

### Options

| Option          | Default                 | Description                              |
| --------------- | ----------------------- | ---------------------------------------- |
| `storybookUrl`  | `http://localhost:6006` | Storybook server URL                     |
| `concurrency`   | `4`                     | Number of parallel workers               |
| `diffThreshold` | `0`                     | Acceptable dssim score (0 = exact match) |
| `viewports`     | `{ desktop: {...} }`    | Viewport configurations                  |
| `referenceDir`  | `.eyediff/reference`    | Baseline screenshots                     |
| `currentDir`    | `.eyediff/current`      | Current run screenshots                  |
| `diffDir`       | `.eyediff/diff`         | Diff images                              |

## CLI Commands

| Command                              | Description                                 |
| ------------------------------------ | ------------------------------------------- |
| `eyediff init`                       | Initialize project (create dirs, gitignore) |
| `eyediff test`                       | Run tests, compare against references       |
| `eyediff test --changed-since <ref>` | Only test stories affected by git changes   |
| `eyediff test --storybook-dir <dir>` | Use static build instead of live server     |
| `eyediff update`                     | Capture new reference screenshots           |
| `eyediff approve [story-id]`         | Copy current to reference (accept changes)  |
| `eyediff review`                     | Interactive review UI (see below)           |

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

## Interactive Review

`eyediff review` launches an interactive UI for reviewing and approving changes:

```bash
$ eyediff review
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

For CI or sharing, `eyediff test` also generates a static HTML report:

```
.eyediff/report.html
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
│ eyediff Report                          [All] [Failed] [Passed] │
├─────────────────────────────────────────────────────────────────┤
│ Search: [________________]                        [Approve All] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│ ✗ Button/Primary (desktop)                          [Approve]   │
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

### Self-contained

The HTML report is a single file with:

- Embedded CSS (no external stylesheets)
- Inline images (base64 encoded)
- Vanilla JS (no framework dependencies)

This allows easy sharing and viewing without a web server.

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

### Image Comparison

Diff tool runs in Docker for consistency across dev machines and CI.

#### Diff Protocol

Single container processes all images at once (avoids container startup overhead):

```bash
docker run --rm \
  -v .eyediff:/work \
  eyediff-diff \
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
| `dssim`       | `eyediff-diff-dssim`       | AGPL-3.0   | Perceptual, human vision |
| `pixelmatch`  | `eyediff-diff-pixelmatch`  | ISC        | Fast, pixel-by-pixel     |
| `imagemagick` | `eyediff-diff-imagemagick` | Apache-2.0 | Various algorithms       |
| `looks-same`  | `eyediff-diff-lookssame`   | MIT        | Antialiasing-tolerant    |

All images implement the same protocol - only the comparison algorithm differs.

Configure in `.eyediff/config.js`:

```javascript
export default {
  diffEngine: 'dssim',

  // Engine-specific options
  engineOptions: {
    dssim: {
      threshold: 0.0001,
    },
    pixelmatch: {
      threshold: 0.1,
      includeAA: false, // ignore antialiasing
    },
    imagemagick: {
      metric: 'AE', // absolute error count
      fuzz: '5%',
    },
    looksSame: {
      tolerance: 5,
      antialiasingTolerance: 3,
    },
  },
};
```

Only the selected engine's options are used.

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
