# Benchmark Tooling

This package contains the benchmark SAM stack, k6 runner, and static report generator.

Use the public docs for workflows and policy:

- [Deploy the benchmark stack](../docs/how-to/deploy-benchmark-stack.md)
- [Run benchmarks](../docs/how-to/run-benchmarks.md)
- [Benchmark CLI reference](../docs/reference/benchmark-cli.md)
- [Benchmarking methodology](../docs/explanation/benchmarking-methodology.md)

Raw benchmark output belongs under ignored `benchmark-results/`. Public benchmark bundles are
curated with `--public-output-dir` and contain only `report.md`, `summary.csv`, and themed
`latency-distribution.png` charts.
