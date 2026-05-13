import Link from 'next/link';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import type { MDXComponents } from 'mdx/types';
import type { AnchorHTMLAttributes } from 'react';

function isSpecialHref(href: string) {
  return href.startsWith('#') || href.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(href);
}

function MdxAnchor({ href, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  if (!href || isSpecialHref(href)) {
    return <a href={href} {...props} />;
  }

  return <Link href={href} {...props} />;
}

export function getMDXComponents(components?: MDXComponents): MDXComponents {
  return {
    ...defaultMdxComponents,
    a: MdxAnchor,
    ...components,
  };
}

export const useMDXComponents = getMDXComponents;
