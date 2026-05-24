import { realpathSync } from 'node:fs';
import path from 'node:path';
import type { Definition, Link, Root, RootContent } from 'mdast';
import type { Transformer } from 'unified';
import type { VFile } from 'vfile';

type Node = Root | RootContent;
type LinkNode = Definition | Link;
type HtmlNode = Extract<RootContent, { type: 'html' }>;
type MdxJsxAttribute = {
  type: 'mdxJsxAttribute';
  name: string;
  value?: string | null | unknown;
};
type MdxJsxNode = {
  type: string;
  attributes?: MdxJsxAttribute[];
  children?: Node[];
};

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

function routePathForSourcePath(sourcePath: string) {
  const withoutExtension = sourcePath.replace(/\.mdx?$/, '');

  if (withoutExtension === 'index') return '';

  return withoutExtension.endsWith('/index')
    ? withoutExtension.slice(0, -'/index'.length)
    : withoutExtension;
}

function routeForStaticPath(pathname: string, suffix: string, sourcePath: string) {
  const targetSourcePath = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), pathname),
  );
  if (targetSourcePath.startsWith('..')) return undefined;

  const [firstSegment] = targetSourcePath.split('/');
  if (!staticMarkdownPaths.has(firstSegment)) return undefined;

  const sourceRoutePath = routePathForSourcePath(sourcePath);
  const fromRouteDir = path.posix.join('/docs', sourceRoutePath, '/');
  const targetRoutePath = path.posix.join('/docs', targetSourcePath);
  const relativePath = path.posix.relative(fromRouteDir, targetRoutePath);

  return `${relativePath || '.'}${suffix}`;
}

function routeForStaticHref(href: string, sourcePath: string) {
  if (isSpecialHref(href)) return href;

  const { pathname, suffix } = splitHref(href);
  if (!pathname) return href;

  return routeForStaticPath(pathname, suffix, sourcePath) ?? href;
}

function routeForMarkdownLink(href: string, sourcePath: string) {
  if (isSpecialHref(href)) return href;

  const { pathname, suffix } = splitHref(href);
  const staticHref = routeForStaticPath(pathname, suffix, sourcePath);
  if (staticHref) return staticHref;

  if (!pathname.match(/\.mdx?$/)) return href;

  const targetSourcePath = path.posix.normalize(
    path.posix.join(path.posix.dirname(sourcePath), pathname),
  );
  if (targetSourcePath.startsWith('..')) return href;

  const routePath = routePathForSourcePath(targetSourcePath);

  return `/docs/${routePath ? `${routePath}/` : ''}${suffix}`;
}

function routeSrcset(value: string, sourcePath: string) {
  return value
    .split(',')
    .map((candidate) => {
      const [url, ...descriptors] = candidate.trim().split(/\s+/);
      if (!url) return candidate;

      return [routeForStaticHref(url, sourcePath), ...descriptors].join(' ');
    })
    .join(', ');
}

function routeStaticHtmlAttributes(value: string, sourcePath: string) {
  return value.replace(/\b(href|src|srcset)="([^"]+)"/g, (match, attribute, rawValue) => {
    const nextValue = attribute === 'srcset'
      ? routeSrcset(rawValue, sourcePath)
      : routeForStaticHref(rawValue, sourcePath);

    return `${attribute}="${nextValue}"`;
  });
}

function routeMdxJsxAttribute(attribute: MdxJsxAttribute, sourcePath: string) {
  if (typeof attribute.value !== 'string') return;

  if (attribute.name === 'srcSet') {
    attribute.value = routeSrcset(attribute.value, sourcePath);
  } else if (attribute.name === 'href' || attribute.name === 'src') {
    attribute.value = routeForStaticHref(attribute.value, sourcePath);
  }
}

function visitLinks(node: Node, visitor: (node: LinkNode) => void) {
  if (node.type === 'link' || node.type === 'definition') visitor(node as LinkNode);

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitLinks(child as Node, visitor);
  }
}

function visitHtml(node: Node, visitor: (node: HtmlNode) => void) {
  if (node.type === 'html') visitor(node as HtmlNode);

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitHtml(child as Node, visitor);
  }
}

function visitMdxJsx(node: Node, visitor: (node: MdxJsxNode) => void) {
  if (node.type === 'mdxJsxFlowElement' || node.type === 'mdxJsxTextElement') {
    visitor(node as MdxJsxNode);
  }

  if ('children' in node && Array.isArray(node.children)) {
    for (const child of node.children) visitMdxJsx(child as Node, visitor);
  }
}

export function remarkDocLinks(): Transformer<Root> {
  return (tree, file) => {
    const sourcePath = sourcePathForFile(file);
    if (!sourcePath) return;

    visitLinks(tree, (node) => {
      node.url = routeForMarkdownLink(node.url, sourcePath);
    });

    visitHtml(tree, (node) => {
      node.value = routeStaticHtmlAttributes(node.value, sourcePath);
    });

    visitMdxJsx(tree, (node) => {
      node.attributes?.forEach((attribute) => {
        routeMdxJsxAttribute(attribute, sourcePath);
      });
    });
  };
}
