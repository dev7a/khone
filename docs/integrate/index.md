---
title: Integrate
description: Choose a handler integration mode and connect Lambda target code to Khone.
---

# Integrate

Khone supports normal handler wrappers, full batch handlers, and an experimental layer proxy for
unmodified functions.

- [Choose an integration mode](choose-mode.md): compare the three options.
- [Adapters](adapters.md): keep the familiar single-request handler shape.
- [Native batch](native-batch.md): receive the full batch for custom fan-out or shared work.
- [Layer proxy](layer-proxy.md): use the compatibility layer when handler code cannot change.

For exact payload fields, see the [Batch protocol](../reference/batch-protocol.md).
