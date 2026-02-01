# CLI Reference

> TODO: Write CLI reference

## Commands

### `snapvrt init`

Initialize snapvrt in current project.

### `snapvrt test`

Run visual regression tests.

```bash
snapvrt test [options]

Options:
  --storybook-dir <dir>   Use static Storybook build
  --filter <pattern>      Filter stories by name
```

### `snapvrt update`

Capture new reference screenshots.

### `snapvrt approve`

Approve changes.

```bash
snapvrt approve [name]    # Approve specific snapshot
snapvrt approve --all     # Approve all pending
```

### `snapvrt review`

Open interactive review UI.

### `snapvrt service`

Manage the HTTP API service.

```bash
snapvrt service start     # Start service (foreground)
snapvrt service stop      # Stop background service
snapvrt service status    # Show service status
```
