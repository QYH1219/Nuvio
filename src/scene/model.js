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

function createGLTFLoader(renderer) {
  const loader = new GLTFLoader();

  // Tripo exports sometimes use Draco, Meshopt, or KTX2. Keep the decoders
  // local so the built bundle works offline and inside Codex.
  const draco = new DRACOLoader();
  draco.setDecoderPath(assetUrl('vendor/draco/'));
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);

  let ktx2 = null;
  if (renderer) {
    ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(assetUrl('vendor/basis/'));
    ktx2.detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
  }

  // Keep the helper loaders reachable so they can release their workers after
  // parsing. A fresh loader per import avoids "multiple active loaders" warnings.
  loader.userData = { draco, ktx2 };
  return loader;
}

function disposeLoader(loader) {
  try {
    loader?.userData?.draco?.dispose();
  } catch {
    /* ignore */
  }
  try {
    loader?.userData?.ktx2?.dispose();
  } catch {
    /* ignore */
  }
}

function disposeObject(root) {
  if (!root) return;
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();

  root.traverse((node) => {
    if (node.geometry) geometries.add(node.geometry);
    const list = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    list.forEach((material) => {
      materials.add(material);
      Object.values(material).forEach((value) => {
        if (value && value.isTexture) textures.add(value);
      });
    });
  });

  geometries.forEach((geometry) => geometry.dispose());
  textures.forEach((texture) => texture.dispose());
  materials.forEach((material) => material.dispose());
}

/**
 * Validate a GLB without replacing the currently displayed model. This is used
 * before a picked file is written to IndexedDB so a corrupt file cannot evict
 * the user's last working asset.
 */
export async function validateModelUrl(url, renderer) {
  const loader = createGLTFLoader(renderer);
  let scene = null;
  try {
    const gltf = await loader.loadAsync(url);
    scene = gltf?.scene || null;
    if (!scene) throw new Error('模型没有场景节点');

    let meshCount = 0;
    scene.traverse((node) => {
      if (node.isMesh) meshCount += 1;
    });
    if (!meshCount) throw new Error('模型中没有可渲染的 Mesh');
    return true;
  } finally {
    disposeObject(scene);
    disposeLoader(loader);
  }
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
    this.loadedObject = null;
    this.source = 'placeholder';
    this.disposed = false;

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
    const loader = createGLTFLoader(this.renderer);
    this.loader = loader;

    let gltf;
    try {
      gltf = await loader.loadAsync(url, (event) => {
        if (onProgress && event.total) onProgress(event.loaded / event.total);
      });
    } finally {
      disposeLoader(loader);
      if (this.loader === loader) this.loader = null;
    }

    if (this.disposed) {
      disposeObject(gltf?.scene);
      return;
    }

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

    // Keep the placeholder alive but hidden so clearing a user model can
    // restore the procedural crystal without rebuilding the scene.
    this.removeLoaded();
    if (this.placeholder) {
      this.placeholder.visible = false;
      if (this.placeholder.parent === this.spinner) this.spinner.remove(this.placeholder);
    }

    this.spinner.add(object);
    this.loadedObject = object;
    this.focus = object;
    this.source = url;
    this.loaded = true;
    this.enter = 0;
  }

  disposeObject(root) {
    disposeObject(root);
  }

  /** Drop the current GLB and show the procedural placeholder again. */
  removeLoaded() {
    if (this.mixer) {
      try {
        this.mixer.stopAllAction();
        if (this.focus) this.mixer.uncacheRoot(this.focus);
      } catch {
        /* ignore */
      }
      this.mixer = null;
    }

    if (this.loadedObject) {
      this.spinner.remove(this.loadedObject);
      this.disposeObject(this.loadedObject);
      this.loadedObject = null;
    }

    if (this.placeholder) {
      if (this.placeholder.parent !== this.spinner) this.spinner.add(this.placeholder);
      this.placeholder.visible = true;
      this.focus = this.placeholder;
    } else {
      this.focus = null;
    }

    this.loaded = false;
    this.source = 'placeholder';
    this.enter = 0;
  }

  clear() {
    this.removeLoaded();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.removeLoaded();
    if (this.placeholder) {
      this.disposeObject(this.placeholder);
      this.placeholder = null;
    }
    this.focus = null;
    if (this.root.parent) this.root.parent.remove(this.root);
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
