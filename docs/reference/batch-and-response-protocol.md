# Batch And Response Protocol

The gateway invokes target Lambda functions with a JSON batch payload. Each batch item is shaped
like an API Gateway HTTP API v2 event.

## Batch Request

```json
{
  "v": 1,
  "meta": {
    "gateway": "khone",
    "route": "/hello/{id}",
    "receivedAtMs": 1730000000000
  },
  "batch": [
    {
      "routeKey": "GET /hello/{id}",
      "requestContext": {
        "requestId": "r-1",
        "routeKey": "GET /hello/{id}",
        "http": { "method": "GET", "path": "/hello/1" }
      },
      "rawPath": "/hello/1",
      "headers": { "accept": "application/json" },
      "queryStringParameters": { "max-delay": "0" },
      "pathParameters": { "id": "1" },
      "body": "",
      "isBase64Encoded": false
    }
  ]
}
```

Requirements:

- `v` is required and must be `1`.
- `meta.route` matches the compiled route template.
- Each item must include `requestContext.requestId`.
- The response `id` must match a request id from the batch.

## Buffered Response

```json
{
  "v": 1,
  "responses": [
    {
      "id": "r-1",
      "statusCode": 200,
      "headers": { "content-type": "application/json" },
      "body": "{\"ok\":true}",
      "isBase64Encoded": false
    }
  ]
}
```

Buffered responses may arrive in any order. The gateway waits for each response or times out the
affected request.

## Streaming Response

Routes with `invokeMode: response_stream` can return one NDJSON response record per line:

```json
{"v":1,"id":"r-1","statusCode":200,"headers":{"content-type":"application/json"},"body":"{\"ok\":true}","isBase64Encoded":false}
```

Records arrive in completion order. Unknown ids are dropped.

## Common Response Fields

| Field | Notes |
| --- | --- |
| `id` | Required request id. |
| `statusCode` | HTTP status returned to the caller. |
| `headers` | Optional response headers. Lowercase keys avoid duplicates. |
| `cookies` | Optional cookie values mapped to `Set-Cookie`. |
| `body` | String body. |
| `isBase64Encoded` | Set to `true` for binary body strings. |
