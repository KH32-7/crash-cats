import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Higgsfield-generated assets (see artifacts/game-progress.md for job ids). */
const BASE = import.meta.env.BASE_URL;

export const ASSET_URLS = {
  cat: `${BASE}assets/models/cat.glb`,
  dozer: `${BASE}assets/models/dozer.glb`,
  bg: {
    skate: `${BASE}assets/img/bg_skate.jpg`,
    harbor: `${BASE}assets/img/bg_harbor.jpg`,
    airport: `${BASE}assets/img/bg_airport.jpg`,
    warehouse: `${BASE}assets/img/bg_warehouse.jpg`,
    garage: `${BASE}assets/img/bg_garage.jpg`,
  },
};

/**
 * Orientation fix-ups for the generated GLBs (they come out centered, ~1 unit tall).
 * Car-local convention: +x forward, +y up, the camera looks down -z (we see the +z side).
 */
// Native GLB front is +x; turn 3/4 toward the camera (+z) for a readable face.
const CAT_FIX = { yaw: -0.6, height: 0.62 };
const DOZER_FIX = { yaw: 0, height: 2.7 };

export interface CatTint {
  /** Multiplies the albedo after desaturation. */
  tint: THREE.ColorRepresentation;
  /** 1 = original colors, 0 = grayscale. */
  saturation: number;
}

export const CAT_TINTS: CatTint[] = [
  { tint: '#ffffff', saturation: 1 }, // orange tabby (player)
  { tint: '#b9c2d6', saturation: 0.05 }, // gray tomcat
  { tint: '#4a4550', saturation: 0.0 }, // black cat
  { tint: '#fff1dc', saturation: 0.25 }, // cream siamese
];

export class Assets {
  private readonly loader = new GLTFLoader();
  private readonly textureLoader = new THREE.TextureLoader();
  private readonly textures = new Map<string, THREE.Texture>();
  private catTemplate: THREE.Group | null = null;
  private dozerTemplate: THREE.Group | null = null;
  private readonly catMaterials = new Map<number, THREE.Material>();

  async loadCore(onProgress?: (p: number) => void): Promise<void> {
    let done = 0;
    const total = 3;
    const tick = () => onProgress?.(++done / total);
    await Promise.all([
      this.loadModel(ASSET_URLS.cat, CAT_FIX).then((g) => {
        this.catTemplate = g;
        tick();
      }),
      this.loadModel(ASSET_URLS.dozer, DOZER_FIX).then((g) => {
        this.dozerTemplate = g;
        tick();
      }),
      this.texture(ASSET_URLS.bg.garage).then(tick),
    ]);
  }

  texture(url: string): Promise<THREE.Texture> {
    const cached = this.textures.get(url);
    if (cached) return Promise.resolve(cached);
    return new Promise((resolve, reject) => {
      this.textureLoader.load(
        url,
        (tex) => {
          tex.colorSpace = THREE.SRGBColorSpace;
          tex.anisotropy = 4;
          this.textures.set(url, tex);
          resolve(tex);
        },
        undefined,
        reject,
      );
    });
  }

  private async loadModel(url: string, fix: { yaw: number; height: number }): Promise<THREE.Group> {
    try {
      const gltf = await this.loader.loadAsync(url);
      const inner = gltf.scene;
      inner.rotation.y = fix.yaw;
      inner.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(inner);
      const size = box.getSize(new THREE.Vector3());
      const scale = fix.height / Math.max(1e-3, size.y);
      inner.scale.setScalar(scale);
      inner.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(inner);
      const center = box2.getCenter(new THREE.Vector3());
      // Origin at bottom-center.
      inner.position.set(-center.x, -box2.min.y, -center.z);
      inner.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
        }
      });
      const root = new THREE.Group();
      root.add(inner);
      return root;
    } catch (err) {
      console.warn('model load failed', url, err);
      return fallbackBox(fix.height);
    }
  }

  /** A fresh cat driver instance with a fur variant (0..3). Origin = seat contact, faces +x. */
  cat(variant: number): THREE.Group {
    const template = this.catTemplate ?? fallbackBox(0.6);
    const clone = template.clone(true);
    const mat = this.catMaterial(variant, template);
    if (mat) {
      clone.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.material = mat;
      });
    }
    return clone;
  }

  dozer(): THREE.Group {
    return (this.dozerTemplate ?? fallbackBox(2.6)).clone(true);
  }

  private catMaterial(variant: number, template: THREE.Group): THREE.Material | null {
    const key = ((variant % CAT_TINTS.length) + CAT_TINTS.length) % CAT_TINTS.length;
    const cached = this.catMaterials.get(key);
    if (cached) return cached;
    let base: THREE.MeshStandardMaterial | null = null;
    template.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!base && mesh.isMesh) base = mesh.material as THREE.MeshStandardMaterial;
    });
    if (!base) return null;
    const mat = (base as THREE.MeshStandardMaterial).clone();
    const tint = CAT_TINTS[key];
    const uTint = { value: new THREE.Color(tint.tint) };
    const uSat = { value: tint.saturation };
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uCatTint = uTint;
      shader.uniforms.uCatSat = uSat;
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uCatTint;\nuniform float uCatSat;')
        .replace(
          '#include <map_fragment>',
          '#include <map_fragment>\nfloat catL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));\ndiffuseColor.rgb = mix(vec3(catL), diffuseColor.rgb, uCatSat) * uCatTint;',
        );
    };
    mat.customProgramCacheKey = () => `cat-${key}`;
    this.catMaterials.set(key, mat);
    return mat;
  }
}

function fallbackBox(height: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(height * 0.6, height, height * 0.6),
    new THREE.MeshStandardMaterial({ color: '#e8742c' }),
  );
  m.position.y = height / 2;
  g.add(m);
  return g;
}
