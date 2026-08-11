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
import type { CreaseMap } from './creases.js';

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

/**
 * Tileable Worley (cellular) crack field in [0,1]: 0 on cell boundaries,
 * rising toward cell centres. Real skin micro-structure is a network of
 * polygonal plates separated by fine furrows — value noise can't produce
 * those ridge lines, which is what makes naive procedural skin look waxy.
 */
function makeCellular(size: number, cells: number, seed: number): Float32Array {
  const rand = mulberry32(seed);
  const px = new Float32Array(cells * cells);
  const py = new Float32Array(cells * cells);
  for (let i = 0; i < cells * cells; i++) {
    px[i] = rand();
    py[i] = rand();
  }
  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    const gy = y * scale;
    const cy = Math.floor(gy);
    for (let x = 0; x < size; x++) {
      const gx = x * scale;
      const cx = Math.floor(gx);
      let f1 = Infinity;
      let f2 = Infinity;
      for (let oy = -1; oy <= 1; oy++) {
        const ny = (cy + oy + cells) % cells;
        for (let ox = -1; ox <= 1; ox++) {
          const nx = (cx + ox + cells) % cells;
          const i = ny * cells + nx;
          const dx = cx + ox + px[i]! - gx;
          const dy = cy + oy + py[i]! - gy;
          const d = dx * dx + dy * dy;
          if (d < f1) {
            f2 = f1;
            f1 = d;
          } else if (d < f2) {
            f2 = d;
          }
        }
      }
      // distance from the cell boundary, normalised to cell size
      out[y * size + x] = Math.min(1, (Math.sqrt(f2) - Math.sqrt(f1)) * 1.6);
    }
  }
  return out;
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

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Build the skin material. `crease` is an optional 1:1 UV-space map set
 * (see creases.ts) baked from the mesh — creases darken and groove the
 * skin, veins cool it, knuckles and fingertips flush warm, and nail plates
 * are painted glossy with a lunula and free edge.
 * Call `dispose()` on the old material when swapping.
 */
export function createSkinMaterial(
  options: SkinOptions = {},
  crease?: CreaseMap,
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
  const plates = makeCellular(noiseSize, 116, 202); // polygonal micro-plates
  const platesCoarse = makeCellular(noiseSize, 52, 505); // secondary network

  // noise tiles across the (possibly larger) crease-map resolution
  const noiseAt = (arr: Float32Array, i: number): number => {
    const x = (i % size) % noiseSize;
    const y = Math.floor(i / size) % noiseSize;
    return arr[y * noiseSize + x]!;
  };
  const creaseAt = (i: number): number => (crease ? crease.data[i]! : 0);
  const palmAt = (i: number): number => (crease ? crease.palm[i]! : 0);
  const veinAt = (i: number): number => (crease ? crease.vein[i]! : 0);
  const flushAt = (i: number): number => (crease ? crease.flush[i]! : 0);
  const nailAt = (i: number): number => (crease ? crease.nail[i]! : 0);
  const nailTAt = (i: number): number => (crease ? crease.nailT[i]! : 0);
  // furrow lines of the micro-plate network, 1 on a furrow → 0 inside a plate
  const furrowAt = (i: number): number => 1 - clamp01(noiseAt(plates, i) / 0.34);
  const furrowCoarseAt = (i: number): number => 1 - clamp01(noiseAt(platesCoarse, i) / 0.24);

  // real hands: the palm is lighter, less saturated and evenly toned; the
  // back is warmer with visible micro-texture
  const lum = 0.3 * base.r + 0.55 * base.g + 0.15 * base.b;
  // blood shows through more on lighter skin
  const blood = 0.3 + 0.7 * lum;

  const albedo = canvasTexture(
    size,
    (i, d) => {
      const pm = palmAt(i);
      const m = (noiseAt(mottle, i) - 0.5) * 0.06 * (1 - pm * 0.7); // subtle, mostly on the back
      const p = (noiseAt(pores, i) - 0.5) * 0.028 * detail;
      const fw = furrowAt(i) * 0.022 * detail * (1 - pm * 0.4); // furrows shade slightly
      // creases darken slightly warm; noise breaks up their smooth edges so
      // they read as skin folds instead of painted strokes
      const k = creaseAt(i) * 0.17 * (0.7 + 0.6 * noiseAt(pores, i));
      const fl = flushAt(i) * blood;
      const vv = veinAt(i) * (0.25 + 0.75 * lum);
      // palm: lighter and pushed toward neutral
      const lift = 1 + pm * 0.11;
      const mx = pm * 0.25;
      let r = (base.r * (1 - mx) + lum * 1.12 * mx) * lift;
      let g = (base.g * (1 - mx) + lum * 1.12 * mx) * lift;
      let b = (base.b * (1 - mx) + lum * 1.12 * mx) * lift;
      const tex = 1 + m + p - fw;
      r *= tex * (1 + fl * 0.2) * (1 - vv * 0.1) * (1 - k * 0.75);
      g *= tex * (1 - fl * 0.09) * (1 - vv * 0.03) * (1 - k);
      b *= tex * (1 - fl * 0.1) * (1 + vv * 0.07) * (1 - k * 1.1);
      // nail plates: pink bed under the plate, pale lunula at the root,
      // translucent whitish free edge past the fingertip
      const nl = nailAt(i);
      if (nl > 0.02) {
        const nt = nailTAt(i);
        // translucent keratin over a pink bed: clearly lighter than the
        // surrounding skin, with a pale lunula and a whitish free edge
        let nr = base.r * 0.76 + 0.22;
        let ng = base.g * 0.72 + 0.17;
        let nb = base.b * 0.72 + 0.18;
        const lunula = clamp01(1 - nt / 0.22);
        nr = mix(nr, base.r * 0.55 + 0.42, lunula * 0.75);
        ng = mix(ng, base.g * 0.55 + 0.4, lunula * 0.75);
        nb = mix(nb, base.b * 0.55 + 0.38, lunula * 0.75);
        const edge = clamp01((nt - 0.78) / 0.22);
        nr = mix(nr, base.r * 0.42 + 0.52, edge * 0.8);
        ng = mix(ng, base.g * 0.42 + 0.49, edge * 0.8);
        nb = mix(nb, base.b * 0.42 + 0.44, edge * 0.8);
        // darker fold ring where the skin tucks around the plate
        const rim = nl * (1 - nl) * 4;
        r = mix(r, nr, nl * 0.92) * (1 - rim * 0.09);
        g = mix(g, ng, nl * 0.92) * (1 - rim * 0.12);
        b = mix(b, nb, nl * 0.92) * (1 - rim * 0.12);
      }
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
      const nl = nailAt(i);
      // polygonal plate furrows cut into the surface — deeper on the back
      // of the hand, finer and shallower on the palm
      const grooves =
        -(furrowAt(i) * 0.14 + furrowCoarseAt(i) * 0.08) * (0.55 + 0.45 * (1 - pm));
      const micro =
        grooves +
        (noiseAt(pores, i) - 0.5) * 0.22 +
        (noiseAt(wrinkle, i) - 0.5) * (0.14 + (1 - pm) * 0.14);
      let v = 0.6 + micro * detail - creaseAt(i) * 0.32 + veinAt(i) * 0.12;
      if (nl > 0.02) {
        // smooth domed plate with a groove where it meets the skin
        const dome = 0.62 + 0.2 * Math.sin(Math.PI * clamp01(nailTAt(i) * 1.02));
        v = mix(v, dome, clamp01(nl * 1.3)) - nl * (1 - nl) * 4 * 0.12;
      }
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.min(255, Math.max(0, v * 255));
      d[i * 4 + 3] = 255;
    },
    false,
  );

  const rough = canvasTexture(
    size,
    (i, d) => {
      const nl = nailAt(i);
      // roughnessMap uses the green channel; palms are slightly glossier,
      // flushed knuckle skin slightly rougher, nail plates polished
      let v =
        0.92 -
        palmAt(i) * 0.06 +
        (noiseAt(pores, i) - 0.5) * 0.22 +
        furrowAt(i) * 0.03 +
        creaseAt(i) * 0.12 +
        flushAt(i) * 0.05;
      v = mix(v, 0.34, clamp01(nl * 1.2));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = Math.min(255, Math.max(0, v * 255));
      d[i * 4 + 3] = 255;
    },
    false,
  );

  // clearcoat only on the nail plates — the wet-looking specular layer that
  // makes them read as keratin instead of painted-on skin
  const coat = canvasTexture(
    size,
    (i, d) => {
      const v = Math.min(255, Math.max(0, nailAt(i) * 255));
      d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v;
      d[i * 4 + 3] = 255;
    },
    false,
  );

  return new MeshPhysicalMaterial({
    map: albedo,
    bumpMap: bump,
    bumpScale: 0.65 * detail,
    roughnessMap: rough,
    roughness: options.roughness ?? 0.75,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatMap: coat,
    clearcoatRoughness: 0.3,
    // a whisper of backscatter — any more and the skin reads glowy/waxy
    sheen: 0.15,
    sheenRoughness: 0.75,
    sheenColor: new Color(0xffd7c2),
    specularIntensity: 0.3,
  });
}
