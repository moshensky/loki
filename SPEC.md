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
┌─────────────────────────────────────────┐
│  eyediff Docker container                  │
│  ├── Chrome headless                    │
│  ├── dssim (native image diff)          │
│  └── eyediff CLI                           │
└─────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────┐
│  Storybook (running on host)            │
│  └── http://host.docker.internal:6006   │
└─────────────────────────────────────────┘
```

## Usage

```bash
# Run tests
docker run -v $(pwd)/.eyediff:/eyediff ghcr.io/oblador/eyediff test

# Update references
docker run -v $(pwd)/.eyediff:/eyediff ghcr.io/oblador/eyediff update

# Approve changes
docker run -v $(pwd)/.eyediff:/eyediff ghcr.io/oblador/eyediff approve
```

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

| Command | Description |
|---------|-------------|
| `eyediff test` | Run tests, compare against references |
| `eyediff update` | Capture new reference screenshots |
| `eyediff approve` | Copy current to reference (accept changes) |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | All tests passed |
| 1 | Visual differences detected |
| 2 | Error (stories not found, Chrome crash, etc.) |

## Docker Image

```dockerfile
FROM node:24

# Install Chrome
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxss1 \
    xdg-utils

# Install dssim
RUN cargo install dssim

# Install eyediff
COPY . /app
WORKDIR /app
RUN npm install

ENTRYPOINT ["node", "/app/bin/eyediff"]
```

## Package Structure (Simplified)

```
eyediff/
├── bin/
│   └── eyediff              # CLI entry point
├── src/
│   ├── cli.js            # Command parsing
│   ├── runner.js         # Test orchestration
│   ├── chrome.js         # CDP + screenshots
│   ├── stories.js        # Fetch from index.json
│   └── diff.js           # dssim wrapper
├── Dockerfile
└── package.json
```

## Out of Scope

- Storybook < 10
- React Native
- Vue integration
- AWS Lambda target
- Local Chrome (non-Docker)
- Multiple diff engines
