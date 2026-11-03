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
    uv = (uv - 0.5) * breath + 0.5;
    uv = coverUv(uv);

    vec2 drift = vec2(sin(t * 0.041), cos(t * 0.036)) * 0.0045 * uMotion;
    vec2 par = uMouse * vec2(0.015, 0.0095) * uParallax;
    uv += drift + par;

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
