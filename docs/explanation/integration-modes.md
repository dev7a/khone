# Integration modes

The gateway supports three target Lambda integrations.

| Integration | Mode | Code changes | Best fit |
| --- | --- | --- | --- |
| Layer proxy | Mode A | None | Existing handlers that cannot change. |
| Adapter | Mode B | Small wrapper | Most new or modifiable handlers. |
| Native batch | Mode C | Full control | Custom batch processing. |

## Adapter, Mode B, is the default

The adapter, Mode B, preserves the familiar single-request handler shape. It handles batch
correlation, per-item errors, and response formatting. Use it when you own the handler code.

```javascript
const { batchAdapter } = require("khone-lambda-adapter");

async function getItem(event) {
  const id = event.pathParameters?.id;
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id }),
  };
}

exports.handler = batchAdapter(getItem);
```

## Native batch, Mode C, is for shared work

Native batch, Mode C, gives the handler the whole batch. Use it when one invocation should share
data loading, fan-out, or response generation across all items.

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

## Layer proxy, Mode A, is a compatibility tool

The layer proxy, Mode A, uses a Lambda layer and Runtime API proxy to present one outer batch
invocation as multiple virtual runtime invocations. It is useful for unmodified handlers, but it is
runtime-specific and more fragile than adapters.

The target handler keeps the normal Lambda shape; the layer handles the batch fan-out before the
handler is called.

```python
import json


def handler(event, context):
    item_id = event.get("pathParameters", {}).get("id")
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps({"id": item_id}),
    }
```
