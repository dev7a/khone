# Integration Modes

The gateway supports three target Lambda integration modes.

| Mode | Name | Code changes | Best fit |
| --- | --- | --- | --- |
| Mode A | Layer Proxy | None | Existing handlers that cannot change. |
| Mode B | Adapter | Small wrapper | Most new or modifiable handlers. |
| Mode C | Native Batch | Full control | Custom batch processing. |

## Mode B Is The Default

Mode B preserves the familiar single-request handler shape and lets the adapter handle batch
correlation, per-item errors, and response formatting. Use it when you own the handler code.

## Mode C Is For Shared Work

Mode C gives the handler the whole batch. Use it when one invocation should share data loading,
fan-out, or response generation across all items.

## Mode A Is A Compatibility Tool

Mode A uses a Lambda layer and Runtime API proxy to present one outer batch invocation as multiple
virtual runtime invocations. It is useful for unmodified handlers, but it is runtime-specific and
more fragile than adapters.
