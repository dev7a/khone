# Interleaved Streaming Protocol

Interleaved streaming is an experimental NDJSON format for chunk-level streaming per request while
one Lambda invocation handles multiple requests.

Use it only when each request needs incremental output before the full batch completes.

## Framing

- Each line is one JSON object.
- Lines are separated by `\n`.
- The target response stream should use `application/x-ndjson`.

## Common Fields

| Field | Notes |
| --- | --- |
| `v` | Protocol version, always `1`. |
| `id` | Request id from `requestContext.requestId`. |
| `type` | `head`, `chunk`, `end`, or `error`. |

## `head`

```json
{"v":1,"id":"r-1","type":"head","statusCode":200,"headers":{"content-type":"text/event-stream"},"cookies":["a=b"]}
```

Starts a response stream and defines status, headers, and cookies.

## `chunk`

```json
{"v":1,"id":"r-1","type":"chunk","body":"data: hello\n\n","isBase64Encoded":false}
```

Carries a body chunk.

## `end`

```json
{"v":1,"id":"r-1","type":"end"}
```

Closes the stream.

## `error`

```json
{"v":1,"id":"r-1","type":"error","statusCode":502,"message":"upstream failed"}
```

Returns an error response and closes the stream for that request.

## Gateway Behavior

- Records are processed in arrival order.
- `head` is optional; the gateway synthesizes a default 200 response head when the first `chunk` or
  `end` arrives without one.
- `cookies` are mapped to `Set-Cookie` headers.
- Unknown ids are dropped.
