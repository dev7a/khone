import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEndpoint, parseDurationToSeconds, parseStageTargets } from '../src/utils.js';

test('parseDurationToSeconds supports compound and fractional values', () => {
  assert.equal(parseDurationToSeconds('1m30s'), 90);
  assert.equal(parseDurationToSeconds('0.5s'), 0.5);
  assert.equal(parseDurationToSeconds('250ms'), 0.25);
});

test('parseStageTargets validates input', () => {
  assert.deepEqual(parseStageTargets('1,2,3'), [1, 2, 3]);
  assert.throws(() => parseStageTargets(''), /at least one integer/);
  assert.throws(() => parseStageTargets('-1'), /non-negative/);
});

test('extractEndpoint reads endpoint tag', () => {
  assert.equal(extractEndpoint('a=1, endpoint=standard, b=2'), 'standard');
  assert.equal(extractEndpoint('a=1, endpoint=direct-item, b=2'), 'standard');
  assert.equal(extractEndpoint('a=1, endpoint=mode-a-node-dynamic-item, b=2'), 'mux');
  assert.equal(extractEndpoint('foo=bar'), 'unknown');
});
