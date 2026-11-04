import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreTarget, selectTarget } from '../tools/target-score.mjs';

const page = (id, title, url) => ({ id, title, url, type: 'page', webSocketDebuggerUrl: `ws://${id}` });

const realTargets = [
  page('A5C7', 'sandbox', 'codex-sandbox://codex-inline-visualization.web-sandbox.oaiusercontent.com/?app=skybridge'),
  page('1B6D', 'ChatGPT', 'app://-/index.html?initialRoute=%2Fspotlight'),
  page('9FCC', '制作 Codex 动态背景', 'app://-/index.html'),
  page('BROW', 'GitHub', 'https://github.com/example/project'),
  { id: 'W1', title: '', url: '', type: 'worker' },
];

test('main window beats the spotlight overlay', () => {
  const target = selectTarget(realTargets);
  assert.equal(target.id, '9FCC');
});

test('spotlight and sandbox targets score below the main window', () => {
  const main = scoreTarget(realTargets[2]);
  const spotlight = scoreTarget(realTargets[1]);
  const sandbox = scoreTarget(realTargets[0]);
  assert.ok(main > spotlight, `main ${main} should beat spotlight ${spotlight}`);
  assert.ok(main > sandbox, `main ${main} should beat sandbox ${sandbox}`);
});

test('workers and non-page targets are ignored', () => {
  const targets = [realTargets[4], realTargets[1]];
  assert.equal(selectTarget(targets).id, '1B6D');
  assert.throws(() => selectTarget([realTargets[4]]), /No page targets/);
});

test('explicit filter still wins over scoring', () => {
  assert.equal(selectTarget(realTargets, 'spotlight').id, '1B6D');
  assert.equal(selectTarget(realTargets, '9FCC').id, '9FCC');
});

test('browser tabs never outrank the Codex shell', () => {
  assert.equal(selectTarget(realTargets).id, '9FCC');
  const browser = scoreTarget(realTargets[3]);
  const main = scoreTarget(realTargets[2]);
  assert.ok(main > browser, `main ${main} should beat browser ${browser}`);
});
