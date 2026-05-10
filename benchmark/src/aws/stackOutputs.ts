import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';
import { DEFAULT_ENDPOINTS, OUTPUT_KEYS_BY_ENDPOINT } from '../constants.js';
import type { Target } from '../types.js';

export async function getStackOutputs(stackName: string, region: string | null): Promise<Record<string, string>> {
  const client = new CloudFormationClient(region ? { region } : {});
  const response = await client.send(new DescribeStacksCommand({ StackName: stackName }));
  const stack = response.Stacks?.[0];
  if (!stack) {
    throw new Error(`Stack ${stackName} not found`);
  }

  const outputs: Record<string, string> = {};
  for (const output of stack.Outputs ?? []) {
    if (output.OutputKey && output.OutputValue) {
      outputs[output.OutputKey] = output.OutputValue;
    }
  }
  return outputs;
}

export function buildTargetsFromOutputs(outputs: Record<string, string>, endpoints: string[]): Target[] {
  const jsonKeyCandidates = ['BenchmarkTargetsJson', 'BenchmarkTargetsJSON', 'BenchmarkTargets'];
  const targetsJson = jsonKeyCandidates.map((k) => outputs[k]).find(Boolean);
  if (targetsJson) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(targetsJson).trim());
    } catch (err) {
      throw new Error(
        `Failed to parse ${jsonKeyCandidates.join(' or ')} stack output as JSON: ${(err as Error).message}`,
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(`BenchmarkTargetsJson must be a JSON array of {name,url} objects`);
    }
    const allTargets: Target[] = parsed.map((item) => {
      if (!item || typeof item !== 'object') {
        throw new Error(`BenchmarkTargetsJson entries must be objects`);
      }
      const name = (item as any).name;
      const url = (item as any).url;
      if (typeof name !== 'string' || name.trim().length < 1) {
        throw new Error(`BenchmarkTargetsJson entry missing string field "name"`);
      }
      if (typeof url !== 'string' || url.trim().length < 1) {
        throw new Error(`BenchmarkTargetsJson entry missing string field "url"`);
      }
      return { name: name.trim(), url: url.trim() };
    });

    const wanted = endpoints.length > 0 ? endpoints : allTargets.map((t) => t.name);
    const available = new Set(allTargets.map((t) => t.name));
    const unknown = [...new Set(wanted.filter((e) => !available.has(e)))].sort();
    if (unknown.length > 0) {
      const known = [...available].sort().join(', ');
      throw new Error(`Unknown endpoint(s): ${unknown.join(', ')}. Known endpoints: ${known}`);
    }
    return allTargets.filter((t) => wanted.includes(t.name));
  }

  // Legacy path: endpoints are resolved from individual URL outputs.
  if (endpoints.length === 0) {
    endpoints = [...DEFAULT_ENDPOINTS];
  }

  const unknown = [...new Set(endpoints.filter((e) => !(e in OUTPUT_KEYS_BY_ENDPOINT)))].sort();
  if (unknown.length > 0) {
    const known = Object.keys(OUTPUT_KEYS_BY_ENDPOINT).sort().join(', ');
    throw new Error(`Unknown endpoint(s): ${unknown.join(', ')}. Known endpoints: ${known}`);
  }

  const missing = endpoints.filter((endpoint) => OUTPUT_KEYS_BY_ENDPOINT[endpoint].every((key) => !(key in outputs)));
  if (missing.length > 0) {
    const details = missing
      .map((endpoint) => `${endpoint} (${OUTPUT_KEYS_BY_ENDPOINT[endpoint].join(' or ')})`)
      .join(', ');
    throw new Error(`Missing stack outputs for requested endpoint(s): ${details}`);
  }

  return endpoints.map((endpoint) => ({
    name: endpoint,
    url: OUTPUT_KEYS_BY_ENDPOINT[endpoint].map((key) => outputs[key]).find(Boolean) as string,
  }));
}
