import Link from 'next/link';
import { GitHubMark } from '@/components/github-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { docsHeaderLinks, docsSectionForHref } from '@/lib/docs-nav';

const navItems = [
  { href: '/docs/', label: 'Docs' },
  ...docsHeaderLinks,
];

function currentNavHref(currentPath?: string) {
  if (!currentPath) return undefined;

  return navItems
    .filter((item) => currentPath === item.href || currentPath.startsWith(item.href))
    .sort((a, b) => b.href.length - a.href.length)
    .at(0)?.href;
}

function Brand({ showPron = true }: { showPron?: boolean }) {
  return (
    <span className="brand">
      <svg className="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path
          d="M3 5 L21 5 L15 14 L15 21 L9 21 L9 14 Z"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinejoin="round"
        />
        <path
          d="M6.5 8.5 L17.5 8.5"
          stroke="currentColor"
          strokeWidth="1"
          strokeLinecap="round"
          opacity="0.55"
        />
      </svg>
      <span className="name">khone</span>
      {showPron ? <span className="pron">/koʊ.neɪ/</span> : null}
    </span>
  );
}

export function SiteHeader({ currentPath }: { currentPath?: string }) {
  const activeHref = currentNavHref(currentPath);

  return (
    <header className="site">
      <div className="inner">
        <Link href="/" aria-label="Khone home">
          <Brand />
        </Link>
        <nav className="primary" aria-label="Primary navigation">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={activeHref === item.href ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="header-meta">
          <span className="status"><span className="pulse" />Experimental</span>
          <ThemeToggle />
          <Link
            href="https://github.com/dev7a/khone"
            className="icon-btn"
            aria-label="Khone on GitHub"
            title="GitHub"
          >
            <GitHubMark />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const start = docsSectionForHref('/docs/start/');
  const deploy = docsSectionForHref('/docs/deploy/');
  const integrate = docsSectionForHref('/docs/integrate/');
  const operate = docsSectionForHref('/docs/operate/');
  const benchmarks = docsSectionForHref('/docs/benchmarks/');
  const reference = docsSectionForHref('/docs/reference/');
  const referenceConfiguration = reference?.links.find(
    (link) => link.href === '/docs/reference/configuration/',
  );

  return (
    <footer className="site">
      <div className="inner">
        <div className="col brand-col">
          <Link href="/">
            <Brand showPron={false} />
          </Link>
          <p className="copy">
            From Greek χώνη, χοάνη — "funnel."
            <br />
            Pronounced <span>KOH-nay</span>.
            <br />
            MIT · Experimental.
          </p>
        </div>
        <div className="col">
          <h5>{start?.label ?? 'Start'}</h5>
          <Link href="/docs/">Documentation</Link>
          {start?.links.map((link) => (
            <Link href={link.href} key={link.href}>{link.label}</Link>
          ))}
        </div>
        <div className="col">
          <h5>Build</h5>
          {deploy ? <Link href={deploy.href}>{deploy.label}</Link> : null}
          {integrate ? <Link href={integrate.href}>{integrate.label}</Link> : null}
          {deploy?.links.slice(1, 3).map((link) => (
            <Link href={link.href} key={link.href}>{link.label}</Link>
          ))}
        </div>
        <div className="col">
          <h5>Operate</h5>
          {operate ? <Link href={operate.href}>{operate.label}</Link> : null}
          {benchmarks ? <Link href={benchmarks.href}>{benchmarks.label}</Link> : null}
          {reference ? <Link href={reference.href}>{reference.label}</Link> : null}
          {referenceConfiguration ? (
            <Link href={referenceConfiguration.href}>{referenceConfiguration.label}</Link>
          ) : null}
        </div>
      </div>
    </footer>
  );
}
