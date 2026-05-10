import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import { extractEndpoint } from '../utils.js';

function normalizeHeaderKey(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replaceAll('-', '_');
}

export async function scanEndpointsFromK6Csv(
  csvPath: string,
  options?: { maxRows?: number; stopWhenHas?: readonly string[] },
): Promise<string[]> {
  const maxRows = options?.maxRows ?? 200_000;
  const stopWhenHas = new Set((options?.stopWhenHas ?? []).map((s) => s.trim()).filter(Boolean));

  const endpoints = new Set<string>();
  const parser = createReadStream(csvPath).pipe(
    parse({
      columns: (headers: string[]) => headers.map(normalizeHeaderKey),
      relax_column_count: true,
      skip_empty_lines: true,
      trim: false,
    }),
  );

  let seen = 0;
  for await (const row of parser) {
    seen += 1;
    const extraTags = String((row as Record<string, unknown>).extra_tags ?? '');
    const endpoint = extractEndpoint(extraTags);
    if (endpoint && endpoint !== 'unknown') {
      endpoints.add(endpoint);
    }

    if (stopWhenHas.size > 0) {
      let all = true;
      for (const want of stopWhenHas) {
        if (!endpoints.has(want)) {
          all = false;
          break;
        }
      }
      if (all) {
        break;
      }
    }

    if (seen >= maxRows) {
      break;
    }
  }

  return [...endpoints].sort();
}

