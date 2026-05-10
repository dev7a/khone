import path from 'node:path';
import { spawn } from 'node:child_process';
import { K6_EXIT_THRESHOLD_WARN } from '../constants.js';
import type { BenchmarkMode, Executor, Stage, Target } from '../types.js';

export interface RunK6Options {
  targets: Target[];
  csvPath: string;
  stages: Stage[];
  mode: BenchmarkMode;
  executor: Executor;
  maxDelayMs: number;
  keyspaceSize: number;
  rampDuration: string;
  vus: number;
  arrivalTimeUnit: string;
  arrivalPreallocatedVus: number;
  arrivalMaxVus: number;
  arrivalVusMultiplier: number;
  arrivalMaxVusMultiplier: number;
  benchmarkDir: string;
}

function buildEnv(options: RunK6Options): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  env.TARGETS = JSON.stringify(options.targets);
  env.STAGES = JSON.stringify(options.stages);
  env.MODE = options.mode;
  env.EXECUTOR = options.executor;
  env.MAX_DELAY_MS = String(options.maxDelayMs);
  env.KEYSPACE_SIZE = String(options.keyspaceSize);
  env.DURATION = options.rampDuration;
  env.VUS = String(options.vus);
  env.ARRIVAL_TIME_UNIT = options.arrivalTimeUnit;
  env.ARRIVAL_VUS_MULTIPLIER = String(options.arrivalVusMultiplier);
  env.ARRIVAL_MAX_VUS_MULTIPLIER = String(options.arrivalMaxVusMultiplier);

  if (options.arrivalPreallocatedVus > 0) {
    env.ARRIVAL_PREALLOCATED_VUS = String(options.arrivalPreallocatedVus);
  }
  if (options.arrivalMaxVus > 0) {
    env.ARRIVAL_MAX_VUS = String(options.arrivalMaxVus);
  }

  return env;
}

export async function runK6(options: RunK6Options): Promise<void> {
  const scriptPath = path.resolve(options.benchmarkDir, 'loadtest.js');
  const cmd = ['run', '--out', `csv=${options.csvPath}`, scriptPath];

  console.log(`Running: k6 ${cmd.join(' ')}`);
  console.log(`  MODE=${options.mode} EXECUTOR=${options.executor}`);
  console.log(`  STAGES=${JSON.stringify(options.stages)}`);
  console.log(`  MAX_DELAY_MS=${options.maxDelayMs}`);
  for (const target of options.targets) {
    console.log(`  TARGET=${target.name} (${target.url})`);
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn('k6', cmd, {
      stdio: 'inherit',
      env: buildEnv(options),
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      if (code === K6_EXIT_THRESHOLD_WARN) {
        console.warn('Warning: k6 thresholds were crossed (test still completed)');
        resolve();
        return;
      }
      reject(new Error(`k6 failed with return code ${code ?? 'unknown'}`));
    });
  });
}
