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

  void main() {
    float t = uTime;
    vec2 uv = vUv;

    float breath = 1.0 + 0.010 * sin(t * 0.11) * uMotion;
    if (uFitMode > 0.5) {
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
 * This is a direct port of the two effect shaders used by the imported
 * wallpaper: effects/shake (flow-map UV shake) and effects/foliagesway
 * (MODE=0, noise + sine UV distortion). Math and defaults mirror the
 * original .frag/.vert files; the image is sampled in screen space so the
 * background keeps cover-fit on any window aspect ratio.
 */
export const sceneVertex = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

export const sceneFragment = /* glsl */ `
  precision highp float;

  uniform sampler2D uTex;
  uniform sampler2D uShake0;
  uniform sampler2D uShake1;
  uniform sampler2D uShake2;

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
  uniform float uMaskScale;
  uniform float uShakeSpeed;
  uniform float uShakeStrength;
  uniform vec2 uShakeFriction;
  uniform vec2 uShakeBounds;

  uniform float uSwaySpeed;
  uniform float uSwayStrength;
  uniform float uSwayPhase;
  uniform float uSwayPower;
  uniform float uSwayRatio;
  uniform float uSwayScale;
  uniform float uSwayDirection;

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

  /*
   * fit=cover crops the artwork to the window; fit=stretch keeps every pixel
   * and lets the aspect ratio follow the window. The default scene wallpaper
   * uses stretch so the whole illustration stays visible inside Codex.
   */
  vec2 fitUv(vec2 uv) {
    return uFitMode > 0.5 ? uv : coverUv(uv, uScreenAspect, uImageAspect);
  }

  /*
   * effects/shake.vert scales the flow-map lookup by maskSize / imageSize;
   * the mask here is half-resolution, so uMaskScale is ~0.5.
   */
  vec2 shakeOffset(vec2 uv, sampler2D flowMap) {
    vec2 flowColors = texture2D(flowMap, uv * uMaskScale).rg;
    vec2 flowMask = (flowColors - vec2(0.498)) * 2.0;

    float time = uShakeSpeed * uTime;
    float offset = sin(fract(time / HALF_PI) * HALF_PI);
    offset = offset * 0.498 + 0.5;
    float base = step(0.0, cos(time));
    offset = mix(
      1.0 - pow(1.0 - offset, uShakeFriction.x),
      pow(offset, uShakeFriction.y),
      base
    );
    offset = clamp((offset - uShakeBounds.x) / max(uShakeBounds.y - uShakeBounds.x, 1e-5), 0.0, 1.0);
    offset = offset * 2.0 - 1.0; // DIRECTION == center

    return offset * uShakeStrength * uShakeStrength * flowMask;
  }

  // effects/foliagesway with MODE == 0 (UV distortion) and MASK disabled.
  vec2 swayOffset(vec2 uv) {
    // The original samples util/noise at uv * scale. Keep the parameter live
    // and map it onto the same low-frequency range for the procedural noise.
    float noise = fbm(uv * max(uSwayScale * 60.0, 0.25) + 11.7);
    float amp = uSwayStrength * uSwayStrength * 0.005;
    vec2 rotated = rotateUv(uv, uSwayDirection);
    float phase = (noise * PI * 2.0 + rotated.x * 10.0 + rotated.y * 5.0) * uSwayPhase;

    float time = uSwaySpeed * uTime;
    vec4 sines = sin(phase + time * vec4(1.0, -0.16161616, 0.0083333, -0.00019841));
    vec4 csines = sin(0.4 + phase + time * vec4(-0.5, 0.041666666, -0.0013888889, 0.000024801587));

    sines = pow(abs(sines), vec4(uSwayPower)) * sign(sines);
    csines = pow(abs(csines), vec4(uSwayPower)) * sign(csines);

    float aspect = uImageAspect * uSwayRatio;
    vec2 dir = rotateUv(vec2(1.0 / aspect, aspect), uSwayDirection);
    vec2 offset = vec2(
      dir.x * dot(sines, vec4(amp)),
      dir.y * dot(csines, vec4(amp))
    );
    return offset * uSwayAmount;
  }

  void main() {
    // Screen-space UV: independent of the (enlarged) background quad, so the
    // artwork fills the window exactly like Wallpaper Engine's ortho camera.
    vec2 screenUv = gl_FragCoord.xy / max(uResolution, vec2(1.0));
    screenUv.y = 1.0 - screenUv.y; // top-left origin, matching WE texture space

    vec2 uv = fitUv(screenUv);
    // Scene quads in Wallpaper Engine are slightly enlarged (scale 1.05).
    // Cover mode reproduces that crop; stretch must keep the full frame.
    if (uFitMode < 0.5) uv = (uv - 0.5) * TEX_MARGIN + 0.5;

    // cameraparallax: amount 0.1, mouseinfluence 0.5 (normalized to taste).
    uv += uMouse * vec2(0.012, 0.0085) * uParallax;

    // Effect chain from scene.json is applied last-to-first, because each
    // pass samples the previous render target.
    uv += shakeOffset(uv, uShake2);
    uv += shakeOffset(uv, uShake1);
    uv += shakeOffset(uv, uShake0);
    uv += swayOffset(uv);

    // Effects can push UVs past the artwork edge. Clamp instead of revealing
    // empty texture space, so stretch mode never loses part of the image.
    uv = clamp(uv, 0.0, 1.0);

    vec3 col = texture2D(uTex, uv).rgb;
    col *= 1.0 - uDim * 0.62;

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
