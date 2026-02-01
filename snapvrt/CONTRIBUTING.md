# Contributing to snapvrt

Thank you for your interest in contributing!

## Development Setup

> TODO: Add development setup instructions

### Prerequisites

- Rust (latest stable)
- Docker
- Node.js 18+

### Building

```bash
cargo build
```

### Running Tests

```bash
cargo test
```

## Project Structure

```
snapvrt/
├── crates/
│   ├── snapvrt/          # CLI binary (published)
│   └── capture/          # Capture worker (internal)
├── docker/
│   ├── capture/          # Capture worker image
│   └── diff/             # Diff engine images
├── packages/             # npm packages
│   ├── snapvrt/          # Main npm package
│   ├── client/           # @snapvrt/client
│   └── jest/             # @snapvrt/jest
├── docs/                 # User documentation
└── dev/                  # Development documentation
```

## Documentation

- **User docs:** `docs/` - Getting started, configuration, CLI reference
- **Dev docs:** `dev/` - Specification, design documents

### Key Development Documents

- [Specification](dev/SPEC.md) - Full technical specification
- [Orchestrator Design](dev/design/orchestrator.md) - CLI & Service design

## Making Changes

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Make your changes
4. Run tests (`cargo test`)
5. Commit (`git commit -m "Add my feature"`)
6. Push (`git push origin feature/my-feature`)
7. Open a Pull Request

## Code Style

- Rust: Follow `rustfmt` defaults
- Commit messages: Conventional commits preferred

## Questions?

Open an issue for discussion.
