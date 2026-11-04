import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { buildSceneShader } from '../src/shaders.js';
import { collectSceneEffects } from '../tools/wallpaper.mjs';

function pngStub(file) {
  writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
}

test('collectSceneEffects parses water effect parameters and textures', () => {
  const root = mkdtempSync(join(tmpdir(), 'nuvio-scene-effects-'));
  try {
    const scene = join(root, 'scene');
    mkdirSync(join(scene, 'materials', 'masks'), { recursive: true });
    mkdirSync(join(scene, 'materials', 'effects'), { recursive: true });
    mkdirSync(join(scene, 'effects', 'waterwaves'), { recursive: true });
    mkdirSync(join(scene, 'effects', 'waterripple'), { recursive: true });
    mkdirSync(join(scene, 'effects', 'waterflow'), { recursive: true });

    pngStub(join(scene, 'materials', 'masks', 'wave.png'));
    pngStub(join(scene, 'materials', 'masks', 'ripple.png'));
    pngStub(join(scene, 'materials', 'masks', 'flow.png'));
    pngStub(join(scene, 'materials', 'effects', 'ripplenormal.png'));
    pngStub(join(scene, 'materials', 'effects', 'flowphase.png'));

    for (const type of ['waterwaves', 'waterripple', 'waterflow']) {
      writeFileSync(
        join(scene, 'effects', type, 'effect.json'),
        JSON.stringify({ replacementkey: type }),
      );
    }

    const object = {
      effects: [
        {
          file: 'effects/waterwaves/effect.json',
          passes: [
            {
              textures: [null, 'masks/wave'],
              constantshadervalues: {
                direction: -0.98,
                scale: 72.12,
                speed: 0.25,
                strength: 0.03,
                perspective: 0,
              },
            },
          ],
        },
        {
          file: 'effects/waterripple/effect.json',
          passes: [
            {
              textures: [null, 'masks/ripple', 'effects/ripplenormal'],
              constantshadervalues: {
                animationspeed: 0.07,
                scale: 2.45,
                ripplestrength: 0.07,
                ratio: 1,
              },
            },
          ],
        },
        {
          file: 'effects/waterflow/effect.json',
          passes: [
            {
              textures: [null, 'masks/flow', 'effects/flowphase'],
              constantshadervalues: { phasescale: 0.68, speed: 0.04, strength: 1 },
            },
          ],
        },
      ],
    };

    const { pipeline, unsupported } = collectSceneEffects(scene, object);
    assert.deepEqual(
      pipeline.map((entry) => entry.type),
      ['waterwaves', 'waterripple', 'waterflow'],
    );
    assert.deepEqual(unsupported, []);

    assert.equal(pipeline[0].params.scale, 72.12);
    assert.ok(pipeline[0].textures.mask.endsWith('wave.png'));

    assert.equal(pipeline[1].params.animationspeed, 0.07);
    assert.equal(pipeline[1].params.strength, 0.07);
    assert.ok(pipeline[1].textures.normal.endsWith('ripplenormal.png'));

    assert.equal(pipeline[2].params.phasescale, 0.68);
    assert.ok(pipeline[2].textures.phase.endsWith('flowphase.png'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('collectSceneEffects reports unknown effects without dropping known ones', () => {
  const root = mkdtempSync(join(tmpdir(), 'nuvio-scene-unknown-'));
  try {
    mkdirSync(join(root, 'effects', 'godrays'), { recursive: true });
    writeFileSync(
      join(root, 'effects', 'godrays', 'effect.json'),
      JSON.stringify({ replacementkey: 'godrays' }),
    );
    const { pipeline, unsupported } = collectSceneEffects(root, {
      effects: [{ file: 'effects/godrays/effect.json', passes: [{}] }],
    });
    assert.deepEqual(pipeline, []);
    assert.deepEqual(unsupported, ['godrays']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('buildSceneShader emits only the stages it is given', () => {
  const shader = buildSceneShader([
    { type: 'waterwaves', prefix: 'e0', hasMask: true, maskScale: 1 },
    { type: 'waterripple', prefix: 'e1', hasMask: true, hasNormal: true, maskScale: 1 },
    { type: 'waterflow', prefix: 'e2', hasMask: true, hasPhase: true, maskScale: 1 },
  ]);

  assert.match(shader, /vec2 warp_e0\(vec2 uv\)/);
  assert.match(shader, /vec2 warp_e1\(vec2 uv\)/);
  assert.match(shader, /vec3 flow_e2\(vec3 prev, vec2 uv\)/);
  assert.match(shader, /uv \+= warp_e0\(uv\);/);
  assert.match(shader, /uv \+= warp_e1\(uv\);/);
  assert.match(shader, /col = flow_e2\(col, warpedUv\);/);
  assert.doesNotMatch(shader, /warp_e3/);

  // Wallpaper Engine applies effects top-to-bottom, so pass 0 runs first.
  assert.ok(shader.indexOf('uv += warp_e0(uv)') < shader.indexOf('uv += warp_e1(uv)'));

  // Flow taps must not re-run the whole warp chain per sample.
  const flowBody = shader.slice(shader.indexOf('vec3 flow_e2'));
  assert.doesNotMatch(flowBody, /sampleWarped\(/);
  assert.match(flowBody, /texture2D\(uTex/);
});

test('foliagesway uses its mask as an amplitude multiplier', () => {
  const withMask = buildSceneShader([
    { type: 'foliagesway', prefix: 'e0', hasMask: true, maskScale: 1 },
  ]);
  assert.match(withMask, /uniform sampler2D e0Mask;/);
  assert.match(withMask, /amp \*= texture2D\(e0Mask/);

  const withoutMask = buildSceneShader([
    { type: 'foliagesway', prefix: 'e0', hasMask: false, maskScale: 1 },
  ]);
  assert.doesNotMatch(withoutMask, /e0Mask/);
});

test('buildSceneShader survives an empty pipeline', () => {
  const shader = buildSceneShader([]);
  assert.match(shader, /vec3 sampleWarped\(vec2 uv\)/);
  assert.match(shader, /gl_FragColor = vec4\(col, 1\.0\);/);
});
