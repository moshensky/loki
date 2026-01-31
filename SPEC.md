# eyediff Specification

## Overview

Opinionated visual regression testing for Storybook 10+. Runs entirely in Docker for consistency and simplicity.

## Design Principles

1. **Docker-first** - Everything runs in a single container (Chrome + diff tool + eyediff)
2. **Storybook 10 only** - No legacy API support
3. **Zero configuration** - Sensible defaults, minimal setup
4. **Fast** - Native diff tools, parallel execution

## Architecture

```
Host Machine
┌────────────────────────────────────────────────────────────────┐
│                                                                │
│  ┌──────────────────┐      ┌─────────────────────────────────┐ │
│  │ Storybook        │      │ eyediff CLI (npm package)       │ │
│  │ localhost:6006   │      │ $ npx eyediff test              │ │
│  └──────────────────┘      └───────────────┬─────────────────┘ │
│           ▲                                │                   │
│           │                                │ docker run        │
│           │                                ▼                   │
│  ┌────────┴───────────────────────────────────────────────────┐│
│  │ Docker Container (ghcr.io/oblador/eyediff)                 ││
│  │ ┌────────────────────────────────────────────────────────┐ ││
│  │ │ 1. Fetch stories    GET /index.json                    │ ││
│  │ │ 2. For each story:                                     │ ││
│  │ │    └─► Chrome ─► Navigate ─► Screenshot ─► .eyediff/   │ ││
│  │ │ 3. Compare          dssim reference.png current.png    │ ││
│  │ └────────────────────────────────────────────────────────┘ ││
│  │                                                            ││
│  │ Volumes:                                                   ││
│  │   .eyediff/ ◄──► /work/.eyediff (screenshots)              ││
│  │   package.json ──► /work/package.json (config)             ││
│  └────────────────────────────────────────────────────────────┘│
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

## Installation

```bash
npm install -D eyediff
```

Requires Docker to be installed and running.

## Usage

```bash
# Run tests against live Storybook
npx eyediff test

# Run tests against static build
npx eyediff test --storybook-dir ./storybook-static

# Only test stories changed since main branch
npx eyediff test --changed-since main

# Update references
npx eyediff update

# Approve changes
npx eyediff approve
```

The CLI automatically runs Docker with the correct mounts and networking.

## Storybook Modes

### Live Server (default)

```bash
# Start Storybook, then run eyediff
npm run storybook &
npx eyediff test
```

Connects to `http://host.docker.internal:6006`.

### Static Build

```bash
# Build Storybook, then run eyediff
npm run build-storybook
npx eyediff test --storybook-dir ./storybook-static
```

The directory is mounted into the container and served locally. No need for a running Storybook server.

## Story Discovery

Fetch stories from Storybook's `index.json` endpoint:

```
GET http://host.docker.internal:6006/index.json
```

Response structure:

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
    }
  }
}
```

### Filtering

- Only entries with `type: "story"` (exclude docs)
- Skip stories with `eyediff-skip` tag

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

Minimal config in `package.json`:

```json
{
  "eyediff": {
    "configurations": {
      "chrome.laptop": {
        "width": 1366,
        "height": 768
      },
      "chrome.mobile": {
        "width": 375,
        "height": 667,
        "mobile": true
      }
    },
    "diffThreshold": 0,
    "storybookUrl": "http://host.docker.internal:6006"
  }
}
```

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

## Exit Codes

| Code | Meaning                                       |
| ---- | --------------------------------------------- |
| 0    | All tests passed                              |
| 1    | Visual differences detected                   |
| 2    | Error (stories not found, Chrome crash, etc.) |

## Docker Image

Published to `ghcr.io/oblador/eyediff`. Contains Chrome, dssim, and the test runner.

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

# Install Rust and dssim
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && ~/.cargo/bin/cargo install dssim \
    && cp ~/.cargo/bin/dssim /usr/local/bin/ \
    && rm -rf ~/.cargo ~/.rustup

# Copy eyediff source
WORKDIR /app
COPY docker/src ./src
COPY docker/package.json .
RUN npm install --production

WORKDIR /work
ENTRYPOINT ["node", "/app/src/cli.js"]
```

## Package Structure

```
eyediff/
├── bin/
│   └── eyediff           # CLI wrapper (runs Docker)
├── package.json
└── docker/
    ├── Dockerfile
    └── src/
        ├── cli.js        # Command parsing (inside container)
        ├── runner.js     # Test orchestration
        ├── chrome.js     # CDP + screenshots
        ├── stories.js    # Fetch from index.json
        └── diff.js       # dssim wrapper
```

## CLI Wrapper

The npm package is a thin wrapper that invokes Docker:

```javascript
#!/usr/bin/env node
const { execSync } = require('child_process');
const { resolve } = require('path');

const cwd = process.cwd();
const args = process.argv.slice(2).join(' ');

execSync(
  `docker run --rm -it \
  -v ${cwd}/.eyediff:/work/.eyediff \
  -v ${cwd}/package.json:/work/package.json:ro \
  --add-host=host.docker.internal:host-gateway \
  ghcr.io/oblador/eyediff ${args}`,
  { stdio: 'inherit' }
);
```

## Out of Scope

- Storybook < 10
- React Native
- Vue integration
- AWS Lambda target
- Local Chrome (non-Docker)
- Multiple diff engines
