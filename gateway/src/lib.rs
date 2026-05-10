//! `khone-gateway` is the Rust implementation of **Khone**.
//!
//! The gateway runs as an AWS Lambda HTTP handler. It micro-batches incoming requests per route for
//! a configurable amount of time and invokes AWS Lambda with a single batched payload. Responses are
//! then demultiplexed back to the original callers.
//!
//! Core modules:
//! - [`config`]: gateway config manifest (YAML/JSON)
//! - [`spec`]: OpenAPI-ish routing spec + matcher
//! - [`batching`]: microbatch queues + request/response demux
//! - [`lambda`]: AWS Lambda invocation (buffered or response stream)
//! - [`server`]: axum/Lambda HTTP wiring

pub mod batching;
pub mod config;
pub mod lambda;
pub mod location;
pub mod metrics;
pub(crate) mod serde_ext;
pub mod server;
pub mod spec;
