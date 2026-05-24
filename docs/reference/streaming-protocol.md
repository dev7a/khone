---
title: Streaming protocol
description: Experimental interleaved NDJSON records for per-request streaming from one batched target invocation.
---

# Streaming protocol

Interleaved streaming is an experimental NDJSON format for chunk-level streaming per request while
one Lambda invocation handles multiple requests.

Use it only when each request needs incremental output before the full batch completes.

## Framing

- Each line is one JSON object.
- Lines are separated by `\n`. `\r\n` is also accepted; the trailing newline on the last record is
  optional.
- The target response stream should use `application/x-ndjson`.
- The gateway buffers up to 8 MiB of pending NDJSON; exceeding this limit fails every in-flight
  request in the batch with `502 Bad Gateway`.

## Common fields

| Field | Notes |
| --- | --- |
| `v` | Protocol version, always `1`. |
| `id` | Request id from `requestContext.requestId`. |
| `type` | `head`, `chunk`, `end`, or `error`. |

The legacy NDJSON shape (terminal-only records with no `type` field) and the interleaved shape are
auto-detected per record by the presence of `type`; see [Batch protocol](batch-protocol.md).

## `head`

```json
{"v":1,"id":"r-1","type":"head","statusCode":200,"headers":{"content-type":"text/event-stream"},"cookies":["a=b"]}
```

Starts a response stream and defines status, headers, and cookies. `cookies` are appended as
`Set-Cookie` headers.

## `chunk`

```json
{"v":1,"id":"r-1","type":"chunk","body":"data: hello\n\n","isBase64Encoded":false}
```

Carries a body chunk. `cookies` on `chunk` records are ignored.

## `end`

```json
{"v":1,"id":"r-1","type":"end"}
```

Closes the stream.

## `error`

```json
{"v":1,"id":"r-1","type":"error","statusCode":502,"message":"upstream failed"}
```

Returns an error response and closes the stream for that request. If `head` has already been sent
for the same id, the HTTP response is already committed: the body stream is closed silently and the
status cannot change.

## Gateway behavior

- Records are processed in arrival order off the Lambda response stream.
- `head` is optional; the gateway synthesizes a default `200 OK` response head when the first
  `chunk` or `end` arrives without one.
- Unknown ids are dropped.
- A stream-level error from the Lambda runtime, an oversized buffer, or an unparseable record fails
  every in-flight request in the batch with `502 Bad Gateway`.
