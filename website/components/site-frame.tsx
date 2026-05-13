import Link from 'next/link';
import { GitHubMark } from '@/components/github-mark';
import { ThemeToggle } from '@/components/theme-toggle';

const navItems = [
  { href: '/docs/', label: 'Docs' },
  { href: '/docs/reference/config/', label: 'Reference' },
  { href: 'https://github.com/dev7a/khone/tree/main/examples', label: 'Examples', external: true },
  { href: '/docs/explanation/performance-and-cost/', label: 'Benchmarks' },
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
              target={item.external ? '_blank' : undefined}
              rel={item.external ? 'noopener noreferrer' : undefined}
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
            Apache 2.0 · Experimental.
          </p>
        </div>
        <div className="col">
          <h5>Project</h5>
          <Link href="/docs/">Documentation</Link>
          <Link href="https://github.com/dev7a/khone">GitHub</Link>
          <Link href="/docs/explanation/project-scope/">Changelog</Link>
        </div>
        <div className="col">
          <h5>Reference</h5>
          <Link href="/docs/reference/config/">Configuration</Link>
          <Link href="/docs/reference/batch-and-response-protocol/">Batch protocol</Link>
          <Link href="/docs/reference/observability/">Observability</Link>
        </div>
        <div className="col">
          <h5>Operate</h5>
          <Link href="/docs/tutorials/first-lmi-deployment/">First LMI deployment</Link>
          <Link href="/docs/how-to/tune-batching/">Tune batching</Link>
          <Link href="/docs/explanation/performance-and-cost/">Benchmark snapshot</Link>
        </div>
      </div>
    </footer>
  );
}
