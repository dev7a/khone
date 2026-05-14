import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTargetsFromOutputs } from '../src/aws/stackOutputs.js';

test('individual stack outputs default to product-named benchmark endpoints', () => {
  const targets = buildTargetsFromOutputs(
    {
      SteadyUrl: 'https://example.com/steady',
      AdaptiveUrl: 'https://example.com/adaptive',
      TargetAwareUrl: 'https://example.com/target-aware',
      StandardUrl: 'https://example.com/std',
    },
    [],
  );

  assert.deepEqual(
    targets.map((target) => target.name),
    ['steady', 'adaptive', 'target-aware', 'standard'],
  );
});
