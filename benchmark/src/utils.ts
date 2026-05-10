import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const DURATION_RE = /(\d+(?:\.\d+)?)(ms|s|m|h)/g;
const SLUG_RE = /[^a-zA-Z0-9._-]+/g;
const ENDPOINT_ALIASES: Record<string, string> = {
  'mode-a-node-dynamic-item': 'mux',
  'direct-item': 'standard',
};

export function parseDurationToSeconds(value: string): number {
  if (!value) {
    throw new Error('duration is empty');
  }
  const normalized = value.trim().toLowerCase();
  const matches = [...normalized.matchAll(DURATION_RE)];
  if (matches.length < 1) {
    throw new Error(`unsupported duration format: ${value}`);
  }
  const joined = matches.map((m) => m[0]).join('');
  if (joined !== normalized) {
    throw new Error(`unsupported duration format: ${value}`);
  }

  let total = 0;
  for (const m of matches) {
    const amount = Number(m[1]);
    const unit = m[2];
    if (Number.isNaN(amount)) {
      throw new Error(`invalid duration value: ${value}`);
    }
    switch (unit) {
      case 'ms':
        total += amount / 1000;
        break;
      case 's':
        total += amount;
        break;
      case 'm':
        total += amount * 60;
        break;
      case 'h':
        total += amount * 3600;
        break;
      default:
        throw new Error(`unsupported duration unit: ${unit}`);
    }
  }
  return total;
}

export function parseStageTargets(value: string): number[] {
  const targets = value
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => Number.parseInt(x, 10));

  if (targets.length < 1) {
    throw new Error('stage targets must contain at least one integer');
  }
  if (targets.some((n) => Number.isNaN(n))) {
    throw new Error('stage targets must contain only integers');
  }
  if (targets.some((n) => n < 0)) {
    throw new Error('stage targets must be non-negative');
  }
  return targets;
}

export function shouldAddHold(duration: string): boolean {
  if (!duration) {
    return false;
  }
  const normalized = duration.trim().toLowerCase();
  return !new Set(['0', '0s', '0m', '0h', '0ms']).has(normalized);
}

export function slugify(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }
  return trimmed.replace(SLUG_RE, '-').replace(/^-+|-+$/g, '');
}

export function defaultRunDirName(label: string | null): string {
  const now = new Date();
  const stamp = [
    now.getFullYear().toString().padStart(4, '0'),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
  ].join('') +
    '-' +
    [
      now.getHours().toString().padStart(2, '0'),
      now.getMinutes().toString().padStart(2, '0'),
      now.getSeconds().toString().padStart(2, '0'),
    ].join('');

  if (!label) {
    return `run-${stamp}`;
  }
  const slug = slugify(label);
  return slug ? `run-${stamp}-${slug}` : `run-${stamp}`;
}

export function extractEndpoint(extraTags: string): string {
  if (!extraTags) {
    return 'unknown';
  }
  for (const part of extraTags.split(',')) {
    const p = part.trim();
    if (p.startsWith('endpoint=')) {
      const endpoint = p.split('=', 2)[1]?.trim();
      if (!endpoint) {
        return 'unknown';
      }
      return normalizeEndpointName(endpoint);
    }
  }
  return 'unknown';
}

export function normalizeEndpointName(endpoint: string): string {
  return ENDPOINT_ALIASES[endpoint] ?? endpoint;
}

export async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  const st = await fs.stat(dir);
  if (!st.isDirectory()) {
    throw new Error(`Not a directory: ${dir}`);
  }
}

export async function writeJson(pathname: string, value: unknown): Promise<void> {
  await fs.writeFile(pathname, `${JSON.stringify(value, null, 2)}\n`, 'utf-8');
}

export async function readJson<T>(pathname: string): Promise<T> {
  const txt = await fs.readFile(pathname, 'utf-8');
  return JSON.parse(txt) as T;
}

export async function tryGetGitSha(cwd: string): Promise<string | null> {
  try {
    const out = await execFileAsync('git', ['rev-parse', '--short', 'HEAD'], { cwd });
    return out.stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function tryIsGitDirty(cwd: string): Promise<boolean | null> {
  try {
    const out = await execFileAsync('git', ['status', '--porcelain'], { cwd });
    return out.stdout.trim().length > 0;
  } catch {
    return null;
  }
}

export async function tryReadGatewayVersion(repoRoot: string): Promise<string | null> {
  try {
    const txt = await fs.readFile(path.join(repoRoot, 'VERSION'), 'utf-8');
    const version = txt.trim();
    return version || null;
  } catch {
    return null;
  }
}

export function toIsoNow(): string {
  return new Date().toISOString();
}

export function quantile(values: number[], q: number): number | null {
  if (values.length === 0) {
    return null;
  }
  if (q <= 0) {
    return Math.min(...values);
  }
  if (q >= 1) {
    return Math.max(...values);
  }
  const sorted = [...values].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const baseValue = sorted[base];
  const nextValue = sorted[base + 1] ?? sorted[base];
  return baseValue + rest * (nextValue - baseValue);
}

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  let sum = 0;
  for (const n of values) {
    sum += n;
  }
  return sum / values.length;
}

export function round(value: number | null, digits = 2): number | null {
  if (value == null || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function epochSecondToMs(epochSeconds: number): number {
  return Math.round(epochSeconds * 1000);
}

export function bucketStartMs(ms: number, bucketSeconds: number): number {
  const bucketMs = bucketSeconds * 1000;
  return Math.floor(ms / bucketMs) * bucketMs;
}

export async function fileExists(pathname: string): Promise<boolean> {
  try {
    await fs.access(pathname);
    return true;
  } catch {
    return false;
  }
}

export function resolvePath(...parts: string[]): string {
  return path.resolve(...parts);
}
