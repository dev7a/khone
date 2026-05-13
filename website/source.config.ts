import { defineConfig, defineDocs, frontmatterSchema, metaSchema } from 'fumadocs-mdx/config';
import { z } from 'zod';
import { remarkDocLinks } from './lib/remark-doc-links';

export const docs = defineDocs({
  dir: 'content/docs',
  docs: {
    files: ['**/*.md', '**/*.mdx'],
    schema: frontmatterSchema.extend({
      title: z.string().optional(),
      description: z.string().optional(),
    }),
  },
  meta: {
    files: ['**/meta.json'],
    schema: metaSchema,
  },
});

export default defineConfig({
  mdxOptions: {
    providerImportSource: '@/components/mdx',
    remarkPlugins: (plugins) => [remarkDocLinks, ...plugins],
  },
});
