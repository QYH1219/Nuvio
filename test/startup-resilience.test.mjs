import assert from 'node:assert/strict';
import test from 'node:test';

import {
  scoreTarget,
  selectTarget,
  selectTargetOrNull,
  waitForPageTarget,
} from '../tools/target-score.mjs';

const mainWindow = {
  type: 'page',
  id: 'main',
  title: 'ChatGPT',
  url: 'app://-/index.html',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/main',
};

const spotlight = {
  type: 'page',
  id: 'spotlight',
  title: 'ChatGPT',
  url: 'app://-/index.html?initialRoute=%2Fspotlight',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/spotlight',
};

const browserTab = {
  type: 'page',
  id: 'tab',
  title: 'GitHub',
  url: 'https://github.com/QYH1219/Nuvio',
  webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/page/tab',
};

const worker = { type: 'worker', id: 'w', url: 'app://-/worker.js' };

test('selectTargetOrNull returns null instead of throwing when Codex is mid-restart', () => {
  assert.equal(selectTargetOrNull([], null), null);
  assert.equal(selectTargetOrNull([worker], null), null);
  assert.equal(selectTargetOrNull([], null), null);
});

test('a browser tab alone never counts as a Codex window', () => {
  assert.equal(selectTargetOrNull([browserTab, worker], null), null);
  assert.throws(() => selectTarget([browserTab], null), /No page targets found/);
});

test('selectTargetOrNull keeps the existing ranking rules', () => {
  assert.equal(selectTargetOrNull([spotlight, mainWindow], null).id, 'main');
  assert.equal(selectTargetOrNull([browserTab, mainWindow], null).id, 'main');
  assert.ok(scoreTarget(mainWindow) > scoreTarget(spotlight));
});

test('waitForPageTarget retries through an empty target list and then attaches', async () => {
  const polls = [[], [worker], [browserTab], [spotlight, mainWindow]];
  let index = 0;
  let clock = 0;
  const target = await waitForPageTarget({
    getTargets: async () => polls[Math.min(index++, polls.length - 1)],
    seconds: 10,
    intervalMs: 500,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  assert.equal(target.id, 'main');
  assert.equal(index, 4);
});

test('waitForPageTarget survives CDP errors during boot', async () => {
  let calls = 0;
  let clock = 0;
  const target = await waitForPageTarget({
    getTargets: async () => {
      calls += 1;
      if (calls < 3) throw new Error('connect ECONNREFUSED');
      return [mainWindow];
    },
    seconds: 5,
    intervalMs: 250,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  assert.equal(target.id, 'main');
});

test('waitForPageTarget gives up after the budget instead of looping forever', async () => {
  let clock = 0;
  let calls = 0;
  const target = await waitForPageTarget({
    getTargets: async () => {
      calls += 1;
      return [];
    },
    seconds: 2,
    intervalMs: 500,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
  });
  assert.equal(target, null);
  assert.ok(calls >= 2, `expected a few polls, got ${calls}`);
  assert.ok(clock >= 2000, `expected the budget to be consumed, got ${clock}`);
});
