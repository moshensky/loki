# snapvrt

Snap. Test. Ship.

Visual regression testing for Storybook 10+ and PDFs.

## Status

🚧 **In Development** - Not yet ready for use.

## Overview

snapvrt is an opinionated visual regression testing tool that:

- Captures screenshots from Storybook stories
- Compares PDFs for visual regressions
- Generates visual diffs for review
- Runs consistently across platforms via Docker

## Design Principles

1. **Rust + MIT** - Single binary CLI, permissive license
2. **Docker-first** - Screenshots and diffs run in containers for cross-platform consistency
3. **Storybook 10 only** - No legacy API support
4. **Zero configuration** - Sensible defaults, minimal setup
5. **Fast** - Parallel workers, native tools

## Background

snapvrt is inspired by [loki](https://loki.js.org), a visual regression testing tool for Storybook. snapvrt takes a different approach:

- **Multi-source** - Storybook, PDFs, and more (not just Storybook)
- **Storybook 10+ only** - No legacy API support, cleaner integration
- **Rust CLI + Docker** - No Node.js runtime required
- **Interactive review UI** - Browser-based diff viewer out of the box
- **Service mode** - HTTP API for Jest/Vitest integration

If you need support for Storybook 5-8, use loki.

## Documentation

### For Users

- [Getting Started](docs/getting-started.md)
- [Configuration](docs/configuration.md)
- [CLI Reference](docs/cli-reference.md)
- [CI Integration](docs/ci-integration.md)
- [Service API](docs/service-api.md)

### For Contributors

- [Contributing Guide](CONTRIBUTING.md)
- [Specification](dev/SPEC.md)
- [Design Documents](dev/design/)

## Installation

> Not yet published.

```bash
# npm (recommended)
npm install -D snapvrt

# cargo
cargo install snapvrt
```

## Quick Start

```bash
# Initialize project
snapvrt init

# Capture reference screenshots
snapvrt update

# Run tests
snapvrt test

# Review changes
snapvrt review
```

## License

MIT
