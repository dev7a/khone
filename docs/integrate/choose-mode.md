---
title: Choose an integration mode
description: Pick adapters, native batch, or the layer proxy for a Khone target Lambda.
---

# Choose an integration mode

Khone targets three handler shapes. Choose the mode based on how much target code you can change and
whether the handler needs to see the whole batch.

| Integration | Mode | Code changes | Best fit |
| --- | --- | --- | --- |
| Adapter | Mode B | Small wrapper | Most new or modifiable handlers |
| Native batch | Mode C | Full control | Shared work across items or custom fan-out |
| Layer proxy | Mode A | None | Existing handlers that cannot change |

## Use adapters by default

Adapters preserve the familiar single-request handler shape. The adapter maps each batch item into a
normal API Gateway HTTP API v2 event, runs your handler with bounded concurrency, and formats the
per-request responses for the gateway.

Choose adapters when:

- you own the handler code
- each request can still be processed independently
- you want the simplest migration path for Node or Rust targets
- you want buffered or response-streaming route support without implementing the batch protocol

Read [Adapters](adapters.md) for the handler wrapper APIs.

## Use native batch for shared work

Native batch handlers receive `event.batch` directly and return the gateway response protocol. This
is the most explicit integration and the best fit when one target invocation should load data once,
fan out to a backend once, or coordinate work across all items.

Choose native batch when:

- the handler can process several items more efficiently together
- responses depend on shared lookup or fan-out work
- adapter response shapes are not flexible enough
- you are comfortable implementing the batch response contract

Read [Native batch](native-batch.md) and the [Batch protocol](../reference/batch-protocol.md).

## Use the layer proxy only for compatibility

The layer proxy uses a Lambda layer and Runtime API proxy to present one outer batch invocation as
multiple virtual runtime invocations. It lets unmodified handlers run behind Khone, but it is
runtime-specific and more fragile than adapters.

Choose the layer proxy only when:

- handler code cannot change
- the runtime is one of the tested layer-proxy runtimes
- user-code streaming is not required
- you accept experimental runtime-wrapper behavior

Read [Layer proxy](layer-proxy.md) before using Mode A in an application stack.
