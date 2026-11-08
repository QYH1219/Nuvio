export const backgroundVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const backgroundFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;
  uniform vec2 uMouse;
  uniform float uTime;
  uniform float uParallax;
  uniform float uDim;
  uniform float uGrain;
  uniform float uMotion;
  uniform float uScreenAspect;
  uniform float uImageAspect;
  uniform float uFitMode;

  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  vec2 coverUv(vec2 uv) {
    float sa = uScreenAspect;
    float ia = uImageAspect;
    if (sa > ia) {
      uv.y = (uv.y - 0.5) * (ia / sa) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (sa / ia) + 0.5;
    }
    return uv;
  }

  /* contain: keep the whole artwork, undistorted, with letterbox bars. */
  vec2 containUv(vec2 uv) {
    float sa = uScreenAspect;
    float ia = uImageAspect;
    if (sa > ia) {
      uv.x = (uv.x - 0.5) * (sa / ia) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (ia / sa) + 0.5;
    }
    return uv;
  }

  void main() {
    float t = uTime;
    vec2 uv = vUv;
    float bars = 0.0;

    float breath = 1.0 + 0.010 * sin(t * 0.11) * uMotion;
    if (uFitMode > 1.5) {
      // contain: full artwork, no crop, geometry stays fixed.
      uv = containUv(uv);
      bars = step(uv.x, 0.0) + step(1.0, uv.x) + step(uv.y, 0.0) + step(1.0, uv.y);
    } else if (uFitMode > 0.5) {
      // stretch: every source pixel must stay visible, so sample the plain
      // [0,1] square and skip the zoom/drift that would crop the edges.
      uv = clamp(uv, 0.0, 1.0);
    } else {
      uv = (uv - 0.5) * breath + 0.5;
      uv = coverUv(uv);
      vec2 drift = vec2(sin(t * 0.041), cos(t * 0.036)) * 0.0045 * uMotion;
      vec2 par = uMouse * vec2(0.015, 0.0095) * uParallax;
      uv += drift + par;
    }

    vec2 dir = normalize(vUv - 0.5 + 1e-5);
    float ca = 0.0014 * (0.3 + length(vUv - 0.5)) * uParallax;

    vec3 col;
    col.r = texture2D(uTex, uv + dir * ca).r;
    col.g = texture2D(uTex, uv).g;
    col.b = texture2D(uTex, uv - dir * ca).b;

    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(vec3(lum), col, 1.14);
    col *= vec3(0.94, 1.0, 1.05);
    col += vec3(0.010, 0.018, 0.028) * (1.0 - lum);

    float bottomFog = smoothstep(0.95, 0.0, vUv.y) * 0.32;
    col = mix(col, vec3(0.012, 0.035, 0.045), bottomFog * 0.55);

    vec2 q = vUv - 0.5;
    float vig = smoothstep(1.18, 0.22, length(q) * 1.32);
    col *= mix(1.0, vig, 0.88);
    col *= (1.0 - uDim);

    float g = hash(vUv * vec2(1920.0, 1080.0) + fract(t) * 91.0) - 0.5;
    col += g * 0.030 * uGrain;
    col = mix(col, vec3(0.012, 0.020, 0.035), clamp(bars, 0.0, 1.0));

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const glowVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const glowFragment = /* glsl */ `
  precision highp float;
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uStrength;
  varying vec2 vUv;

  void main() {
    vec2 p = vUv - 0.5;
    float d = length(p) * 2.0;
    float core = smoothstep(0.62, 0.0, d);
    float halo = smoothstep(1.05, 0.12, d);
    float ripple = 0.86 + 0.14 * sin(uTime * 0.7 + d * 7.0);
    vec3 col = mix(uColorA, uColorB, smoothstep(0.1, 0.9, d));
    float a = (core * 0.55 + halo * 0.35) * ripple * uStrength;
    gl_FragColor = vec4(col * a, a);
  }
`;

export const particleVertex = /* glsl */ `
  attribute float aSeed;
  attribute float aScale;

  uniform float uTime;
  uniform float uMotion;
  uniform float uSize;
  uniform float uPixelRatio;

  varying float vAlpha;
  varying float vSeed;

  void main() {
    float t = uTime * uMotion;
    vec3 p = position;

    p.y = mod(p.y + t * 0.32 + aSeed * 3.0, 15.0) - 7.5;
    p.x += sin(t * 0.24 + aSeed * 6.2831) * 0.30;
    p.z += cos(t * 0.19 + aSeed * 5.137) * 0.30;

    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float depth = max(-mv.z, 0.4);
    gl_PointSize = uSize * aScale * uPixelRatio * (34.0 / depth);
    vAlpha = smoothstep(15.0, 1.5, depth) * (0.22 + 0.78 * fract(aSeed * 13.77));
    vSeed = aSeed;
  }
`;

export const particleFragment = /* glsl */ `
  precision highp float;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform float uTime;
  varying float vAlpha;
  varying float vSeed;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = length(c);
    if (d > 0.5) discard;

    float a = smoothstep(0.5, 0.02, d);
    a = pow(a, 2.4);
    float twinkle = 0.65 + 0.35 * sin(uTime * (0.6 + vSeed) + vSeed * 21.0);
    vec3 col = mix(uColorA, uColorB, fract(vSeed * 3.7));

    gl_FragColor = vec4(col * a, a * vAlpha * 0.85 * twinkle);
  }
`;

/*
 * Wallpaper Engine "scene" reproduction.
 *
 * `buildSceneShader` compiles only the effects that are actually present in
 * the imported scene, in the same order Wallpaper Engine applies them. The
 * pure displacement effects (shake, foliagesway, waterwaves, waterripple) are
 * composed in UV space; `waterflow` is a multi-tap blend and is emitted as a
 * colour stage on top of the displaced artwork.
 *
 * Math and defaults mirror the original effects/*.frag and effects/*.vert
 * files; the image is sampled in screen space so the background keeps
 * cover-fit on any window aspect ratio.
 */
export const sceneVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SCENE_HEADER = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;

  uniform float uTime;
  uniform float uParallax;
  uniform float uDim;
  uniform float uScreenAspect;
  uniform float uImageAspect;
  uniform float uFitMode;
  uniform vec2 uResolution;
  uniform vec2 uMouse;

  uniform float uShakeAmount;
  uniform float uSwayAmount;
  uniform float uWaterAmount;

  varying vec2 vUv;

  const float PI = 3.14159265359;
  const float HALF_PI = 1.57079632679;
  const float TEX_MARGIN = 0.952; // scene object scale 1.05

  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 345.45));
    p += dot(p, p + 34.345);
    return fract(p.x * p.y);
  }

  float valueNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = hash21(i);
    float b = hash21(i + vec2(1.0, 0.0));
    float c = hash21(i + vec2(0.0, 1.0));
    float d = hash21(i + vec2(1.0, 1.0));
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }

  // Stand-in for Wallpaper Engine's util/noise; only the green channel is
  // consumed by foliagesway, so a smooth scalar fbm is enough.
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 3; i++) {
      v += a * valueNoise(p);
      p = p * 2.02 + 17.3;
      a *= 0.5;
    }
    return v / 0.875;
  }

  vec2 rotateUv(vec2 v, float a) {
    float c = cos(a);
    float s = sin(a);
    return vec2(c * v.x - s * v.y, s * v.x + c * v.y);
  }

  vec2 coverUv(vec2 uv, float screenAspect, float imageAspect) {
    if (screenAspect > imageAspect) {
      uv.y = (uv.y - 0.5) * (imageAspect / screenAspect) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (screenAspect / imageAspect) + 0.5;
    }
    return uv;
  }

  vec2 containUv(vec2 uv, float screenAspect, float imageAspect) {
    if (screenAspect > imageAspect) {
      uv.x = (uv.x - 0.5) * (screenAspect / imageAspect) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (imageAspect / screenAspect) + 0.5;
    }
    return uv;
  }

  /*
   * fit=cover crops the artwork to the window; fit=stretch keeps every pixel
   * and lets the aspect ratio follow the window. The default scene wallpaper
   * uses stretch so the whole illustration stays visible inside Codex.
   */
  vec2 fitUv(vec2 uv) {
    if (uFitMode > 1.5) return containUv(uv, uScreenAspect, uImageAspect);
    return uFitMode > 0.5 ? uv : coverUv(uv, uScreenAspect, uImageAspect);
  }
`;

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stageMaskScale(stage) {
  return num(stage.maskScale, 1);
}

function emitShake(stage) {
  const p = stage.prefix;
  return {
    uniforms: [
      `uniform sampler2D ${p}Mask;`,
      `uniform float ${p}MaskScale;`,
      `uniform float ${p}Speed;`,
      `uniform float ${p}Strength;`,
      `uniform vec2 ${p}Friction;`,
      `uniform vec2 ${p}Bounds;`,
    ],
    code: /* glsl */ `
  vec2 warp_${p}(vec2 uv) {
    vec2 flowColors = texture2D(${p}Mask, clamp(uv, 0.0, 1.0) * ${p}MaskScale).rg;
    vec2 flowMask = (flowColors - vec2(0.498)) * 2.0;

    float time = ${p}Speed * uTime;
    float offset = sin(fract(time / HALF_PI) * HALF_PI);
    offset = offset * 0.498 + 0.5;
    float base = step(0.0, cos(time));
    offset = mix(
      1.0 - pow(1.0 - offset, ${p}Friction.x),
      pow(offset, ${p}Friction.y),
      base
    );
    offset = clamp(
      (offset - ${p}Bounds.x) / max(${p}Bounds.y - ${p}Bounds.x, 1e-5),
      0.0,
      1.0
    );
    offset = offset * 2.0 - 1.0; // DIRECTION == center

    return offset * ${p}Strength * ${p}Strength * flowMask * uShakeAmount;
  }`,
    warp: `warp_${p}`,
  };
}

function emitFoliage(stage) {
  const p = stage.prefix;
  const maskSample = stage.hasMask
    ? `amp *= texture2D(${p}Mask, clamp(uv, 0.0, 1.0) * ${p}MaskScale).r;`
    : '';
  const uniforms = [
    `uniform float ${p}Speed;`,
    `uniform float ${p}Strength;`,
    `uniform float ${p}Phase;`,
    `uniform float ${p}Power;`,
    `uniform float ${p}Ratio;`,
    `uniform float ${p}Scale;`,
    `uniform float ${p}Direction;`,
  ];
  if (stage.hasMask) {
    uniforms.push(`uniform sampler2D ${p}Mask;`, `uniform float ${p}MaskScale;`);
  }
  return {
    uniforms,
    code: /* glsl */ `
  vec2 warp_${p}(vec2 uv) {
    // effects/foliagesway MODE == 0 (UV distortion).
    float noise = fbm(uv * max(${p}Scale * 60.0, 0.25) + 11.7);
    float amp = ${p}Strength * ${p}Strength * 0.005;
    ${maskSample}
    vec2 rotated = rotateUv(uv, ${p}Direction);
    float phase = (noise * PI * 2.0 + rotated.x * 10.0 + rotated.y * 5.0) * ${p}Phase;

    float time = ${p}Speed * uTime;
    vec4 sines = sin(phase + time * vec4(1.0, -0.16161616, 0.0083333, -0.00019841));
    vec4 csines = sin(
      0.4 + phase + time * vec4(-0.5, 0.041666666, -0.0013888889, 0.000024801587)
    );

    sines = pow(abs(sines), vec4(${p}Power)) * sign(sines);
    csines = pow(abs(csines), vec4(${p}Power)) * sign(csines);

    // Wallpaper Engine derives the aspect from the previous render target,
    // not from the artwork texture. In cover mode those differ.
    float aspect = uScreenAspect * ${p}Ratio;
    vec2 dir = rotateUv(vec2(1.0 / aspect, aspect), ${p}Direction);
    vec2 offset = vec2(
      dir.x * dot(sines, vec4(amp)),
      dir.y * dot(csines, vec4(amp))
    );
    return offset * uSwayAmount;
  }`,
    warp: `warp_${p}`,
  };
}

function emitWaterWaves(stage) {
  const p = stage.prefix;
  const maskSample = stage.hasMask
    ? `float mask = texture2D(${p}Mask, clamp(uv, 0.0, 1.0) * ${p}MaskScale).r;`
    : 'float mask = 1.0;';
  const uniforms = [
    `uniform float ${p}Direction;`,
    `uniform float ${p}Scale;`,
    `uniform float ${p}Speed;`,
    `uniform float ${p}Strength;`,
    `uniform float ${p}Perspective;`,
  ];
  if (stage.hasMask) {
    uniforms.push(`uniform sampler2D ${p}Mask;`, `uniform float ${p}MaskScale;`);
  }
  return {
    uniforms,
    code: /* glsl */ `
  vec2 warp_${p}(vec2 uv) {
    ${maskSample}
    vec2 dir = vec2(-sin(${p}Direction), cos(${p}Direction));
    vec2 tc = uv;
    float pos = abs(dot(tc - 0.5, dir));
    float distance = uTime * ${p}Speed + dot(tc, dir) * (${p}Scale + ${p}Perspective * pos);
    vec2 offset = vec2(dir.y, -dir.x);
    float strength = ${p}Strength * ${p}Strength + ${p}Perspective * pos;
    return sin(distance) * offset * strength * mask * uWaterAmount;
  }`,
    warp: `warp_${p}`,
  };
}

function emitWaterRipple(stage) {
  const p = stage.prefix;
  return {
    uniforms: [
      `uniform sampler2D ${p}Mask;`,
      `uniform sampler2D ${p}Normal;`,
      `uniform float ${p}MaskScale;`,
      `uniform float ${p}AnimSpeed;`,
      `uniform float ${p}Scale;`,
      `uniform float ${p}ScrollSpeed;`,
      `uniform float ${p}Direction;`,
      `uniform float ${p}Ratio;`,
      `uniform float ${p}Strength;`,
    ],
    code: /* glsl */ `
  vec2 warp_${p}(vec2 uv) {
    float mask = texture2D(${p}Mask, clamp(uv, 0.0, 1.0) * ${p}MaskScale).r;
    vec2 tc = uv;
    vec2 scroll = vec2(-sin(${p}Direction), cos(${p}Direction)) *
      ${p}ScrollSpeed * ${p}ScrollSpeed * uTime;
    float travel = uTime * ${p}AnimSpeed * ${p}AnimSpeed;

    vec4 ripple;
    ripple.xy = tc + travel + scroll;
    ripple.zw = tc * 1.333 - travel + scroll;
    ripple *= ${p}Scale;
    ripple.xz *= max(uImageAspect, 1e-4);
    ripple.yw *= ${p}Ratio;

    vec3 n1 = texture2D(${p}Normal, ripple.xy).xyz * 2.0 - 1.0;
    vec3 n2 = texture2D(${p}Normal, ripple.zw).xyz * 2.0 - 1.0;
    vec3 normal = normalize(vec3(n1.xy + n2.xy, n1.z));
    return normal.xy * ${p}Strength * ${p}Strength * mask * uWaterAmount;
  }`,
    warp: `warp_${p}`,
  };
}

function emitWaterFlow(stage) {
  const p = stage.prefix;
  return {
    uniforms: [
      `uniform sampler2D ${p}Mask;`,
      `uniform sampler2D ${p}Phase;`,
      `uniform float ${p}MaskScale;`,
      `uniform float ${p}Speed;`,
      `uniform float ${p}Strength;`,
      `uniform float ${p}PhaseScale;`,
    ],
    code: /* glsl */ `
  vec3 flow_${p}(vec3 prev, vec2 uv) {
    vec2 flowColors = texture2D(${p}Mask, clamp(uv, 0.0, 1.0) * ${p}MaskScale).rg;
    vec2 flowMask = (flowColors - vec2(0.498)) * 2.0;
    float flowAmount = clamp(length(flowMask), 0.0, 1.0);
    if (flowAmount <= 0.001) return prev;

    float flowPhase = texture2D(${p}Phase, uv * ${p}PhaseScale).r;
    float t = uTime * ${p}Speed;
    float c0 = fract(t);
    float c1 = fract(t + 0.5);
    float c2 = fract(0.25 + t);
    float c3 = fract(0.25 + t + 0.5);
    float blend = 2.0 * abs(c0 - 0.5);
    float blend2 = 2.0 * abs(c2 - 0.5);

    vec4 cycles = vec4(c0, c1, c2, c3) - 0.5;
    vec4 offA = (flowMask.xyxy * ${p}Strength * 0.1) * cycles.xxyy;
    vec4 offB = (flowMask.xyxy * ${p}Strength * 0.1) * cycles.zzww;

    // uv is already displaced by the warp chain. Sampling the artwork with
    // the flow offset directly avoids re-running every warp pass per tap
    // (12 effects x 4 taps would otherwise be 48 extra mask fetches / pixel).
    vec3 a = mix(
      texture2D(uTex, clamp(uv + offA.xy, 0.0, 1.0)).rgb,
      texture2D(uTex, clamp(uv + offA.zw, 0.0, 1.0)).rgb,
      blend
    );
    vec3 b = mix(
      texture2D(uTex, clamp(uv + offB.xy, 0.0, 1.0)).rgb,
      texture2D(uTex, clamp(uv + offB.zw, 0.0, 1.0)).rgb,
      blend2
    );
    a = mix(a, b, smoothstep(0.2, 0.8, flowPhase));
    return mix(prev, a, flowAmount * uWaterAmount);
  }`,
    flow: `flow_${p}`,
  };
}

const SCENE_EMITTERS = {
  shake: emitShake,
  foliagesway: emitFoliage,
  waterwaves: emitWaterWaves,
  waterripple: emitWaterRipple,
  waterflow: emitWaterFlow,
};

/**
 * Compile a scene effect pipeline into a single fragment shader.
 *
 * @param {Array<{type:string,prefix:string,hasMask?:boolean,hasNormal?:boolean,
 *   hasPhase?:boolean,maskScale?:number}>} stages
 */
export function buildSceneShader(stages = []) {
  const declarations = [];
  const warpCode = [];
  const flowCode = [];
  const warps = [];
  const flows = [];

  for (const stage of stages) {
    const emitter = SCENE_EMITTERS[stage.type];
    if (!emitter) continue;
    const built = emitter(stage);
    declarations.push(...built.uniforms);
    if (built.warp) {
      warpCode.push(built.code);
      warps.push(built.warp);
    }
    if (built.flow) {
      flowCode.push(built.code);
      flows.push(built.flow);
    }
  }

  // Wallpaper Engine applies the effect array top-to-bottom. Each pass reads
  // the previous pass output, so pass 1 must run first and pass N last.
  const warpBody = warps
    .map((fn) => `    uv += ${fn}(uv);`)
    .join('\n');

  const flowBody = flows.map((fn) => `    col = ${fn}(col, warpedUv);`).join('\n');

  return `${SCENE_HEADER}

${declarations.join('\n')}

${warpCode.join('\n')}

  vec2 warpAll(vec2 uv) {
${warpBody || '    // no displacement effects'}
    return uv;
  }

  vec3 sampleWarped(vec2 uv) {
    return texture2D(uTex, clamp(warpAll(uv), 0.0, 1.0)).rgb;
  }

${flowCode.join('\n')}

  void main() {
    // Screen-space UV: independent of the (enlarged) background quad, so the
    // artwork fills the window exactly like Wallpaper Engine's ortho camera.
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    screenUv.y = 1.0 - screenUv.y; // top-left origin, matching WE texture space

    vec2 sceneUv = fitUv(screenUv);
    // Scene quads in Wallpaper Engine are slightly enlarged (scale 1.05).
    // Cover mode reproduces that crop; stretch must keep the full frame.
    if (uFitMode < 0.5) sceneUv = (sceneUv - 0.5) * TEX_MARGIN + 0.5;

    // cameraparallax: amount 0.1, mouseinfluence 0.5 (normalized to taste).
    sceneUv += uMouse * vec2(0.012, 0.0085) * uParallax;

    vec2 warpedUv = clamp(warpAll(sceneUv), 0.0, 1.0);
    vec3 col = texture2D(uTex, warpedUv).rgb;
${flowBody || '    // no flow composites'}
    col *= 1.0 - uDim * 0.62;

    // contain: flat letterbox instead of smearing the clamped edge pixels.
    float inside = 1.0;
    if (uFitMode > 1.5) {
      inside = step(0.0, sceneUv.x) * step(sceneUv.x, 1.0) *
               step(0.0, sceneUv.y) * step(sceneUv.y, 1.0);
    }
    col = mix(vec3(0.012, 0.020, 0.035), col, inside);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

/**
 * Baked ("lite") scene pass.
 *
 * A full Wallpaper Engine scene replays every imported effect in one fragment
 * shader: up to four warp functions, several textures and a lot of ALU per
 * pixel, every frame. That is the single most expensive thing this project can
 * put behind an editor.
 *
 * The bake keeps the artwork plus up to two amplitude masks and replaces the
 * per-effect chain with two cheap mask-driven displacements. Visually it reads
 * as the same swaying/rippling wallpaper at a fraction of the cost; the exact
 * effect chain stays available when the user turns baking off.
 */
export const sceneLiteFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;
  uniform sampler2D uMaskA;
  uniform sampler2D uMaskB;
  uniform float uHasMaskA;
  uniform float uHasMaskB;
  uniform float uTime;
  uniform float uParallax;
  uniform float uDim;
  uniform float uScreenAspect;
  uniform float uImageAspect;
  uniform float uFitMode;
  uniform float uSway;
  uniform float uWater;
  uniform vec2 uMouse;

  varying vec2 vUv;

  vec2 coverUv(vec2 uv) {
    float sa = uScreenAspect;
    float ia = uImageAspect;
    if (sa > ia) {
      uv.y = (uv.y - 0.5) * (ia / sa) + 0.5;
    } else {
      uv.x = (uv.x - 0.5) * (sa / ia) + 0.5;
    }
    return uv;
  }

  vec2 containUv(vec2 uv) {
    float sa = uScreenAspect;
    float ia = uImageAspect;
    if (sa > ia) {
      uv.x = (uv.x - 0.5) * (sa / ia) + 0.5;
    } else {
      uv.y = (uv.y - 0.5) * (ia / sa) + 0.5;
    }
    return uv;
  }

  void main() {
    vec2 sceneUv = vUv;
    if (uFitMode > 1.5) {
      sceneUv = containUv(sceneUv);
    } else if (uFitMode > 0.5) {
      sceneUv = clamp(sceneUv, 0.0, 1.0);
    } else {
      sceneUv = coverUv((sceneUv - 0.5) * 0.952 + 0.5);
    }

    sceneUv += uMouse * vec2(0.012, 0.0085) * uParallax;

    float t = uTime;
    vec2 disp = vec2(0.0);
    if (uHasMaskA > 0.5 && uSway > 0.001) {
      float amp = texture2D(uMaskA, clamp(sceneUv, 0.0, 1.0)).r;
      disp += vec2(
        sin(sceneUv.y * 16.0 + t * 0.8),
        cos(sceneUv.x * 13.0 + t * 0.62)
      ) * 0.0022 * uSway * amp;
    }
    if (uHasMaskB > 0.5 && uWater > 0.001) {
      float amp = texture2D(uMaskB, clamp(sceneUv + vec2(t * 0.004, 0.0), 0.0, 1.0)).r;
      disp += vec2(
        sin(sceneUv.y * 44.0 + t * 1.7),
        cos(sceneUv.x * 37.0 + t * 1.4)
      ) * 0.0012 * uWater * amp;
    }

    vec3 col = texture2D(uTex, clamp(sceneUv + disp, 0.0, 1.0)).rgb;
    col *= 1.0 - uDim * 0.62;

    float inside = 1.0;
    if (uFitMode > 1.5) {
      inside = step(0.0, sceneUv.x) * step(sceneUv.x, 1.0) *
               step(0.0, sceneUv.y) * step(sceneUv.y, 1.0);
    }
    col = mix(vec3(0.012, 0.020, 0.035), col, inside);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export const gradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 0.5 },
    uVignette: { value: 1 },
    uAberration: { value: 1 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAberration;
    varying vec2 vUv;

    float hash(vec2 p) {
      p = fract(p * vec2(443.897, 441.423));
      p += dot(p, p + 19.19);
      return fract(p.x * p.y);
    }

    void main() {
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float ab = 0.00055 * uAberration * (0.35 + dot(d, d) * 2.0);

      vec3 col;
      col.r = texture2D(tDiffuse, uv + d * ab).r;
      col.g = texture2D(tDiffuse, uv).g;
      col.b = texture2D(tDiffuse, uv - d * ab).b;

      float vig = smoothstep(0.95, 0.28, length(d));
      col *= mix(1.0, vig, uVignette * 0.42);

      float n = hash(uv * vec2(1920.0, 1080.0) + fract(uTime) * 317.0) - 0.5;
      col += n * 0.020 * uGrain;

      gl_FragColor = vec4(col, 1.0);
    }
  `,
};
