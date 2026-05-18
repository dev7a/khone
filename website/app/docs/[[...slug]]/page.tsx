import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site-frame';
import { source } from '@/lib/source';

interface Props {
  params: Promise<{
    slug?: string[];
  }>;
}

const sidebar = [
  {
    title: 'Tutorials',
    links: [
      { href: '/docs/tutorials/first-lmi-deployment/', label: 'First LMI deployment' },
    ],
  },
  {
    title: 'How-to',
    links: [
      { href: '/docs/how-to/deploy-your-own-sam-gateway/', label: 'Deploy your own SAM gateway' },
      { href: '/docs/how-to/deploy-demo-stack/', label: 'Deploy the example templates' },
      { href: '/docs/how-to/deploy-benchmark-stack/', label: 'Deploy the benchmark stack' },
      { href: '/docs/how-to/run-benchmarks/', label: 'Run benchmarks' },
      { href: '/docs/how-to/tune-batching/', label: 'Tune batching and timeouts' },
      { href: '/docs/how-to/integrate-handlers/', label: 'Integrate Lambda handlers' },
      { href: '/docs/how-to/use-mode-a-layer-proxy/', label: 'Use the layer proxy, Mode A' },
    ],
  },
  {
    title: 'Reference',
    links: [
      { href: '/docs/reference/config/', label: 'Configuration' },
      { href: '/docs/reference/batch-and-response-protocol/', label: 'Batch & response protocol' },
      { href: '/docs/reference/interleaved-streaming-protocol/', label: 'Interleaved streaming' },
      { href: '/docs/reference/observability/', label: 'Observability' },
      { href: '/docs/reference/bootstrap-macro/', label: 'Bootstrap macro' },
      { href: '/docs/reference/sdk-adapters/', label: 'SDK adapters' },
      { href: '/docs/reference/benchmark-cli/', label: 'Benchmark CLI' },
    ],
  },
  {
    title: 'Explanation',
    links: [
      { href: '/docs/explanation/architecture/', label: 'Architecture' },
      { href: '/docs/explanation/project-scope/', label: 'Project scope' },
      { href: '/docs/explanation/performance-and-cost/', label: 'Performance and cost' },
      { href: '/docs/explanation/integration-modes/', label: 'Integration modes' },
      { href: '/docs/explanation/lmi-runtime-model/', label: 'LMI runtime model' },
      { href: '/docs/explanation/benchmarking-methodology/', label: 'Benchmarking methodology' },
    ],
  },
];

function titleFromSlug(slug?: string[]) {
  const last = slug?.at(-1) ?? 'docs';
  return last
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function currentDocPath(slug?: string[]) {
  return slug?.length ? `/docs/${slug.join('/')}/` : '/docs/';
}

function DocsSidebar({ current }: { current: string }) {
  return (
    <aside className="docs-sidebar" aria-label="Documentation navigation">
      {sidebar.map((group) => (
        <section className="side-section" key={group.title}>
          <h2>{group.title}</h2>
          <ul>
            {group.links.map((link) => (
              <li key={link.href}>
                <Link
                  href={link.href}
                  className={current === link.href ? 'active' : undefined}
                  aria-current={current === link.href ? 'page' : undefined}
                >
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}

type TocItem = {
  url: string;
  title: ReactNode;
  depth: number;
};

function PageToc({ items }: { items: TocItem[] }) {
  const visible = items.filter((item) => item.depth <= 3);

  return (
    <aside className="docs-toc" aria-label="On this page">
      <h2>On this page</h2>
      {visible.length > 0 ? (
        <ol>
          {visible.map((item) => (
            <li key={item.url} data-depth={item.depth}>
              <a href={item.url}>{item.title}</a>
            </li>
          ))}
        </ol>
      ) : (
        <p>No headings yet.</p>
      )}
    </aside>
  );
}

function sectionLabel(slug?: string[]) {
  const section = slug?.[0];
  if (!section) return 'Overview';
  if (section === 'how-to') return 'How-To Guides';
  return section
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) notFound();

  const MDX = page.data.body;
  const title = page.data.title ?? titleFromSlug(slug);
  const current = currentDocPath(slug);
  const toc = (page.data.toc ?? []) as TocItem[];

  return (
    <>
      <SiteHeader active="docs" />
      <div className="docs-shell">
        <DocsSidebar current={current} />
        <main className="doc" id="content">
          <nav className="breadcrumbs" aria-label="Breadcrumb">
            <Link href="/docs/">Docs</Link>
            <span>·</span>
            <span>{sectionLabel(slug)}</span>
          </nav>
          <div className="doc-content">
            <MDX />
          </div>
        </main>
        <PageToc items={toc} />
      </div>
      <SiteFooter />
    </>
  );
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params;
  const page = source.getPage(slug);

  if (!page) return {};

  const title = page.data.title ?? titleFromSlug(slug);

  return {
    title,
    description: page.data.description,
  };
}

export function generateStaticParams() {
  return source.generateParams('slug');
}
