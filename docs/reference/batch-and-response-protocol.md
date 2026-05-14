# Batch and response protocol

The gateway invokes target Lambda functions with a JSON batch payload. Each batch item is shaped
like an API Gateway HTTP API v2 event.

## Batch request

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
      "version": "2.0",
      "routeKey": "GET /hello/{id}",
      "rawPath": "/hello/1",
      "rawQueryString": "max-delay=0",
      "headers": { "accept": "application/json" },
      "queryStringParameters": { "max-delay": "0" },
      "pathParameters": { "id": "1" },
      "requestContext": {
        "routeKey": "GET /hello/{id}",
        "stage": "$default",
        "requestId": "r-1",
        "timeEpoch": 1730000000000,
        "http": {
          "method": "GET",
          "path": "/hello/1",
          "protocol": "HTTP/1.1"
        }
      },
      "isBase64Encoded": false
    }
  ]
}
```

Requirements:

- The envelope `v` is required and must be `1`.
- `meta.route` matches the compiled route template.
- Each item must include `requestContext.requestId` (the gateway-generated id).
- Each item carries `version: "2.0"` to mirror the API Gateway HTTP API v2 payload version.
- Each response `id` must match a request id from the batch. Unknown ids are silently dropped.

Field rules:

- All keys use camelCase.
- `cookies`, `queryStringParameters`, `pathParameters`, and `stageVariables` are omitted when empty.
- `body` is omitted entirely when the request has no body. When present, it is a string; binary
  bodies are base64-encoded with `isBase64Encoded: true`.
- `requestContext.accountId`, `apiId`, `domainName`, `domainPrefix`, `time`, `http.sourceIp`, and
  `http.userAgent` are omitted when the gateway does not have a value.

## Buffered response

For routes with `invokeMode: buffered`, the target returns one JSON document:

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

## Streaming response (legacy NDJSON)

Routes with `invokeMode: response_stream` may use a legacy NDJSON shape: one terminal response
record per request, delimited by `\n`.

```json
{"v":1,"id":"r-1","statusCode":200,"headers":{"content-type":"application/json"},"body":"{\"ok\":true}","isBase64Encoded":false}
```

Records are processed in arrival order off the Lambda response stream. Unknown ids are dropped.

For incremental record framing (`head`, `chunk`, `end`, `error`) within a single streamed response,
see [Interleaved streaming protocol](interleaved-streaming-protocol.md). The two shapes are
auto-detected per record by the presence of a `type` field.

## Common response fields

| Field | Notes |
| --- | --- |
| `id` | Required request id. |
| `statusCode` | HTTP status returned to the caller. |
| `headers` | Optional response headers. Lowercase keys avoid duplicates. |
| `cookies` | Optional cookie values mapped to `Set-Cookie` headers. |
| `body` | String body. Default empty string. |
| `isBase64Encoded` | Set to `true` for binary body strings. Default `false`. |
