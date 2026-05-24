export type DocsNavLink = {
  href: string;
  label: string;
  description?: string;
};

export type DocsNavSection = DocsNavLink & {
  links: DocsNavLink[];
};

export const docsNavSections: DocsNavSection[] = [
  {
    href: '/docs/start/',
    label: 'Start',
    description: 'Evaluate the fit and deploy a first gateway.',
    links: [
      {
        href: '/docs/start/when-khone-helps/',
        label: 'When Khone helps',
        description: 'Workload fit, tradeoffs, and non-goals.',
      },
      {
        href: '/docs/start/quickstart/',
        label: 'Quickstart',
        description: 'Bootstrap, deploy an example, and send a request.',
      },
    ],
  },
  {
    href: '/docs/deploy/',
    label: 'Deploy',
    description: 'Understand and deploy the LMI gateway model.',
    links: [
      {
        href: '/docs/deploy/lmi-deployment-model/',
        label: 'LMI deployment model',
        description: 'Gateway function, Function URL, and execution environments.',
      },
      {
        href: '/docs/deploy/examples/',
        label: 'Example templates',
        description: 'Deploy one included SAM example at a time.',
      },
      {
        href: '/docs/deploy/sam-gateway/',
        label: 'SAM gateway',
        description: 'Adapt Khone to your own application stack.',
      },
    ],
  },
  {
    href: '/docs/integrate/',
    label: 'Integrate',
    description: 'Connect target handlers to the gateway.',
    links: [
      {
        href: '/docs/integrate/choose-mode/',
        label: 'Choose an integration mode',
        description: 'Pick adapters, native batch, or the layer proxy.',
      },
      {
        href: '/docs/integrate/adapters/',
        label: 'Adapters',
        description: 'Wrap normal Node and Rust handlers.',
      },
      {
        href: '/docs/integrate/native-batch/',
        label: 'Native batch',
        description: 'Handle the whole batch directly.',
      },
      {
        href: '/docs/integrate/layer-proxy/',
        label: 'Layer proxy',
        description: 'Experimental compatibility for unmodified handlers.',
      },
    ],
  },
  {
    href: '/docs/operate/',
    label: 'Operate',
    description: 'Tune and observe a running gateway.',
    links: [
      {
        href: '/docs/operate/tune-batching/',
        label: 'Tune batching',
        description: 'Set waits, batch sizes, keys, and timeouts.',
      },
      {
        href: '/docs/operate/observability/',
        label: 'Observability',
        description: 'Traces, EMF metrics, profiling, and debug headers.',
      },
    ],
  },
  {
    href: '/docs/benchmarks/',
    label: 'Benchmarks',
    description: 'Read and reproduce the public benchmark snapshot.',
    links: [
      {
        href: '/docs/benchmarks/results/',
        label: 'Benchmark results',
        description: 'Cost and latency summaries for the I/O-bound snapshot.',
      },
      {
        href: '/docs/benchmarks/methodology/',
        label: 'Benchmark methodology',
        description: 'Endpoint definitions, workload shape, and caveats.',
      },
      {
        href: '/docs/benchmarks/deploy-stack/',
        label: 'Deploy the benchmark stack',
        description: 'Create the dedicated benchmark environment.',
      },
      {
        href: '/docs/benchmarks/run/',
        label: 'Run benchmarks',
        description: 'Run k6 and render report bundles.',
      },
    ],
  },
  {
    href: '/docs/reference/',
    label: 'Reference',
    description: 'Look up fields, protocols, APIs, and commands.',
    links: [
      {
        href: '/docs/reference/configuration/',
        label: 'Configuration',
        description: 'GatewayConfig, Spec, and x-khone fields.',
      },
      {
        href: '/docs/reference/batch-protocol/',
        label: 'Batch protocol',
        description: 'Target request and response payloads.',
      },
      {
        href: '/docs/reference/streaming-protocol/',
        label: 'Streaming protocol',
        description: 'Interleaved per-request streaming records.',
      },
      {
        href: '/docs/reference/bootstrap-macro/',
        label: 'Bootstrap macro',
        description: 'Config publisher behavior and outputs.',
      },
      {
        href: '/docs/reference/sdk-adapters/',
        label: 'SDK adapters',
        description: 'Node and Rust adapter APIs.',
      },
      {
        href: '/docs/reference/benchmark-cli/',
        label: 'Benchmark CLI',
        description: 'benchviz commands and options.',
      },
    ],
  },
];

export const docsHeaderLinks = docsNavSections.filter(
  (section) => section.label !== 'Benchmarks',
);

export function docsSectionForSlug(slug?: string[]) {
  const first = slug?.[0];

  return docsNavSections.find((section) => section.href === `/docs/${first}/`);
}
