import fs from 'node:fs/promises';
import path from 'node:path';
import type { ChartTheme, MetricsBundle, RenderedChartPaths } from '../types.js';
import { renderChartsWithEcharts } from './echarts/render.js';

export async function renderCharts(
  metrics: MetricsBundle,
  chartsDir: string,
  theme: ChartTheme = 'light',
): Promise<RenderedChartPaths> {
  await fs.mkdir(chartsDir, { recursive: true });

  const rendererPreference = (process.env.BENCHVIZ_RENDERER ?? 'echarts').toLowerCase();

  if (rendererPreference !== 'echarts') {
    throw new Error(`Unknown BENCHVIZ_RENDERER='${rendererPreference}'. Use 'echarts'.`);
  }

  return renderChartsWithEcharts(metrics, chartsDir, theme);
}
