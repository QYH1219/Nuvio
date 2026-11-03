import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrl } from '../assets.js';

const RIM_VERT = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vView = -mv.xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const RIM_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uStrength;
  varying vec3 vNormal;
  varying vec3 vView;
  void main() {
    float f = pow(1.0 - abs(dot(normalize(vNormal), normalize(vView))), 2.1);
    gl_FragColor = vec4(uColor * f * uStrength, f * uStrength);
  }
`;

function rimMaterial(color, strength = 0.9) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uStrength: { value: strength },
    },
    vertexShader: RIM_VERT,
    fragmentShader: RIM_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide,
  });
}

export class ModelLayer {
  constructor(scene, renderer) {
    this.renderer = renderer;
    this.root = new THREE.Group();
    this.spinner = new THREE.Group();
    this.root.add(this.spinner);
    scene.add(this.root);

    this.baseScale = 1;
    this.enter = 0;
    this.mixer = null;
    this.loaded = false;
    this.source = 'placeholder';

    this.buildPlaceholder();
  }

  buildPlaceholder() {
    const group = new THREE.Group();

    const core = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.02, 1),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color('#0c1a1f'),
        emissive: new THREE.Color('#0d4b4d'),
        emissiveIntensity: 0.55,
        metalness: 0.92,
        roughness: 0.18,
        flatShading: true,
      }),
    );
    group.add(core);

    const wire = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.46, 1),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color('#5fe3d6'),
        wireframe: true,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    group.add(wire);

    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(1.1, 1),
      rimMaterial('#7ff2e8', 0.5),
    );
    group.add(shell);

    for (let i = 0; i < 2; i += 1) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.85 + i * 0.16, 0.008, 6, 220),
        new THREE.MeshBasicMaterial({
          color: new THREE.Color(i === 0 ? '#8ef4ff' : '#9c8cff'),
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      );
      ring.rotation.x = Math.PI * 0.5 + (i === 0 ? 0.35 : -0.5);
      ring.rotation.y = i === 0 ? 0.2 : -0.35;
      ring.userData.spin = i === 0 ? 0.18 : -0.12;
      group.add(ring);
    }

    group.scale.setScalar(1.02);
    this.spinner.add(group);
    this.placeholder = group;
    this.focus = group;
  }

  async load(url, onProgress) {
    this.loader = new GLTFLoader();

    // Tripo exports sometimes use Draco, Meshopt, or KTX2. Keep the decoders
    // local so the built bundle works offline and inside Codex.
    const draco = new DRACOLoader();
    draco.setDecoderPath(assetUrl('vendor/draco/'));
    this.loader.setDRACOLoader(draco);
    this.loader.setMeshoptDecoder(MeshoptDecoder);

    if (this.renderer) {
      const ktx2 = new KTX2Loader();
      ktx2.setTranscoderPath(assetUrl('vendor/basis/'));
      ktx2.detectSupport(this.renderer);
      this.loader.setKTX2Loader(ktx2);
    }

    const gltf = await this.loader.loadAsync(
      url,
      (event) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      },
    );

    const object = gltf.scene;
    object.updateMatrixWorld(true);

    const box = new THREE.Box3().setFromObject(object);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    const scale = 3.35 / maxDim;

    object.scale.setScalar(scale);
    object.position.set(-center.x * scale, -center.y * scale, -center.z * scale);

    let shellCount = 0;
    object.traverse((node) => {
      if (!node.isMesh) return;
      node.castShadow = false;
      node.receiveShadow = false;
      node.frustumCulled = false;

      const materials = Array.isArray(node.material) ? node.material : [node.material];
      materials.forEach((mat) => {
        if (mat && mat.isMeshStandardMaterial) {
          mat.envMapIntensity = 1.15;
        }
      });

      if (!node.isSkinnedMesh && shellCount < 48 && node.geometry) {
        const shell = new THREE.Mesh(node.geometry, rimMaterial('#6ee9ff', 0.38));
        shell.scale.setScalar(1.012);
        shell.renderOrder = 2;
        node.add(shell);
        shellCount += 1;
      }
    });

    if (gltf.animations && gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(object);
      gltf.animations.forEach((clip) => this.mixer.clipAction(clip).play());
    }

    if (this.placeholder) {
      this.spinner.remove(this.placeholder);
      this.placeholder.traverse((node) => {
        if (node.geometry) node.geometry.dispose();
        if (node.material) {
          if (Array.isArray(node.material)) node.material.forEach((m) => m.dispose());
          else node.material.dispose();
        }
      });
      this.placeholder = null;
    }

    this.spinner.add(object);
    this.focus = object;
    this.source = url;
    this.loaded = true;
  }

  update(dt, time, mouse, config) {
    this.enter = Math.min(1, this.enter + dt * 0.9);
    const eased = 1 - Math.pow(1 - this.enter, 3);
    const scale = config.modelScale * (0.88 + 0.12 * eased);

    this.root.position.x = config.modelX * 2.4;
    this.root.position.y = config.modelY * 1.6 + Math.sin(time * 0.75) * 0.055;
    this.root.scale.setScalar(scale);

    const spin = dt * 0.22 * config.modelSpin * config.motion;
    this.spinner.rotation.y += spin;

    const tiltX = -mouse.y * 0.10 * config.parallax;
    const tiltY = mouse.x * 0.18 * config.parallax;
    this.root.rotation.x += (tiltX - this.root.rotation.x) * 0.05;
    this.root.rotation.y += (tiltY - this.root.rotation.y) * 0.05;

    if (this.root) {
      this.root.visible = this.enter > 0.001;
    }
    if (this.placeholder) {
      this.placeholder.children.forEach((child) => {
        if (child.userData.spin) child.rotation.z += spin * child.userData.spin * 4;
      });
    }
    if (this.mixer) this.mixer.update(dt * Math.max(0.2, config.motion));
  }
}
