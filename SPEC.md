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
# Run tests
npx eyediff test

# Update references
npx eyediff update

# Approve changes
npx eyediff approve
```

The CLI automatically runs Docker with the correct mounts and networking.

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
   d. Wait for `#storybook-root > *` selector
   e. Wait for network idle
   f. Capture screenshot via `Page.captureScreenshot`
   g. Close tab

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

| Command           | Description                                |
| ----------------- | ------------------------------------------ |
| `eyediff test`    | Run tests, compare against references      |
| `eyediff update`  | Capture new reference screenshots          |
| `eyediff approve` | Copy current to reference (accept changes) |

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
