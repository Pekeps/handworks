/**
 * Bakes an anatomically-placed crease map for a hand mesh.
 *
 * The GLB gives every vertex both a 3D rest position and a UV, so crease
 * locations can be computed in 3D — flexion bands at each finger joint
 * (from the skeleton's rest positions), palm lines from bony landmarks, a
 * wrist crease — and rasterized into UV space. The result modulates the
 * procedural skin material: darker albedo, grooved bump, higher roughness.
 * Runs once per hand at load time (~1400 verts, a few ms).
 */
import type { BufferAttribute, BufferGeometry } from 'three';
import {
  fingerJoints,
  restPose,
  type FingerName,
  type Side,
  type Vec3,
} from '../core/index.js';

export interface CreaseMap {
  /** crease intensity per texel, row-major, v = row/size (glTF convention) */
  data: Float32Array;
  /** palm-side mask per texel: 1 = palmar skin, 0 = back of the hand */
  palm: Float32Array;
  /** dorsal vein network intensity */
  vein: Float32Array;
  /** blood-flush zones: knuckles, fingertip pads (reddens the albedo) */
  flush: Float32Array;
  /** fingernail plate mask */
  nail: Float32Array;
  /** axial coordinate inside the nail, 0 = root → 1 = free edge */
  nailT: Float32Array;
  size: number;
}

interface Band {
  center: Vec3;
  axis: Vec3; // bone direction through the joint
  width: number; // along-axis gaussian width (m)
  reach: number; // radial cutoff (m)
  /** +1 palmar side, −1 dorsal side */
  facing: 1 | -1;
  strength: number;
}

interface Curve {
  points: Vec3[]; // sampled polyline
  width: number;
  strength: number;
}

interface Spot {
  center: Vec3;
  radius: number;
  strength: number;
  /** +1 palmar side, −1 dorsal side */
  facing: 1 | -1;
}

interface Nail {
  base: Vec3; // distal joint (nail root sits partway along this phalanx)
  axis: Vec3; // distal → tip direction
  up: Vec3; // direction the nail plate faces
  side: Vec3; // side-to-side direction across the plate
  len: number; // distal → tip distance
  halfWidth: number;
  /** where the flesh actually ends, in distal→tip units — the vendored
   *  meshes extend almost a full phalanx past the `tip` JOINT */
  fleshEnd: number;
  /** plate length back from the flesh apex, distal→tip units */
  rootBack: number;
  /** where the free edge stops, in plate-t units (≤ ~1) */
  endT: number;
}

interface Vein {
  points: Vec3[];
  /** per-sample strength (veins swell mid-back, fade at wrist/knuckles) */
  strengths: number[];
  width: number;
}

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const norm = (a: Vec3): Vec3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** quadratic bezier sampled into a polyline */
function bezier(a: Vec3, c: Vec3, b: Vec3, samples: number): Vec3[] {
  const pts: Vec3[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    pts.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
      u * u * a[2] + 2 * u * t * c[2] + t * t * b[2],
    ]);
  }
  return pts;
}

interface Field {
  bands: Band[];
  curves: Curve[];
  spots: Spot[];
  nails: Nail[];
  veins: Vein[];
  palmDir: Vec3;
}

function buildField(side: Side): Field {
  const rest = restPose(side);
  const pos = (j: string): Vec3 => rest[j as keyof typeof rest].t;
  const palmDir: Vec3 = [side === 'left' ? 1 : -1, 0, 0];

  const bands: Band[] = [];
  for (const finger of ['index', 'middle', 'ring', 'pinky'] as FingerName[]) {
    const [, mcp, pip, dip] = fingerJoints(finger);
    // (joint, palmar strength, dorsal strength)
    const spec: [string, number, number][] = [
      [mcp!, 0.55, 0.2],
      [pip!, 0.75, 0.4],
      [dip!, 0.55, 0.25],
    ];
    const chain = fingerJoints(finger);
    for (const [joint, palmar, dorsal] of spec) {
      const i = chain.indexOf(joint as (typeof chain)[number]);
      const axis = norm(sub(pos(chain[i + 1]!), pos(chain[i - 1]!)));
      const center = pos(joint);
      bands.push({ center, axis, width: 0.0024, reach: 0.013, facing: 1, strength: palmar });
      bands.push({ center, axis, width: 0.0045, reach: 0.013, facing: -1, strength: dorsal });
    }
  }
  {
    const [, mp, ip] = fingerJoints('thumb');
    const chain = fingerJoints('thumb');
    for (const [joint, palmar, dorsal] of [
      [mp!, 0.65, 0.3],
      [ip!, 0.5, 0.25],
    ] as [string, number, number][]) {
      const i = chain.indexOf(joint as (typeof chain)[number]);
      const axis = norm(sub(pos(chain[i + 1]!), pos(chain[i - 1]!)));
      bands.push({ center: pos(joint), axis, width: 0.0035, reach: 0.015, facing: 1, strength: palmar });
      bands.push({ center: pos(joint), axis, width: 0.005, reach: 0.015, facing: -1, strength: dorsal });
    }
  }

  // palm lines from bony landmarks (toward-wrist = +y, radial/thumb = −z)
  const W = pos('wrist');
  const I = pos('index-finger-phalanx-proximal');
  const R = pos('ring-finger-phalanx-proximal');
  const P = pos('pinky-finger-phalanx-proximal');
  const TC = pos('thumb-metacarpal');

  const curves: Curve[] = [
    // heart line: below the MCP row, pinky → index
    {
      points: bezier(
        add(P, [0, 0.014, 0]),
        add(R, [0, 0.022, -0.01]),
        add(I, [0, 0.017, 0.004]),
        64,
      ),
      width: 0.002,
      strength: 0.36,
    },
    // head line: from the thumb-index web across the mid palm
    {
      points: bezier(
        add(I, [0, 0.022, -0.008]),
        add(R, [0, 0.034, -0.004]),
        add(P, [0, 0.038, 0.006]),
        64,
      ),
      width: 0.002,
      strength: 0.32,
    },
    // life line: arc around the thenar eminence toward the wrist
    {
      points: bezier(
        add(I, [0, 0.02, -0.011]),
        add(TC, [0, 0.022, 0.014]),
        add(W, [0, -0.006, -0.008]),
        64,
      ),
      width: 0.0022,
      strength: 0.36,
    },
    // wrist crease
    {
      points: bezier(
        add(W, [0, -0.004, -0.024]),
        add(W, [0, -0.001, 0.002]),
        add(W, [0, -0.004, 0.03]),
        48,
      ),
      width: 0.002,
      strength: 0.35,
    },
  ];

  // blood-flush zones: dorsal knuckle skin and palmar fingertip pads carry
  // visibly more blood than the surrounding skin
  const spots: Spot[] = [];
  for (const finger of ['index', 'middle', 'ring', 'pinky'] as FingerName[]) {
    const [, mcp, pip, dip, tip] = fingerJoints(finger);
    spots.push({ center: pos(mcp!), radius: 0.008, strength: 0.5, facing: -1 });
    spots.push({ center: pos(pip!), radius: 0.006, strength: 0.55, facing: -1 });
    spots.push({ center: pos(dip!), radius: 0.005, strength: 0.45, facing: -1 });
    spots.push({ center: pos(tip!), radius: 0.006, strength: 0.45, facing: 1 });
  }
  {
    const [, mp, ip, ttip] = fingerJoints('thumb');
    spots.push({ center: pos(mp!), radius: 0.008, strength: 0.45, facing: -1 });
    spots.push({ center: pos(ip!), radius: 0.006, strength: 0.5, facing: -1 });
    spots.push({ center: pos(ttip!), radius: 0.007, strength: 0.45, facing: 1 });
  }

  // fingernails: an elliptical plate on the dorsal half of each distal
  // phalanx, from mid-phalanx to just past the tip
  const NAIL_WIDTH: Record<FingerName, number> = {
    thumb: 0.0066,
    index: 0.0052,
    middle: 0.0054,
    ring: 0.005,
    pinky: 0.0042,
  };
  // measured from the meshes: how far the fingertip flesh reaches past the
  // tip joint, in distal→tip units
  const FLESH_END: Record<FingerName, number> = {
    thumb: 1.65,
    index: 1.95,
    middle: 2.0,
    ring: 1.95,
    pinky: 1.8,
  };
  const nails: Nail[] = [];
  for (const finger of ['thumb', 'index', 'middle', 'ring', 'pinky'] as FingerName[]) {
    const chain = fingerJoints(finger);
    const base = pos(chain[chain.length - 2]!);
    const tip = pos(chain[chain.length - 1]!);
    const d = sub(tip, base);
    const axis = norm(d);
    // finger nails face the back of the hand; the thumb rests half-pronated
    // in these rigs — its nail-plane direction was measured from the mesh
    // (average normal of the flat plate region on the distal phalanx)
    const up =
      finger === 'thumb'
        ? norm([-palmDir[0] * 0.146, 0.668, -0.729])
        : ([-palmDir[0], -palmDir[1], -palmDir[2]] as Vec3);
    nails.push({
      base,
      axis,
      up,
      side: norm(cross(axis, up)),
      len: Math.hypot(...d),
      halfWidth: NAIL_WIDTH[finger],
      fleshEnd: FLESH_END[finger],
      // the thumb tip faces the viewer far more often — a shorter plate
      // ending just shy of the apex keeps its edge ring off the tip
      rootBack: finger === 'thumb' ? 0.75 : 0.92,
      endT: finger === 'thumb' ? 0.97 : 1.06,
    });
  }

  // dorsal vein network: veins fan out from the wrist toward the gaps
  // between the knuckles, swelling mid-back and fading at both ends
  const M = pos('middle-finger-phalanx-proximal');
  const mid = (a: Vec3, b: Vec3): Vec3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
  const veins: Vein[] = [];
  const targets: [Vec3, number][] = [
    [add(mid(I, M), [0, -0.008, 0]), -0.004],
    [add(mid(M, R), [0, -0.008, 0]), 0.003],
    [add(mid(R, P), [0, -0.009, 0]), 0.006],
    [add(P, [0, -0.012, 0.004]), 0.009],
  ];
  for (const [target, wobble] of targets) {
    const start = add(W, [0, 0.004, wobble * 0.5]);
    const ctrl = add(mid(start, target), [0, 0, wobble]);
    const points = bezier(start, ctrl, target, 48);
    const strengths = points.map((_, i) => {
      const t = i / (points.length - 1);
      return 0.55 * Math.sin(Math.PI * (0.12 + 0.88 * t)) ** 0.8 * (1 - 0.55 * t ** 6);
    });
    veins.push({ points, strengths, width: 0.0017 });
  }
  {
    // the dorsal venous arch linking the fan just below the knuckle row
    const points = bezier(
      add(I, [0, -0.007, 0.002]),
      add(mid(M, R), [0, -0.011, 0]),
      add(P, [0, -0.009, -0.002]),
      48,
    );
    const strengths = points.map((_, i) => {
      const t = i / (points.length - 1);
      return 0.35 * Math.sin(Math.PI * t) ** 0.6;
    });
    veins.push({ points, strengths, width: 0.0014 });
  }

  // real palm lines waver — perfectly smooth bezier arcs read as painted.
  // Deterministic multi-sine wobble, different per line.
  for (let ci = 0; ci < curves.length; ci++) {
    const c = curves[ci]!;
    c.points = c.points.map((q, i) => {
      const t = i / (c.points.length - 1);
      const w =
        Math.sin(t * 19 + ci * 5.1) * 0.5 +
        Math.sin(t * 47 + ci * 9.7) * 0.32 +
        Math.sin(t * 83 + ci * 3.3) * 0.18;
      return add(q, [0, w * 0.001, Math.cos(t * 31 + ci * 7.9) * 0.0005]);
    });
  }

  return { bands, curves, spots, nails, veins, palmDir };
}

/** crease intensity at a surface point (position + normal, armature space) */
function evalField(p: Vec3, n: Vec3, field: Field): number {
  let v = 0;
  const sdot = dot(n, field.palmDir);
  for (const b of field.bands) {
    // thresholded so a band never catches tilted normals on the wrong side
    // of the hand. Dorsal bands need a FIRM threshold: the palm-side web
    // saddles tilt up to ~0.25 dorsal and used to catch the stripe pattern
    // as scratchy hatch marks (knuckle backs sit at 0.7+, so they keep it)
    const mask = Math.min(
      1,
      Math.max(0, (sdot * b.facing - (b.facing === -1 ? 0.3 : 0.12)) * 2.8),
    );
    if (mask <= 0) continue;
    const d = sub(p, b.center);
    const t = dot(d, b.axis);
    const along = Math.exp(-((t / b.width) ** 2));
    if (along < 0.02) continue;
    const rx = d[0] - t * b.axis[0];
    const ry = d[1] - t * b.axis[1];
    const rz = d[2] - t * b.axis[2];
    const r = Math.hypot(rx, ry, rz);
    const reach = Math.exp(-((r / b.reach) ** 4));
    // dorsal knuckle skin creases as several fine parallel wrinkles, not
    // one wide band — split the band with a stripe pattern along the bone
    const stripes = b.facing === -1 ? 0.55 + 0.45 * Math.cos((t * 2 * Math.PI) / 0.0021) : 1;
    v = Math.max(v, b.strength * along * reach * mask * stripes);
  }
  const palmMask = Math.min(1, Math.max(0, sdot * 2.5));
  if (palmMask > 0) {
    for (const c of field.curves) {
      // distance in the palm plane (y-z); x is depth through the hand
      let min = Infinity;
      let at = 0;
      for (let i = 0; i < c.points.length; i++) {
        const q = c.points[i]!;
        const dy = p[1] - q[1];
        const dz = p[2] - q[2];
        const d = dy * dy + dz * dz;
        if (d < min) {
          min = d;
          at = i;
        }
      }
      // real palm lines fade in and out — hard edge-to-edge strokes read
      // as painted-on
      const taper = Math.sin(Math.PI * (at / (c.points.length - 1))) ** 0.6;
      // sharp crease core inside a much fainter soft valley — a single
      // uniform gaussian reads as an airbrushed stroke
      const core = Math.exp(-(min / (c.width * 0.42) ** 2));
      const halo = Math.exp(-(min / (c.width * 1.5) ** 2));
      v = Math.max(v, c.strength * taper * (0.75 * core + 0.3 * halo) * palmMask);
    }
  }
  return Math.min(1, v);
}

/** vein / flush / nail values at a surface point */
function evalExtras(
  p: Vec3,
  n: Vec3,
  field: Field,
): { vein: number; flush: number; nail: number; nailT: number } {
  const sdot = dot(n, field.palmDir);
  // a firm threshold — grazing normals on the OTHER side of the hand can
  // otherwise catch these fields (the vein arch used to scribble the palm,
  // since curve distance is measured in the y-z plane only)
  const dorsal = Math.min(1, Math.max(0, (-sdot - 0.32) * 2.8));
  const out = { vein: 0, flush: 0, nail: 0, nailT: 0 };

  if (dorsal > 0) {
    for (const vn of field.veins) {
      // distance in the back-of-hand plane (y-z), like the palm curves
      let min = Infinity;
      let at = 0;
      for (let i = 0; i < vn.points.length; i++) {
        const q = vn.points[i]!;
        const dy = p[1] - q[1];
        const dz = p[2] - q[2];
        const d = dy * dy + dz * dz;
        if (d < min) {
          min = d;
          at = i;
        }
      }
      const g = Math.exp(-(min / (vn.width * vn.width)));
      out.vein = Math.max(out.vein, vn.strengths[at]! * g * dorsal);
    }
  }

  for (const s of field.spots) {
    const mask = Math.min(1, Math.max(0, (sdot * s.facing - 0.18) * 2.5));
    if (mask <= 0) continue;
    const d = sub(p, s.center);
    const r = Math.hypot(d[0], d[1], d[2]);
    const g = Math.exp(-((r / s.radius) ** 2));
    out.flush = Math.min(1, out.flush + s.strength * g * mask);
  }

  for (const nl of field.nails) {
    const d = sub(p, nl.base);
    const u = dot(d, nl.axis) / nl.len;
    // the plate spans the outer part of the visible fingertip: root a bit
    // below the flesh apex, free edge just short of it
    const root = nl.fleshEnd - nl.rootBack;
    if (u < root - 0.2 || u > nl.fleshEnd + 0.15) continue;
    // the plate covers surface facing the nail's up direction, and follows
    // it over the rounded tip cap (tipward normals) so the free edge
    // actually reaches the fingertip — but never onto the pad side
    const facing = dot(n, nl.up);
    const tipward = Math.max(0, dot(n, nl.axis));
    // tipward normals only count while the surface still faces the nail
    // plane — otherwise the plate wraps around the tip cap onto the pad
    // and its rim draws loops across the fingertip
    const ff = Math.min(1, Math.max(0, (facing - 0.15) / 0.25));
    const gate = Math.min(1, Math.max(0, ((facing - 0.06) * 1.6 + tipward * 0.9 * ff) * 1.8));
    if (gate <= 0) continue;
    // side-to-side coordinate across the plate — NOT radial distance from
    // the bone (every surface texel is a full finger-radius from the bone)
    const lat = Math.abs(dot(d, nl.side));
    const t = (u - root) / (nl.rootBack - 0.04);
    // superellipse plate hugging the tip: straight sides, rounded root/edge
    const e = Math.abs(2 * t - 1) ** 4 + (lat / nl.halfWidth) ** 4;
    // hard free-edge cutoff just before the flesh apex
    const mask =
      Math.min(1, Math.max(0, (1.0 - e) * 4)) *
      gate *
      Math.min(1, Math.max(0, (nl.endT - t) * 6));
    if (mask > out.nail) {
      out.nail = mask;
      out.nailT = Math.min(1, Math.max(0, t));
    }
  }
  return out;
}

/**
 * Rasterize the crease field into UV space for this mesh.
 * Rows follow the glTF UV convention (v = row/size) — use with
 * `texture.flipY = false`.
 */
export function bakeCreaseMap(geometry: BufferGeometry, side: Side, size = 1024): CreaseMap {
  const posAttr = geometry.attributes.position as BufferAttribute;
  const norAttr = geometry.attributes.normal as BufferAttribute;
  const uvAttr = geometry.attributes.uv as BufferAttribute;
  const index = geometry.index;
  const out = new Float32Array(size * size);
  const palm = new Float32Array(size * size);
  const vein = new Float32Array(size * size);
  const flush = new Float32Array(size * size);
  const nail = new Float32Array(size * size);
  const nailT = new Float32Array(size * size);
  const empty = { data: out, palm, vein, flush, nail, nailT, size };
  if (!posAttr || !uvAttr || !index) return empty;
  // per-texel ownership: the triangle covering a texel most interiorly wins
  // outright. The edge tolerance is barycentric, so a big triangle writes
  // several texels past its island edge — with max-combining, a dorsal
  // knuckle band could overwrite palm texels across the atlas gutter
  // (scratchy hatch marks on the palm webs)
  const bestW = new Float32Array(size * size).fill(-Infinity);

  const field = buildField(side);
  const triCount = index.count / 3;
  const P: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const N: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const U = [0, 0, 0];
  const V = [0, 0, 0];

  for (let tri = 0; tri < triCount; tri++) {
    for (let k = 0; k < 3; k++) {
      const vi = index.getX(tri * 3 + k);
      P[k]! [0] = posAttr.getX(vi);
      P[k]! [1] = posAttr.getY(vi);
      P[k]! [2] = posAttr.getZ(vi);
      N[k]! [0] = norAttr.getX(vi);
      N[k]! [1] = norAttr.getY(vi);
      N[k]! [2] = norAttr.getZ(vi);
      U[k] = uvAttr.getX(vi) * size;
      V[k] = uvAttr.getY(vi) * size;
    }
    const minX = Math.max(0, Math.floor(Math.min(U[0]!, U[1]!, U[2]!) - 1));
    const maxX = Math.min(size - 1, Math.ceil(Math.max(U[0]!, U[1]!, U[2]!) + 1));
    const minY = Math.max(0, Math.floor(Math.min(V[0]!, V[1]!, V[2]!) - 1));
    const maxY = Math.min(size - 1, Math.ceil(Math.max(V[0]!, V[1]!, V[2]!) + 1));
    const denom =
      (V[1]! - V[2]!) * (U[0]! - U[2]!) + (U[2]! - U[1]!) * (V[0]! - V[2]!);
    if (Math.abs(denom) < 1e-9) continue;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        let w0 = ((V[1]! - V[2]!) * (px - U[2]!) + (U[2]! - U[1]!) * (py - V[2]!)) / denom;
        let w1 = ((V[2]! - V[0]!) * (px - U[2]!) + (U[0]! - U[2]!) * (py - V[2]!)) / denom;
        let w2 = 1 - w0 - w1;
        // small tolerance so island edges get covered (bilinear-safe)
        const eps = -0.08;
        if (w0 < eps || w1 < eps || w2 < eps) continue;
        const i = y * size + x;
        const wmin = Math.min(w0, w1, w2);
        if (wmin <= bestW[i]!) continue;
        bestW[i] = wmin;
        w0 = Math.max(0, w0);
        w1 = Math.max(0, w1);
        w2 = Math.max(0, w2);
        const ws = w0 + w1 + w2 || 1;
        const p: Vec3 = [
          (w0 * P[0]![0] + w1 * P[1]![0] + w2 * P[2]![0]) / ws,
          (w0 * P[0]![1] + w1 * P[1]![1] + w2 * P[2]![1]) / ws,
          (w0 * P[0]![2] + w1 * P[1]![2] + w2 * P[2]![2]) / ws,
        ];
        const n: Vec3 = [
          w0 * N[0]![0] + w1 * N[1]![0] + w2 * N[2]![0],
          w0 * N[0]![1] + w1 * N[1]![1] + w2 * N[2]![1],
          w0 * N[0]![2] + w1 * N[1]![2] + w2 * N[2]![2],
        ];
        const nn = norm(n);
        out[i] = evalField(p, nn, field);
        // palm-side mask: WIDE transition around the hand's silhouette — a
        // sharp cutoff parks full dorsal texture on the front-facing web
        // saddles, which reads as dark scratches against the light palm
        const sdot = dot(nn, field.palmDir);
        palm[i] = Math.min(1, Math.max(0, (sdot + 0.35) / 0.85));
        const ex = evalExtras(p, nn, field);
        vein[i] = ex.vein;
        flush[i] = ex.flush;
        nail[i] = ex.nail;
        nailT[i] = ex.nailT;
      }
    }
  }
  // Edge padding: texels no triangle wrote (the gutters between UV islands)
  // otherwise keep default values, and bilinear/mip sampling drags those
  // across island edges — hairline scratch artifacts along every seam.
  // Dilate written texels outward a few steps instead.
  // (Never box-blur these maps — that hops islands in the other direction.)
  const written = new Uint8Array(size * size);
  for (let i = 0; i < size * size; i++) written[i] = bestW[i]! > -Infinity ? 1 : 0;
  const channels = [out, palm, vein, flush, nail, nailT];
  for (let pass = 0; pass < 6; pass++) {
    const grown: number[] = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = y * size + x;
        if (written[i]) continue;
        let n = 0;
        const sums = [0, 0, 0, 0, 0, 0];
        for (const [ox, oy] of [
          [-1, 0],
          [1, 0],
          [0, -1],
          [0, 1],
        ] as const) {
          const xx = x + ox;
          const yy = y + oy;
          if (xx < 0 || xx >= size || yy < 0 || yy >= size) continue;
          const j = yy * size + xx;
          if (!written[j]) continue;
          n++;
          for (let c = 0; c < channels.length; c++) sums[c]! += channels[c]![j]!;
        }
        if (n === 0) continue;
        for (let c = 0; c < channels.length; c++) channels[c]![i] = sums[c]! / n;
        grown.push(i);
      }
    }
    if (grown.length === 0) break;
    for (const i of grown) written[i] = 1;
  }
  return { data: out, palm, vein, flush, nail, nailT, size };
}
