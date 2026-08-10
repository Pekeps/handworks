/**
 * Finger-collision detection and resolution.
 *
 * Each phalanx is approximated by a capsule between consecutive joints.
 * After the pose solves through FK, interpenetrating capsules are resolved
 * by small parameter-space corrections — abduction (spread) pushes fingers
 * apart, and the thumb lifts away from the palm so it travels OVER curled
 * fingers instead of through them (as a real thumb does). Corrections are
 * found by numeric probing, so they hold for any rig orientation, and the
 * whole pass is deterministic.
 */
import type { Quat, Vec3 } from './math.js';
import type { FingerName, JointName, Side } from './skeleton.js';
import { fingerJoints, FINGER_NAMES } from './skeleton.js';
import type { JointTransforms } from './solver.js';

/** Capsule radii per finger, base→tip segment (metres, generic-hand scale). */
const RADII: Record<FingerName, number[]> = {
  thumb: [0.0095, 0.0085],
  index: [0.008, 0.0072, 0.0066],
  middle: [0.008, 0.0072, 0.0066],
  ring: [0.0075, 0.0068, 0.0062],
  pinky: [0.0066, 0.006, 0.0055],
};

/** Ignore penetrations shallower than this (fingers may touch). */
const TOLERANCE = 0.0015;

/** Finger pairs that can realistically collide. */
const PAIRS: [FingerName, FingerName][] = [
  ['thumb', 'index'],
  ['thumb', 'middle'],
  ['thumb', 'ring'],
  ['thumb', 'pinky'],
  ['index', 'middle'],
  ['middle', 'ring'],
  ['ring', 'pinky'],
];

interface Segment {
  a: Vec3;
  b: Vec3;
  r: number;
}

/** Capsule segments of one finger (skips the in-palm metacarpal). */
function segmentsOf(finger: FingerName, t: JointTransforms): Segment[] {
  const joints = fingerJoints(finger);
  const radii = RADII[finger];
  const segs: Segment[] = [];
  // fingers: proximal→intermediate→distal→tip; thumb: proximal→distal→tip
  for (let i = 1; i < joints.length - 1; i++) {
    segs.push({
      a: t[joints[i]!].position,
      b: t[joints[i + 1]!].position,
      r: radii[i - 1] ?? radii[radii.length - 1]!,
    });
  }
  return segs;
}

/** Squared distance between two segments (Ericson, Real-Time Collision Detection). */
function segSegDistance(p1: Vec3, q1: Vec3, p2: Vec3, q2: Vec3): number {
  const d1 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const a = d1[0]! * d1[0]! + d1[1]! * d1[1]! + d1[2]! * d1[2]!;
  const e = d2[0]! * d2[0]! + d2[1]! * d2[1]! + d2[2]! * d2[2]!;
  const f = d2[0]! * r[0]! + d2[1]! * r[1]! + d2[2]! * r[2]!;
  let s: number;
  let t: number;
  const EPS = 1e-12;
  if (a <= EPS && e <= EPS) {
    s = t = 0;
  } else if (a <= EPS) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = d1[0]! * r[0]! + d1[1]! * r[1]! + d1[2]! * r[2]!;
    if (e <= EPS) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = d1[0]! * d2[0]! + d1[1]! * d2[1]! + d1[2]! * d2[2]!;
      const denom = a * e - b * b;
      s = denom > EPS ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1 = [p1[0] + d1[0]! * s, p1[1] + d1[1]! * s, p1[2] + d1[2]! * s];
  const c2 = [p2[0] + d2[0]! * t, p2[1] + d2[1]! * t, p2[2] + d2[2]! * t];
  return Math.hypot(c1[0]! - c2[0]!, c1[1]! - c2[1]!, c1[2]! - c2[2]!);
}

export interface Contact {
  a: FingerName;
  b: FingerName;
  /** metres of interpenetration beyond tolerance */
  depth: number;
}

/** Deepest contact per colliding finger pair. */
export function detectContacts(transforms: JointTransforms): Contact[] {
  const segs = {} as Record<FingerName, Segment[]>;
  for (const f of FINGER_NAMES) segs[f] = segmentsOf(f, transforms);
  const contacts: Contact[] = [];
  for (const [fa, fb] of PAIRS) {
    let depth = 0;
    for (const sa of segs[fa]) {
      for (const sb of segs[fb]) {
        const d = segSegDistance(sa.a, sa.b, sb.a, sb.b);
        depth = Math.max(depth, sa.r + sb.r - TOLERANCE - d);
      }
    }
    if (depth > 0) contacts.push({ a: fa, b: fb, depth });
  }
  return contacts;
}

/** Depth of the (a,b) pair in a contact list, 0 when separated. */
export const pairDepth = (contacts: Contact[], a: FingerName, b: FingerName): number =>
  contacts.find((c) => c.a === a && c.b === b)?.depth ?? 0;

/** Parameter-space corrections applied on top of a solved pose. */
export interface CollisionAdjust {
  /** extra abduction per finger, radians (sign found by probing) */
  spreadAngle: Partial<Record<FingerName, number>>;
  /** extra thumb CMC rotation away from the palm, radians */
  thumbLift: number;
  /** extra thumb CMC rotation along the opposition arc, radians */
  thumbRetract: number;
}

export const emptyAdjust = (): CollisionAdjust => ({
  spreadAngle: {},
  thumbLift: 0,
  thumbRetract: 0,
});

export interface ResolveOptions {
  side: Side;
  maxIterations?: number;
}

const PROBE = 0.02; // radians used to find the helpful correction direction
const GAIN = 1.2; // slight overcorrection so contacts converge
const MAX_STEP = 0.2; // per-iteration correction cap, radians
const MAX_SPREAD_FIX = 0.35; // ~20°
const MAX_LIFT = 0.8; // ~46°

/**
 * Iteratively resolve finger interpenetration. `solve` re-runs the pose
 * solver with the given adjustments (supplied by solver.ts to avoid a
 * circular import). Returns collision-free transforms (best effort).
 */
export function resolveCollisions(
  solve: (adjust: CollisionAdjust) => JointTransforms,
  options: ResolveOptions,
): JointTransforms {
  const adjust = emptyAdjust();
  let transforms = solve(adjust);
  const maxIter = options.maxIterations ?? 6;

  for (let iter = 0; iter < maxIter; iter++) {
    const contacts = detectContacts(transforms);
    if (contacts.length === 0) break;

    for (const contact of contacts) {
      const lever = 0.05; // ≈ MCP→contact distance; converts depth to angle
      const angle = Math.min((contact.depth / lever) * GAIN, MAX_STEP);
      if (contact.a === 'thumb') {
        // two escape routes: lift off the palm, or retract along the
        // opposition arc — probe both and take the more effective one
        const best = probeBest(solve, adjust, contact, [
          (adj, s) => {
            adj.thumbLift += s * PROBE;
          },
          (adj, s) => {
            adj.thumbRetract += s * PROBE;
          },
        ]);
        if (best.dof === 0) {
          adjust.thumbLift = clampAbs(adjust.thumbLift + best.dir * angle, MAX_LIFT);
        } else {
          adjust.thumbRetract = clampAbs(adjust.thumbRetract + best.dir * angle, MAX_LIFT);
        }
      } else {
        // push the two fingers apart with opposite abduction corrections
        const dir = probeSign(solve, adjust, contact, (adj, s) => {
          adj.spreadAngle[contact.a] = (adj.spreadAngle[contact.a] ?? 0) + s * PROBE;
          adj.spreadAngle[contact.b] = (adj.spreadAngle[contact.b] ?? 0) - s * PROBE;
        });
        adjust.spreadAngle[contact.a] = clampAbs(
          (adjust.spreadAngle[contact.a] ?? 0) + dir * angle * 0.5,
          MAX_SPREAD_FIX,
        );
        adjust.spreadAngle[contact.b] = clampAbs(
          (adjust.spreadAngle[contact.b] ?? 0) - dir * angle * 0.5,
          MAX_SPREAD_FIX,
        );
      }
    }
    transforms = solve(adjust);
  }
  return transforms;
}

const clampAbs = (v: number, max: number): number => Math.max(-max, Math.min(max, v));

const cloneAdjust = (a: CollisionAdjust): CollisionAdjust => ({
  spreadAngle: { ...a.spreadAngle },
  thumbLift: a.thumbLift,
  thumbRetract: a.thumbRetract,
});

/** Try a small ± perturbation of a correction and keep the sign that helps. */
function probeSign(
  solve: (adjust: CollisionAdjust) => JointTransforms,
  adjust: CollisionAdjust,
  contact: Contact,
  perturb: (adj: CollisionAdjust, sign: number) => void,
): number {
  const depths: number[] = [];
  for (const sign of [1, -1]) {
    const trial = cloneAdjust(adjust);
    perturb(trial, sign);
    depths.push(pairDepth(detectContacts(solve(trial)), contact.a, contact.b));
  }
  return depths[0]! <= depths[1]! ? 1 : -1;
}

/** Probe several DOFs in both directions; return the most effective one. */
function probeBest(
  solve: (adjust: CollisionAdjust) => JointTransforms,
  adjust: CollisionAdjust,
  contact: Contact,
  perturbs: ((adj: CollisionAdjust, sign: number) => void)[],
): { dof: number; dir: number } {
  let best = { dof: 0, dir: 1, depth: Infinity };
  for (let dof = 0; dof < perturbs.length; dof++) {
    for (const dir of [1, -1]) {
      const trial = cloneAdjust(adjust);
      perturbs[dof]!(trial, dir);
      const depth = pairDepth(detectContacts(solve(trial)), contact.a, contact.b);
      if (depth < best.depth) best = { dof, dir, depth };
    }
  }
  return best;
}

export type { JointTransforms };
