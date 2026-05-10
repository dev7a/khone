import type { Target } from '../types.js';

function withQueryParam(url: string, key: string, value: string): string {
  const u = new URL(url);
  u.searchParams.set(key, value);
  return u.toString();
}

function withItemId(url: string, itemId = '0'): string {
  const u = new URL(url);
  const basePath = u.pathname === '/' ? '' : u.pathname.replace(/\/+$/, '');

  if (basePath.endsWith('/hello')) {
    u.pathname = `${basePath.slice(0, -'/hello'.length)}/${itemId}`;
    return u.toString();
  }
  if (/\{[^/]+\}$/.test(basePath)) {
    u.pathname = basePath.replace(/\{[^/]+\}$/, itemId);
    return u.toString();
  }
  if (/\/\d+$/.test(basePath)) {
    u.pathname = basePath.replace(/\/\d+$/, `/${itemId}`);
    return u.toString();
  }

  u.pathname = `${basePath}/${itemId}`;
  return u.toString();
}

export async function warmupTargets(targets: Target[]): Promise<void> {
  if (targets.length < 1) {
    return;
  }

  console.log('Warming up endpoints (best-effort)...');
  for (const target of targets) {
    if (!target.url) {
      continue;
    }
    if (target.name.includes('sse')) {
      console.log(`  Warmup ${target.name}: skipped (SSE)`);
      continue;
    }

    const warmUrl = withQueryParam(withItemId(target.url, '0'), 'max-delay', '0');
    const started = Date.now();
    try {
      const res = await fetch(warmUrl, {
        method: 'GET',
        headers: {
          'user-agent': 'khone-benchmark-warmup',
        },
        signal: AbortSignal.timeout(15_000),
      });
      const elapsedMs = Date.now() - started;
      console.log(`  Warmup ${target.name}: ${res.status} in ${elapsedMs}ms`);
    } catch (error) {
      const elapsedMs = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      console.log(`  Warmup ${target.name}: error in ${elapsedMs}ms: ${message}`);
    }
  }
}
