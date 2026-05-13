import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Definition, Link, Root, RootContent } from 'mdast';
import type { Transformer } from 'unified';
import type { VFile } from 'vfile';

type Node = Root | RootContent;
type LinkNode = Definition | Link;

const docsRoot = realpathSync(path.resolve(process.cwd(), 'content/docs'));
const staticMarkdownPaths = new Set(['assets', 'benchmark-results-public']);

function isSpecialHref(href: string) {
  return href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href);
}

function splitHref(href: string) {
  const match = /^(?<pathname>[^?#]*)(?<suffix>[?#].*)?$/.exec(href);

  return {
    pathname: match?.groups?.pathname ?? href,
    suffix: match?.groups?.suffix ?? '',
  };
}

function sourcePathForFile(file: VFile) {
  if (!file.path) return undefined;

  const realFilePath = realpathSync(file.path);
  const relativePath = path.relative(docsRoot, realFilePath).split(path.sep).join('/');

  return relativePath.startsWith('..') ? undefined : relativePath;
}

function routeForMarkdownLink(href: string, sourcePath: string) {
  if (isSpecialHref(href)) return href;

  const { pathname, suffix } = splitHref(href);
  if (!pathname.match(/\.mdx?$/)) return href;

  const segments = pathname.split('/').filter(Boolean);
  if (segments.some((segment) => staticMarkdownPaths.has(segment))) return href;

  const targetSourcePath = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), pathname),
  );
  if (targetSourcePath.startsWith('..')) return href;

  const withoutExtension = targetSourcePath.replace(/\.mdx?$/, '');
  const routePath = withoutExtension.endsWith('/index')
    ? withoutExtension.slice(0, -'/index'.length)
    : withoutExtension;

  return `/docs/${routePath ? `${routePath}/` : ''}${suffix}`;
}

function visitLinks(node: Node, visitor: (node: LinkNode) => void) {
  if (node.type === 'link' || node.type === 'definition') visitor(node as LinkNode);

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitLinks(child as Node, visitor);
  }
}

export function remarkDocLinks(): Transformer<Root> {
  return (tree, file) => {
    const sourcePath = sourcePathForFile(file);
    if (!sourcePath) return;

    visitLinks(tree, (node) => {
      node.url = routeForMarkdownLink(node.url, sourcePath);
    });
  };
}
