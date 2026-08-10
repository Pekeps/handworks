/**
 * Procedural skin material — generated at runtime from seeded noise, so it
 * ships no image assets, works offline and matches any UV layout. Albedo
 * gets low-frequency tonal mottling, bump carries pore-level detail,
 * roughness varies subtly, and sheen approximates the soft backscatter of
 * real skin.
 */
import {
  CanvasTexture,
  Color,
  MeshPhysicalMaterial,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';

export interface SkinOptions {
  /** base tone: css color / hex number, or a SKIN_TONES key (default 'fair') */
  tone?: string | number;
  /** base roughness, default 0.55 */
  roughness?: number;
  /** pore/micro-wrinkle strength, default 1 (0 disables) */
  detail?: number;
  /** texture resolution, default 512 */
  textureSize?: number;
}

/** A few ready-made tones; any css color works too. */
export const SKIN_TONES: Record<string, number> = {
  porcelain: 0xf2dfd0,
  fair: 0xe9c6ad,
  tan: 0xd3a988,
  olive: 0xbd9a77,
  brown: 0x93684a,
  deep: 0x5f4433,
};

/** deterministic PRNG so the texture is identical every run */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** tileable multi-octave value noise in [0,1] */
function makeNoise(size: number, octaves: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const out = new Float32Array(size * size);
  let amp = 1;
  let total = 0;
  for (let oct = 0; oct < octaves; oct++) {
    const cells = 4 << oct; // 4, 8, 16, …
    const grid = new Float32Array(cells * cells);
    for (let i = 0; i < grid.length; i++) grid[i] = rand();
    const smooth = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < size; y++) {
      const gy = (y / size) * cells;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      const ty = smooth(gy - Math.floor(gy));
      for (let x = 0; x < size; x++) {
        const gx = (x / size) * cells;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        const tx = smooth(gx - Math.floor(gx));
        const v =
          grid[y0 * cells + x0]! * (1 - tx) * (1 - ty) +
          grid[y0 * cells + x1]! * tx * (1 - ty) +
          grid[y1 * cells + x0]! * (1 - tx) * ty +
          grid[y1 * cells + x1]! * tx * ty;
        out[y * size + x] = out[y * size + x]! + v * amp;
      }
    }
    total += amp;
    amp *= 0.55;
  }
  for (let i = 0; i < out.length; i++) out[i] = out[i]! / total;
  return out;
}

function canvasTexture(
  size: number,
  fill: (i: number, data: Uint8ClampedArray) => void,
  srgb: boolean,
): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) fill(i, img.data);
  ctx.putImageData(img, 0, 0);
  const tex = new CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  // rows are written in the glTF UV convention (v = row/size), so the
  // texture must not be flipped on upload — required for the 1:1 crease map
  tex.flipY = false;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  return tex;
}

/**
 * Build the skin material. `crease` is an optional 1:1 UV-space crease map
 * (see creases.ts) baked from the mesh — creases darken the albedo, groove
 * the bump map and roughen the surface exactly where real hands crease.
 * Call `dispose()` on the old material when swapping.
 */
export function createSkinMaterial(
  options: SkinOptions = {},
  crease?: { data: Float32Array; palm: Float32Array; size: number },
): MeshPhysicalMaterial {
  const size = crease?.size ?? options.textureSize ?? 512;
  const detail = options.detail ?? 1;
  const base = new Color(
    typeof options.tone === 'string' && options.tone in SKIN_TONES
      ? SKIN_TONES[options.tone]!
      : (options.tone ?? SKIN_TONES.fair!),
  );

  const noiseSize = 512;
  const mottle = makeNoise(noiseSize, 3, 101); // slow tonal variation
  const pores = makeNoise(noiseSize, 5, 303); // high-frequency detail
  const wrinkle = makeNoise(noiseSize, 6, 404); // finest micro-wrinkles

  // noise tiles across the (possibly larger) crease-map resolution
  const noiseAt = (arr: Float32Array, i: number): number => {
    const x = (i % size) % noiseSize;
    const y = Math.floor(i / size) % noiseSize;
    return arr[y * noiseSize + x]!;
  };
  const creaseAt = (i: number): number => (crease ? crease.data[i]! : 0);
  const palmAt = (i: number): number => (crease ? crease.palm[i]! : 0);

  // real hands: the palm is lighter, less saturated and evenly toned; the
  // back is warmer with visible micro-texture
  const lum = 0.3 * base.r + 0.55 * base.g + 0.15 * base.b;

  const albedo = canvasTexture(
    size,
    (i, d) => {
      const pm = palmAt(i);
      const m = (noiseAt(mottle, i) - 0.5) * 0.05 * (1 - pm * 0.7); // subtle, mostly on the back
      const p = (noiseAt(pores, i) - 0.5) * 0.028 * detail;
      const k = creaseAt(i) * 0.26; // creases darken, slightly warm
      // palm: lighter and pushed toward neutral
      const lift = 1 + pm * 0.11;
      const mix = pm * 0.25;
      let r = (base.r * (1 - mix) + lum * 1.12 * mix) * lift;
      let g = (base.g * (1 - mix) + lum * 1.12 * mix) * lift;
      let b = (base.b * (1 - mix) + lum * 1.12 * mix) * lift;
      r = r * (1 + m + p) * (1 - k * 0.75);
      g = g * (1 + m + p) * (1 - k);
      b = b * (1 + m + p) * (1 - k * 1.1);
      d[i * 4] = Math.min(255, Math.max(0, r * 255));
      d[i * 4 + 1] = Math.min(255, Math.max(0, g * 255));
      d[i * 4 + 2] = Math.min(255, Math.max(0, b * 255));
      d[i * 4 + 3] = 255;
    },
    true,
  );

  const bump = canvasTexture(
    size,
    (i, d) => {
      const pm = palmAt(i);
      // back of hand: pronounced micro-wrinkle network; palm: fine and even
      const micro =
        (noiseAt(pores, i) - 0.5) * (0.35 + (1 - pm) * 0.35) +
        (noiseAt(wrinkle, i) - 0.5) * (0.25 + (1 - pm) * 0.3);
      const v = (0.55 + micro * detail - creaseAt(i) * 0.5) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.min(255, Math.max(0, v));
      d[i * 4 + 3] = 255;
    },
    false,
  );

  const rough = canvasTexture(
    size,
    (i, d) => {
      // roughnessMap uses the green channel; palms are slightly glossier
      const v =
        (0.85 - palmAt(i) * 0.07 + (noiseAt(pores, i) - 0.5) * 0.25 + creaseAt(i) * 0.12) * 255;
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.min(255, Math.max(0, v));
      d[i * 4 + 3] = 255;
    },
    false,
  );

  return new MeshPhysicalMaterial({
    map: albedo,
    bumpMap: bump,
    bumpScale: 0.6 * detail,
    roughnessMap: rough,
    roughness: options.roughness ?? 0.55,
    metalness: 0,
    // soft backscatter — reads as the subsurface glow of real skin
    sheen: 0.35,
    sheenRoughness: 0.6,
    sheenColor: new Color(0xffd7c2),
    specularIntensity: 0.5,
  });
}
