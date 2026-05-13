import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const outDir = path.resolve(process.cwd(), 'out');
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || '';
const htmlFiles = [];
const broken = [];

function walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      walk(fullPath);
    } else if (entry.isFile() && entry.name.endsWith('.html')) {
      htmlFiles.push(fullPath);
    }
  }
}

function routeFor(file) {
  const relativePath = path.relative(outDir, file).split(path.sep).join('/');

  if (relativePath === 'index.html') return '/';
  if (relativePath.endsWith('/index.html')) {
    return `/${relativePath.slice(0, -'index.html'.length)}`;
  }

  return `/${relativePath.replace(/\.html$/, '')}`;
}

function cleanUrl(rawUrl) {
  return rawUrl.replace(/&amp;/g, '&').split('#')[0].split('?')[0];
}

function shouldSkip(rawUrl) {
  return (
    !rawUrl ||
    rawUrl.startsWith('#') ||
    rawUrl.startsWith('data:') ||
    rawUrl.startsWith('mailto:') ||
    rawUrl.startsWith('tel:') ||
    rawUrl.startsWith('http://') ||
    rawUrl.startsWith('https://') ||
    rawUrl.startsWith('//')
  );
}

function targetPath(rawUrl, fromRoute) {
  let url = cleanUrl(rawUrl);

  if (shouldSkip(url)) return undefined;

  if (basePath && url.startsWith(`${basePath}/`)) url = url.slice(basePath.length);
  if (basePath && url === basePath) url = '/';
  if (!url.startsWith('/')) url = path.posix.normalize(path.posix.join(fromRoute, url));
  if (!url.startsWith('/')) url = `/${url}`;

  return url;
}

function existsFor(urlPath) {
  const decodedPath = decodeURIComponent(urlPath);
  const fullPath = path.join(outDir, decodedPath);

  if (decodedPath.endsWith('/')) {
    return existsSync(path.join(fullPath, 'index.html')) || existsSync(fullPath);
  }

  return existsSync(fullPath) || existsSync(path.join(fullPath, 'index.html'));
}

function checkUrl(file, route, attribute, rawUrl) {
  const resolvedPath = targetPath(rawUrl, route);

  if (resolvedPath && !existsFor(resolvedPath)) {
    broken.push(`${path.relative(outDir, file)} ${attribute}=${rawUrl} -> ${resolvedPath}`);
  }
}

walk(outDir);

for (const file of htmlFiles) {
  const html = readFileSync(file, 'utf8');
  const route = routeFor(file);

  for (const attribute of ['href', 'src']) {
    for (const match of html.matchAll(new RegExp(`${attribute}="([^"]+)"`, 'g'))) {
      checkUrl(file, route, attribute, match[1]);
    }
  }

  for (const match of html.matchAll(/srcset="([^"]+)"/g)) {
    for (const candidate of match[1].split(',')) {
      checkUrl(file, route, 'srcset', candidate.trim().split(/\s+/)[0]);
    }
  }
}

if (broken.length > 0) {
  console.error(broken.join('\n'));
  console.error(`Broken internal references: ${broken.length}`);
  process.exit(1);
}

console.log(`Checked ${htmlFiles.length} HTML files: no broken internal href/src/srcset targets.`);
