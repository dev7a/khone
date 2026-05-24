---
title: Native batch
description: Implement a Khone target Lambda that receives and responds to the full batch directly.
---

# Native batch

Native batch, Mode C, gives the target Lambda the whole batch. Use it when one invocation should
share data loading, fan-out, or response generation across all items.

## Handler shape

The gateway sends an event with a `batch` array. Each item is shaped like an API Gateway HTTP API v2
event and carries a gateway-generated request id in `requestContext.requestId`.

```javascript
exports.handler = async function handler(event) {
  const responses = await Promise.all(
    event.batch.map(async (item) => {
      const id = item.pathParameters?.id;
      return {
        id: item.requestContext.requestId,
        statusCode: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      };
    }),
  );

  return { v: 1, responses };
};
```

## Response contract

Each response `id` must match a request id from the batch. Responses may arrive in any order for
buffered routes. The gateway waits for each response or times out the affected request.

For the full request and response schema, see the [Batch protocol](../reference/batch-protocol.md).

## When to use it

Use native batch when:

- one backend call can serve several request items
- shared cache or data loading makes batch processing materially cheaper
- the handler needs custom fan-out or aggregation
- adapter wrappers cannot express the response shape you need

For independent per-request handlers, prefer [Adapters](adapters.md).
