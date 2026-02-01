# Service API Reference

> TODO: Write service API reference

## Overview

snapvrt can run as a long-running HTTP service for integration with test frameworks.

```bash
snapvrt service start
```

## Endpoints

### Health

```
GET /health
```

### Compare Web

```
POST /compare/web
Content-Type: application/json

{
  "name": "button-primary",
  "url": "http://localhost:6006/iframe.html?id=button--primary",
  "viewport": { "width": 1366, "height": 768 }
}
```

### Compare PDF

```
POST /compare/pdf
Content-Type: application/json

{
  "name": "invoice",
  "pdf": "<base64>",
  "dpi": 144
}
```

### Approve

```
POST /approve
Content-Type: application/json

{
  "name": "button-primary"
}
```

## WebSocket

```
WS /ws
```

Events: `snapshot:created`, `snapshot:compared`, `snapshot:approved`
