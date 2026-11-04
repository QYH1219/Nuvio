import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LOW_END_FPS_CAP,
  describeGpu,
  detectLowEndGpu,
  resolveFpsCap,
} from '../src/gpu.js';

test('software rasterizers and old integrated GPUs count as low end', () => {
  const lowEnd = [
    'SwiftShader',
    'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))',
    'llvmpipe (LLVM 15.0.7, 256 bits)',
    'ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) HD Graphics 530 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Adreno (TM) 505',
    'Mali-G52',
  ];
  lowEnd.forEach((name) => assert.equal(detectLowEndGpu(name), true, name));
});

test('discrete cards and newer integrated GPUs keep the tier cap', () => {
  const fine = [
    'ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)',
    'Adreno (TM) 650',
    'Mali-G78',
    '',
    'WebGL',
  ];
  fine.forEach((name) => assert.equal(detectLowEndGpu(name), false, name));
});

test('fps cap only drops to 24 when lowEndAuto is on', () => {
  assert.equal(LOW_END_FPS_CAP, 24);
  assert.equal(resolveFpsCap({ tierFps: 60, lowEnd: true, lowEndAuto: true }), 24);
  assert.equal(resolveFpsCap({ tierFps: 60, lowEnd: true, lowEndAuto: false }), 60);
  assert.equal(resolveFpsCap({ tierFps: 60, lowEnd: false, lowEndAuto: true }), 60);
  // Never raises a tier that is already below the cap.
  assert.equal(resolveFpsCap({ tierFps: 20, lowEnd: true, lowEndAuto: true }), 20);
  // Missing input falls back to 60 rather than to 0/NaN.
  assert.equal(resolveFpsCap({}), 60);
});

test('gpu label is collapsed and capped', () => {
  assert.equal(describeGpu('  ANGLE   (NVIDIA)  '), 'ANGLE (NVIDIA)');
  assert.equal(describeGpu(''), 'unknown');
  const long = describeGpu('x'.repeat(200), 20);
  assert.equal(long.length, 20);
  assert.ok(long.endsWith('…'));
});
