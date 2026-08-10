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

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
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

function buildField(side: Side): { bands: Band[]; curves: Curve[]; palmDir: Vec3 } {
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
      width: 0.0024,
      strength: 0.5,
    },
    // head line: from the thumb-index web across the mid palm
    {
      points: bezier(
        add(I, [0, 0.022, -0.008]),
        add(R, [0, 0.034, -0.004]),
        add(P, [0, 0.038, 0.006]),
        64,
      ),
      width: 0.0024,
      strength: 0.45,
    },
    // life line: arc around the thenar eminence toward the wrist
    {
      points: bezier(
        add(I, [0, 0.02, -0.011]),
        add(TC, [0, 0.022, 0.014]),
        add(W, [0, -0.006, -0.008]),
        64,
      ),
      width: 0.0026,
      strength: 0.5,
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

  return { bands, curves, palmDir };
}

/** crease intensity at a surface point (position + normal, armature space) */
function evalField(
  p: Vec3,
  n: Vec3,
  field: ReturnType<typeof buildField>,
): number {
  let v = 0;
  const sdot = dot(n, field.palmDir);
  for (const b of field.bands) {
    const mask = Math.min(1, Math.max(0, sdot * b.facing * 2.5));
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
    v = Math.max(v, b.strength * along * reach * mask);
  }
  const palmMask = Math.min(1, Math.max(0, sdot * 2.5));
  if (palmMask > 0) {
    for (const c of field.curves) {
      // distance in the palm plane (y-z); x is depth through the hand
      let min = Infinity;
      for (const q of c.points) {
        const dy = p[1] - q[1];
        const dz = p[2] - q[2];
        const d = dy * dy + dz * dz;
        if (d < min) min = d;
      }
      const g = Math.exp(-(min / (c.width * c.width)));
      v = Math.max(v, c.strength * g * palmMask);
    }
  }
  return Math.min(1, v);
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
  if (!posAttr || !uvAttr || !index) return { data: out, palm, size };

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
        const v = evalField(p, nn, field);
        const i = y * size + x;
        if (v > out[i]!) out[i] = v;
        // palm-side mask: smooth transition around the hand's silhouette
        const sdot = dot(nn, field.palmDir);
        const pm = Math.min(1, Math.max(0, (sdot + 0.15) / 0.55));
        if (pm > palm[i]!) palm[i] = pm;
      }
    }
  }
  return { data: out, palm, size };
}
