import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import { RUN_CHART_FILENAMES } from '../../constants.js';
import type { ChartTheme, MetricsBundle, RenderedChartPaths } from '../../types.js';
import { buildEChartsRenderSpecs } from './specs.js';

const require = createRequire(import.meta.url);
const echarts = require('echarts') as typeof import('echarts');

function isTransparentBackground(color: string | undefined): boolean {
  if (!color) {
    return false;
  }
  const normalized = color.trim().toLowerCase();
  if (normalized === 'transparent') {
    return true;
  }
  if (normalized === 'rgba(0,0,0,0)' || normalized === 'rgba(0, 0, 0, 0)') {
    return true;
  }
  const match = normalized.match(/^rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*([0-9.]+)\s*\)$/);
  if (!match) {
    return false;
  }
  const alpha = Number.parseFloat(match[1]);
  return Number.isFinite(alpha) && alpha <= 0;
}

function mapRenderedChartPaths(pathsByFilename: Map<string, string>): RenderedChartPaths {
  return {
    latencyDistribution: pathsByFilename.get(RUN_CHART_FILENAMES.latencyDistribution) as string,
  };
}

async function renderSpecWithSsr(spec: { width: number; height: number; option: Record<string, unknown>; backgroundColor?: string }) {
  const chart = echarts.init(null, undefined, {
    renderer: 'svg',
    ssr: true,
    width: spec.width,
    height: spec.height,
  });
  try {
    chart.setOption(spec.option as never, { notMerge: true, lazyUpdate: false, silent: true });
    return chart.renderToSVGString();
  } finally {
    chart.dispose();
  }
}

async function renderSpecsWithSsr(
  specs: Array<{ filename: string; width: number; height: number; option: Record<string, unknown>; backgroundColor?: string }>,
  chartsDir: string,
) {
  const output = new Map<string, string>();
  for (const spec of specs) {
    const outputPath = path.join(chartsDir, spec.filename);
    let svg: string;
    try {
      svg = await renderSpecWithSsr(spec);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`SSR failed for ${spec.filename}: ${message}`);
    }
    const resvgOptions: {
      background?: string;
      fitTo: {
        mode: 'width';
        value: number;
      };
    } = {
      fitTo: {
        mode: 'width',
        value: spec.width * 2,
      },
    };
    if (!isTransparentBackground(spec.backgroundColor)) {
      resvgOptions.background = spec.backgroundColor ?? '#f8fafc';
    }
    const resvg = new Resvg(svg, resvgOptions);
    await fs.writeFile(outputPath, resvg.render().asPng());
    output.set(spec.filename, outputPath);
  }
  return output;
}

export async function renderChartsWithEcharts(
  metrics: MetricsBundle,
  chartsDir: string,
  theme: ChartTheme = 'light',
): Promise<RenderedChartPaths> {
  await fs.mkdir(chartsDir, { recursive: true });
  const specs = buildEChartsRenderSpecs(metrics, theme);

  try {
    const output = await renderSpecsWithSsr(specs, chartsDir);
    return mapRenderedChartPaths(output);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      [
        `Failed to render charts with ECharts SSR: ${message}`,
        'Renderer fallback is disabled by design.',
        'Run `npm --prefix benchmark install` to ensure benchmark dependencies are available.',
      ].join(' '),
    );
  }
}
