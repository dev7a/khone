import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(websiteRoot, '..');
const publicDocsRoot = path.join(websiteRoot, 'public', 'docs');

const assetDirectories = [
  {
    source: path.join(repoRoot, 'docs', 'assets'),
    target: path.join(publicDocsRoot, 'assets'),
  },
  {
    source: path.join(repoRoot, 'benchmark-results-public'),
    target: path.join(publicDocsRoot, 'benchmark-results-public'),
  },
];

await mkdir(publicDocsRoot, { recursive: true });

for (const { source, target } of assetDirectories) {
  const stats = await stat(source);
  if (!stats.isDirectory()) {
    throw new Error(`Expected ${source} to be a directory`);
  }

  await rm(target, { recursive: true, force: true });
  await cp(source, target, { recursive: true });
}
