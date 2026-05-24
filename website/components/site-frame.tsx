import Link from 'next/link';
import { GitHubMark } from '@/components/github-mark';
import { ThemeToggle } from '@/components/theme-toggle';
import { docsHeaderLinks, docsNavSections } from '@/lib/docs-nav';

const navItems = [
  { href: '/docs/', label: 'Docs' },
  ...docsHeaderLinks,
];

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

export function SiteHeader({ active }: { active?: 'docs' | 'home' }) {
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
              aria-current={active === 'docs' && item.label === 'Docs' ? 'page' : undefined}
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
  const [start, deploy, integrate, operate, benchmarks, reference] = docsNavSections;

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
          <h5>{start.label}</h5>
          <Link href="/docs/">Documentation</Link>
          {start.links.map((link) => (
            <Link href={link.href} key={link.href}>{link.label}</Link>
          ))}
        </div>
        <div className="col">
          <h5>Build</h5>
          <Link href={deploy.href}>{deploy.label}</Link>
          <Link href={integrate.href}>{integrate.label}</Link>
          {deploy.links.slice(1, 3).map((link) => (
            <Link href={link.href} key={link.href}>{link.label}</Link>
          ))}
        </div>
        <div className="col">
          <h5>Operate</h5>
          <Link href={operate.href}>{operate.label}</Link>
          <Link href={benchmarks.href}>{benchmarks.label}</Link>
          <Link href={reference.href}>{reference.label}</Link>
          <Link href={reference.links[0].href}>{reference.links[0].label}</Link>
        </div>
      </div>
    </footer>
  );
}
