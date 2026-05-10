#!/usr/bin/env bash
set -euo pipefail

export KHONE_PROXY_ADDR="${KHONE_PROXY_ADDR:-127.0.0.1:9009}"

# The Lambda managed runtimes decide how many concurrent Runtime API workers to run by reading
# `AWS_LAMBDA_MAX_CONCURRENCY`. Mode A relies on those workers to pull multiple "virtual"
# invocations from the local proxy concurrently.
#
# NOTE: As of python:3.14.v32, enabling this for Python while `_LAMBDA_TELEMETRY_LOG_FD` is set can
# cause the runtime to crash during init (OSError: [Errno 9] Bad file descriptor in awslambdaric
# log sink). See workaround below.
#
# Keep the wrapper safe-by-default and only set it when explicitly requested via `KHONE_MAX_CONCURRENCY`.
if [[ -z "${AWS_LAMBDA_MAX_CONCURRENCY:-}" && -n "${KHONE_MAX_CONCURRENCY:-}" ]]; then
  export AWS_LAMBDA_MAX_CONCURRENCY="${KHONE_MAX_CONCURRENCY}"
fi

# In multi-concurrent mode, the Node RIC defaults to a native Runtime API client that performs the
# long-poll /next request on the libuv threadpool. With enough worker threads, this can starve the
# threadpool and cause handlers that depend on it (e.g. AWS SDK DNS/TLS paths) to hang. The
# alternative client uses the Node HTTP stack and avoids consuming threadpool workers for /next.
if [[ "${AWS_EXECUTION_ENV:-}" == *nodejs* && -n "${AWS_LAMBDA_MAX_CONCURRENCY:-}" && -z "${AWS_LAMBDA_NODEJS_USE_ALTERNATIVE_CLIENT_1:-}" ]]; then
  export AWS_LAMBDA_NODEJS_USE_ALTERNATIVE_CLIENT_1="true"
fi

# Node managed runtime defaults worker threads to 8 * detected vCPU when
# multi-concurrency is enabled. For small-memory Lambdas this can over-subscribe
# the environment and cause unstable behavior.
#
# If worker count is not explicitly set, apply a conservative memory-based
# default for common Lambda sizes. For larger memory sizes, let the runtime keep
# its own default worker formula.
if [[ "${AWS_EXECUTION_ENV:-}" == *nodejs* && -n "${AWS_LAMBDA_MAX_CONCURRENCY:-}" && -z "${AWS_LAMBDA_NODEJS_WORKER_COUNT:-}" ]]; then
  mem_mb="${AWS_LAMBDA_FUNCTION_MEMORY_SIZE:-}"
  if [[ "${mem_mb}" =~ ^[0-9]+$ ]]; then
    if (( mem_mb > 1024 && mem_mb <= 2048 )); then
      export AWS_LAMBDA_NODEJS_WORKER_COUNT="4"
    elif (( mem_mb > 512 && mem_mb <= 1024 )); then
      export AWS_LAMBDA_NODEJS_WORKER_COUNT="2"
    elif (( mem_mb <= 512 )); then
      export AWS_LAMBDA_NODEJS_WORKER_COUNT="1"
    fi
  else
    # Unknown memory size: choose the safest fallback.
    export AWS_LAMBDA_NODEJS_WORKER_COUNT="1"
  fi
fi

# Python 3.14 uses `multiprocessing` to implement elevator mode. On Linux, the default start method
# is `forkserver`, which does not preserve the parent process's file descriptor numbers in workers.
# When `_LAMBDA_TELEMETRY_LOG_FD` is set, awslambdaric tries to `os.fdopen()` that numeric fd inside
# each worker, which can crash with "Bad file descriptor".
#
# Workaround: if we enable elevator mode for Python, force awslambdaric to fall back to stdout/stderr
# logging by unsetting `_LAMBDA_TELEMETRY_LOG_FD`. (On real Lambda Managed Instances, the platform
# uses `_LAMBDA_TELEMETRY_LOG_FD_PROVIDER_SOCKET` instead, and `_LAMBDA_TELEMETRY_LOG_FD` is unset.)
if [[ "${AWS_EXECUTION_ENV:-}" == *python* && -n "${AWS_LAMBDA_MAX_CONCURRENCY:-}" && -n "${_LAMBDA_TELEMETRY_LOG_FD:-}" ]]; then
  unset _LAMBDA_TELEMETRY_LOG_FD
fi

if [[ -z "${KHONE_UPSTREAM_RUNTIME_API:-}" ]]; then
  export KHONE_UPSTREAM_RUNTIME_API="${AWS_LAMBDA_RUNTIME_API}"
fi

export AWS_LAMBDA_RUNTIME_API="${KHONE_PROXY_ADDR}"

exec "$@"
