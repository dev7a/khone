import fs from 'node:fs/promises';
import { parse } from 'csv-parse/sync';
import { extractEndpoint } from '../utils.js';
import type { RawK6Record } from '../types.js';

export async function loadK6Csv(csvPath: string): Promise<RawK6Record[]> {
  const text = await fs.readFile(csvPath, 'utf-8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: false,
  }) as Array<Record<string, string>>;

  return records.map((record) => {
    const metricName = (record.metric_name ?? '').trim();
    const timestamp = Number.parseFloat(record.timestamp ?? '0');
    const metricValue = Number.parseFloat(record.metric_value ?? '0');
    const statusText = (record.status ?? '').trim();
    const status = statusText === '' ? null : Number.parseInt(statusText, 10);
    const error = (record.error ?? '').trim();
    const extraTags = record.extra_tags ?? '';

    return {
      metricName,
      timestamp: Number.isFinite(timestamp) ? timestamp : 0,
      metricValue: Number.isFinite(metricValue) ? metricValue : 0,
      status: Number.isFinite(status as number) ? (status as number) : null,
      error,
      extraTags,
      endpoint: extractEndpoint(extraTags),
    } satisfies RawK6Record;
  });
}

export function inferEndpointsFromRecords(records: RawK6Record[]): string[] {
  const values = new Set<string>();
  for (const record of records) {
    if (record.endpoint && record.endpoint !== 'unknown') {
      values.add(record.endpoint);
    }
  }
  return [...values].sort();
}
