import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import { GitHubMark } from '@/components/github-mark';
import { KhoneLogo } from '@/components/logo';

export const baseOptions = {
  nav: {
    title: <KhoneLogo />,
    url: '/',
  },
  links: [
    {
      text: 'Docs',
      url: '/docs/',
      active: 'nested-url',
    },
    {
      text: 'Reference',
      url: '/docs/reference/config/',
      active: 'nested-url',
    },
    {
      text: 'Examples',
      url: 'https://github.com/dev7a/khone/tree/main/examples',
      external: true,
    },
    {
      text: 'Benchmarks',
      url: '/docs/explanation/performance-and-cost/',
      active: 'url',
    },
    {
      type: 'icon',
      label: 'GitHub',
      text: 'GitHub',
      url: 'https://github.com/dev7a/khone',
      icon: <GitHubMark />,
      external: true,
    },
  ],
} satisfies BaseLayoutProps;
