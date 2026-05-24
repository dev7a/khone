# Benchmark Tooling

This package contains the benchmark SAM stack, k6 runner, and static report generator.

Use the public docs for workflows and policy:

- [Deploy the benchmark stack](../docs/benchmarks/deploy-stack.md)
- [Run benchmarks](../docs/benchmarks/run.md)
- [Benchmark CLI reference](../docs/reference/benchmark-cli.md)
- [Benchmark methodology](../docs/benchmarks/methodology.md)

Raw benchmark output belongs under ignored `benchmark-results/`. Public benchmark bundles are
curated with `--public-output-dir` and contain only `report.md`, `summary.csv`, and themed
`latency-distribution.png` charts.
