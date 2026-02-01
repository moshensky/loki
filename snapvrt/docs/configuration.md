# Configuration

> TODO: Write configuration reference

## Config File

`.snapvrt/config.toml`

```toml
storybook_url = "http://localhost:6006"
diff_engine = "dssim"

workers = 1
tabs_per_worker = 4

[viewports.desktop]
width = 1366
height = 768

[viewports.mobile]
width = 375
height = 667
device_scale_factor = 2
```

## Options

| Option | Default | Description |
|--------|---------|-------------|
| `storybook_url` | `http://localhost:6006` | Storybook server URL |
| `diff_engine` | `dssim` | Diff engine to use |
| `workers` | `1` | Number of worker containers |
| `tabs_per_worker` | `4` | Concurrent browser tabs per worker |
