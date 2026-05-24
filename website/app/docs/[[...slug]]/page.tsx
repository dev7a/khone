import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { SiteFooter, SiteHeader } from '@/components/site-frame';
import { docsNavSections, docsSectionForSlug } from '@/lib/docs-nav';
import { source } from '@/lib/source';

interface Props {
  params: Promise<{
    slug?: string[];
  }>;
}

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
      {docsNavSections.map((group) => (
        <section className="side-section" key={group.href}>
          <h2>
            <Link
              href={group.href}
              className={current === group.href ? 'active' : undefined}
              aria-current={current === group.href ? 'page' : undefined}
            >
              {group.label}
            </Link>
          </h2>
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
  return docsSectionForSlug(slug)?.label ?? 'Overview';
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
      <SiteHeader currentPath={current} />
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
