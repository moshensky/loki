# snapvrt

Snap. Test. Ship.

Visual regression testing for Storybook 10+.

## Status

🚧 **In Development** - Not yet ready for use.

## Overview

snapvrt is an opinionated visual regression testing tool that:

- Captures screenshots from Storybook stories
- Compares them against reference snapshots
- Generates visual diffs for review

## Design Principles

1. **Rust + MIT** - Single binary CLI, permissive license
2. **Docker-first** - Screenshots and diffs run in containers for cross-platform consistency
3. **Storybook 10 only** - No legacy API support
4. **Zero configuration** - Sensible defaults, minimal setup
5. **Fast** - Parallel workers, native tools

## Documentation

- [Specification](docs/SPEC.md) - Full technical specification
- [Design Documents](docs/design/) - Module design decisions

## Installation

> Not yet published. Coming soon.

```bash
# npm (recommended)
npm install -D snapvrt

# cargo
cargo install snapvrt

# homebrew (future)
brew install snapvrt
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
