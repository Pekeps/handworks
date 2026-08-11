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

/**
 * Capsule radii per finger, base→tip segment (metres). Median shaft radii
 * measured from the vendored mesh (scripts in repo history) — thinner values
 * let the mesh visibly clip before a contact is ever detected.
 */
const RADII: Record<FingerName, number[]> = {
  thumb: [0.01, 0.009],
  index: [0.009, 0.008, 0.0072],
  middle: [0.0092, 0.008, 0.0076],
  ring: [0.0086, 0.0074, 0.007],
  pinky: [0.0075, 0.0068, 0.0062],
};

/**
 * The meshes' fingertip flesh reaches well past the `tip` JOINT (almost a
 * full distal-phalanx length, measured per digit) — the last capsule is
 * extended by this fraction of its length so the actual fingertip collides,
 * not just the bone.
 */
const TIP_EXTEND: Record<FingerName, number> = {
  thumb: 0.07,
  index: 0.34,
  middle: 0.41,
  ring: 0.38,
  pinky: 0.28,
};

/** Ignore penetrations shallower than this (fingers may touch). */
const TOLERANCE = 0.001;

/**
 * Extra allowance for thumb-against-finger contact: a thumb resting on a
 * fist presses INTO the soft tissue, so it may sink this much deeper than
 * rigid capsules would allow before counting as penetration. Without it the
 * thumb hovers off the knuckles it should rest on.
 */
const THUMB_SQUISH = 0.0028;

/** A colliding body: a digit, or the palm itself. */
export type CollisionBody = FingerName | 'palm';

/** Body pairs that can realistically collide. */
const PAIRS: [CollisionBody, CollisionBody][] = [
  ['thumb', 'index'],
  ['thumb', 'middle'],
  ['thumb', 'ring'],
  ['thumb', 'pinky'],
  ['index', 'middle'],
  ['middle', 'ring'],
  ['ring', 'pinky'],
  ['palm', 'thumb'],
  ['palm', 'index'],
  ['palm', 'middle'],
  ['palm', 'ring'],
  ['palm', 'pinky'],
];

/**
 * Palm slab, measured from the mesh: palmar flesh reaches ~23 mm from the
 * metacarpal bones near the heel but only ~15–18 mm near the knuckles
 * (dorsal ~13 mm everywhere), so each wrist→knuckle fan line is split into
 * a thick heel capsule and a thinner distal one, both offset palmar-side.
 */
const PALM_HEEL_RADIUS = 0.017;
const PALM_HEEL_OFFSET = 0.006;
const PALM_RADIUS = 0.015;
const PALM_OFFSET = 0.005;

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
    const a = t[joints[i]!].position;
    let b = t[joints[i + 1]!].position;
    if (i === joints.length - 2) {
      const e = TIP_EXTEND[finger];
      b = [b[0] + (b[0] - a[0]) * e, b[1] + (b[1] - a[1]) * e, b[2] + (b[2] - a[2]) * e];
    }
    segs.push({ a, b, r: radii[i - 1] ?? radii[radii.length - 1]! });
  }
  return segs;
}

/** The palm as a fan of capsules from the wrist to each finger knuckle,
 *  offset toward the palmar side where the flesh actually is. */
function palmSegments(t: JointTransforms): Segment[] {
  const wrist = t.wrist.position;
  const knuckle = (f: FingerName): Vec3 => t[fingerJoints(f)[1]!].position;
  // palmar normal from the knuckle fan itself — follows wrist rotation and
  // has the correct sign on both hands (mirroring flips the cross product)
  const vi = sub3(knuckle('index'), wrist);
  const vp = sub3(knuckle('pinky'), wrist);
  const n = norm3([
    -(vi[1] * vp[2] - vi[2] * vp[1]),
    -(vi[2] * vp[0] - vi[0] * vp[2]),
    -(vi[0] * vp[1] - vi[1] * vp[0]),
  ]);
  const segs: Segment[] = [];
  for (const f of ['index', 'middle', 'ring', 'pinky'] as FingerName[]) {
    const b = knuckle(f);
    const at = (t: number, offset: number): Vec3 => [
      wrist[0] + (b[0] - wrist[0]) * t + n[0] * offset,
      wrist[1] + (b[1] - wrist[1]) * t + n[1] * offset,
      wrist[2] + (b[2] - wrist[2]) * t + n[2] * offset,
    ];
    // thick heel half (thenar/hypothenar mounds), thinner knuckle half
    segs.push({ a: at(0, PALM_HEEL_OFFSET), b: at(0.55, PALM_HEEL_OFFSET), r: PALM_HEEL_RADIUS });
    segs.push({ a: at(0.5, PALM_OFFSET), b: at(1, PALM_OFFSET), r: PALM_RADIUS });
  }
  return segs;
}

const sub3 = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const norm3 = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

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
  a: CollisionBody;
  b: FingerName;
  /** metres of interpenetration beyond tolerance */
  depth: number;
}

/** Deepest contact per colliding body pair. */
export function detectContacts(transforms: JointTransforms): Contact[] {
  const segs = {} as Record<CollisionBody, Segment[]>;
  for (const f of FINGER_NAMES) segs[f] = segmentsOf(f, transforms);
  segs.palm = palmSegments(transforms);
  const contacts: Contact[] = [];
  for (const [fa, fb] of PAIRS) {
    // against the palm only a finger's distal segments count — its proximal
    // phalanx legitimately borders the palm at the knuckle
    const aSegs = segs[fa];
    const bSegs = fa === 'palm' ? segs[fb as FingerName].slice(1) : segs[fb as FingerName];
    const tol = TOLERANCE + (fa === 'thumb' ? THUMB_SQUISH : 0);
    let depth = 0;
    for (const sa of aSegs) {
      for (const sb of bSegs) {
        const d = segSegDistance(sa.a, sa.b, sb.a, sb.b);
        depth = Math.max(depth, sa.r + sb.r - tol - d);
      }
    }
    if (depth > 0) contacts.push({ a: fa, b: fb as FingerName, depth });
  }
  return contacts;
}

/** Depth of the (a,b) pair in a contact list, 0 when separated. */
export const pairDepth = (contacts: Contact[], a: CollisionBody, b: FingerName): number =>
  contacts.find((c) => c.a === a && c.b === b)?.depth ?? 0;

/** Worst penetration anywhere on the hand, 0 when collision-free. */
export const maxDepth = (contacts: Contact[]): number =>
  contacts.reduce((m, c) => Math.max(m, c.depth), 0);

/** Parameter-space corrections applied on top of a solved pose. */
export interface CollisionAdjust {
  /** extra abduction per finger, radians (sign found by probing) */
  spreadAngle: Partial<Record<FingerName, number>>;
  /** extra PIP/DIP flexion per finger, radians (negative backs a curled
   *  finger off the palm so it rests on it instead of clipping through) */
  curlAngle: Partial<Record<FingerName, number>>;
  /** extra MCP flexion per finger, radians — staggering knuckle flexion is
   *  the only way to part the proximal shafts of adjacent flexed fingers
   *  (abduction is nearly parallel to the shaft once the finger is curled) */
  mcpAngle: Partial<Record<FingerName, number>>;
  /** extra thumb CMC rotation away from the palm, radians */
  thumbLift: number;
  /** extra thumb CMC rotation along the opposition arc, radians */
  thumbRetract: number;
  /** extra thumb MP/IP flexion, radians — lets the thumb WRAP a contact
   *  instead of swinging its whole column away at the base */
  thumbCurl: number;
}

export const emptyAdjust = (): CollisionAdjust => ({
  spreadAngle: {},
  curlAngle: {},
  mcpAngle: {},
  thumbLift: 0,
  thumbRetract: 0,
  thumbCurl: 0,
});

export interface ResolveOptions {
  side: Side;
  maxIterations?: number;
  /**
   * Start the descent from a previous frame's corrections. Keeps solutions
   * temporally coherent during animation — without it, consecutive frames
   * can pick different escape routes and the hand visibly pops.
   */
  warmStart?: CollisionAdjust;
}

export interface ResolveResult {
  transforms: JointTransforms;
  /** the corrections that produced `transforms` (feed back as warmStart) */
  adjust: CollisionAdjust;
}

const lerpMap = (
  a: Partial<Record<FingerName, number>>,
  b: Partial<Record<FingerName, number>>,
  t: number,
): Partial<Record<FingerName, number>> => {
  const out: Partial<Record<FingerName, number>> = {};
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)] as FingerName[])) {
    out[k] = (a[k] ?? 0) + ((b[k] ?? 0) - (a[k] ?? 0)) * t;
  }
  return out;
};

/** component-wise lerp of two correction sets (for temporal smoothing) */
export function mixAdjust(a: CollisionAdjust, b: CollisionAdjust, t: number): CollisionAdjust {
  return {
    spreadAngle: lerpMap(a.spreadAngle, b.spreadAngle, t),
    curlAngle: lerpMap(a.curlAngle, b.curlAngle, t),
    mcpAngle: lerpMap(a.mcpAngle, b.mcpAngle, t),
    thumbLift: a.thumbLift + (b.thumbLift - a.thumbLift) * t,
    thumbRetract: a.thumbRetract + (b.thumbRetract - a.thumbRetract) * t,
    thumbCurl: a.thumbCurl + (b.thumbCurl - a.thumbCurl) * t,
  };
}

/** step magnitudes tried per move — small refinements and pocket-escaping jumps */
const MAGNITUDES = [0.015, 0.04, 0.12, 0.3, 0.6];
const MAX_SPREAD_FIX = 0.35; // ~20°
const MAX_LIFT = 0.8; // ~46°

const clampAbs = (v: number, max: number): number => Math.max(-max, Math.min(max, v));

const cloneAdjust = (a: CollisionAdjust): CollisionAdjust => ({
  spreadAngle: { ...a.spreadAngle },
  curlAngle: { ...a.curlAngle },
  mcpAngle: { ...a.mcpAngle },
  thumbLift: a.thumbLift,
  thumbRetract: a.thumbRetract,
  thumbCurl: a.thumbCurl,
});

const bumpSpread = (adj: CollisionAdjust, finger: FingerName, amt: number): void => {
  adj.spreadAngle[finger] = clampAbs((adj.spreadAngle[finger] ?? 0) + amt, MAX_SPREAD_FIX);
};

const bumpCurl = (adj: CollisionAdjust, finger: FingerName, amt: number): void => {
  adj.curlAngle[finger] = clampAbs((adj.curlAngle[finger] ?? 0) + amt, MAX_LIFT);
};

const bumpMcp = (adj: CollisionAdjust, finger: FingerName, amt: number): void => {
  adj.mcpAngle[finger] = clampAbs((adj.mcpAngle[finger] ?? 0) + amt, MAX_SPREAD_FIX);
};

type Move = (adj: CollisionAdjust, amt: number) => void;

/**
 * Iteratively resolve finger interpenetration. `solve` re-runs the pose
 * solver with the given adjustments (supplied by solver.ts to avoid a
 * circular import).
 *
 * Greedy descent on the WORST penetration anywhere on the hand: each
 * iteration tries every relevant correction (thumb lift / retract, finger
 * abduction, pairwise separation) at several magnitudes in both directions
 * and adopts the best strictly-improving one. Scoring globally means a move
 * that frees one pair by shoving a digit into its neighbour never counts as
 * progress, and strict improvement means the loop can never oscillate.
 * Deterministic; returns best-effort transforms.
 */
export function resolveCollisions(
  solve: (adjust: CollisionAdjust) => JointTransforms,
  options: ResolveOptions,
): ResolveResult {
  // (worst depth, total depth) — comparing lexicographically means the
  // descent still makes progress when several contacts tie on the worst
  // depth, or when a move can only fix a shallower secondary contact
  const score = (t: JointTransforms): [number, number] => {
    const contacts = detectContacts(t);
    return [maxDepth(contacts), contacts.reduce((s, c) => s + c.depth, 0)];
  };
  const better = (a: [number, number], b: [number, number]): boolean =>
    a[0] < b[0] - 1e-6 || (a[0] < b[0] + 1e-6 && a[1] < b[1] - 1e-6);

  let adjust = options.warmStart ? cloneAdjust(options.warmStart) : emptyAdjust();
  let transforms = solve(adjust);
  let current = score(transforms);
  const maxIter = options.maxIterations ?? 16;
  let changed = false;

  for (let iter = 0; iter < maxIter && current[0] > 0; iter++) {
    // moves relevant to the contacts present right now
    const moves = new Map<string, Move>();
    for (const c of detectContacts(transforms)) {
      if (c.a === 'thumb' || (c.a === 'palm' && c.b === 'thumb')) {
        moves.set('lift', (adj, amt) => {
          adj.thumbLift = clampAbs(adj.thumbLift + amt, MAX_LIFT);
        });
        moves.set('retract', (adj, amt) => {
          // retract may push the thumb FURTHER along the opposition arc
          // freely, but barely back it out: a large negative retract
          // un-opposes the thumb entirely (an extended thumb beside a fist
          // instead of one lifted over it — anatomically wrong escape)
          adj.thumbRetract = Math.max(-0.15, Math.min(MAX_LIFT, adj.thumbRetract + amt));
        });
        moves.set('tcurl', (adj, amt) => {
          adj.thumbCurl = clampAbs(adj.thumbCurl + amt, MAX_LIFT);
        });
        if (c.a === 'thumb') moves.set(`s:${c.b}`, (adj, amt) => bumpSpread(adj, c.b, amt));
      } else if (c.a === 'palm') {
        // a curled finger reached the palm: ease its PIP/DIP flexion so the
        // fingertip rests on the palm surface instead of passing through;
        // easing the MCP handles the middle phalanx pressing the palm
        moves.set(`c:${c.b}`, (adj, amt) => bumpCurl(adj, c.b, amt));
        moves.set(`m:${c.b}`, (adj, amt) => bumpMcp(adj, c.b, amt));
      } else {
        const a = c.a as FingerName;
        const b = c.b;
        moves.set(`p:${a}:${b}`, (adj, amt) => {
          bumpSpread(adj, a, amt);
          bumpSpread(adj, b, -amt);
        });
        moves.set(`s:${a}`, (adj, amt) => bumpSpread(adj, a, amt));
        moves.set(`s:${b}`, (adj, amt) => bumpSpread(adj, b, amt));
        // de-syncing curls/knuckle flexion separates parallel shafts when
        // both fingers are flexed and abduction can no longer part them
        moves.set(`c:${a}`, (adj, amt) => bumpCurl(adj, a, amt));
        moves.set(`c:${b}`, (adj, amt) => bumpCurl(adj, b, amt));
        moves.set(`m:${a}`, (adj, amt) => bumpMcp(adj, a, amt));
        moves.set(`m:${b}`, (adj, amt) => bumpMcp(adj, b, amt));
      }
    }

    let best: { adjust: CollisionAdjust; score: [number, number] } | null = null;
    for (const move of moves.values()) {
      for (const sign of [1, -1]) {
        for (const mag of MAGNITUDES) {
          const trial = cloneAdjust(adjust);
          move(trial, sign * mag);
          const s = score(solve(trial));
          if (better(s, best?.score ?? current)) best = { adjust: trial, score: s };
        }
      }
    }
    if (!best) break; // plateau — no single move helps any further
    adjust = best.adjust;
    current = best.score;
    transforms = solve(adjust);
    changed = true;
  }

  if (current[0] === 0) {
    // settle: shrink the total correction to the smallest collision-free
    // scale so digits come to REST against each other instead of hovering
    // apart (a thumb pressed onto a fist should touch it, not float)
    let lo = 0;
    let hi = 1;
    for (let step = 0; step < 6; step++) {
      const mid = (lo + hi) / 2;
      const scaled = scaleAdjust(adjust, mid);
      if (maxDepth(detectContacts(solve(scaled))) === 0) hi = mid;
      else lo = mid;
    }
    if (hi < 1) {
      adjust = scaleAdjust(adjust, hi);
      transforms = solve(adjust);
      changed = true;
    }
    // component-wise settle: the global scale can only shrink every
    // correction together, which leaves e.g. a thumb hovering on a large
    // lift that other corrections have since made unnecessary. Shrinking
    // each axis individually drops it until contact actually stops it.
    // Skipped at steady rest (nothing shrank) to keep quiet frames cheap.
    if (changed) {
      const comps: [(a: CollisionAdjust) => number, (a: CollisionAdjust, v: number) => void][] = [
        [(a) => a.thumbLift, (a, v) => void (a.thumbLift = v)],
        [(a) => a.thumbRetract, (a, v) => void (a.thumbRetract = v)],
        [(a) => a.thumbCurl, (a, v) => void (a.thumbCurl = v)],
      ];
      for (const f of FINGER_NAMES) {
        comps.push([(a) => a.spreadAngle[f] ?? 0, (a, v) => void (a.spreadAngle[f] = v)]);
        comps.push([(a) => a.curlAngle[f] ?? 0, (a, v) => void (a.curlAngle[f] = v)]);
        comps.push([(a) => a.mcpAngle[f] ?? 0, (a, v) => void (a.mcpAngle[f] = v)]);
      }
      for (let round = 0; round < 2; round++) {
        for (const [get, set] of comps) {
          const v0 = get(adjust);
          if (Math.abs(v0) < 1e-4) continue;
          const free = (s: number): boolean => {
            const trial = cloneAdjust(adjust);
            set(trial, v0 * s);
            return maxDepth(detectContacts(solve(trial))) === 0;
          };
          if (free(0)) {
            set(adjust, 0);
            continue;
          }
          let clo = 0;
          let chi = 1;
          for (let step = 0; step < 5; step++) {
            const mid = (clo + chi) / 2;
            if (free(mid)) chi = mid;
            else clo = mid;
          }
          if (chi < 1) set(adjust, v0 * chi);
        }
      }
      transforms = solve(adjust);
    }
  }
  return { transforms, adjust };
}

function scaleAdjust(a: CollisionAdjust, s: number): CollisionAdjust {
  const scaleMap = (m: Partial<Record<FingerName, number>>) => {
    const out: Partial<Record<FingerName, number>> = {};
    for (const [f, v] of Object.entries(m)) out[f as FingerName] = (v ?? 0) * s;
    return out;
  };
  return {
    spreadAngle: scaleMap(a.spreadAngle),
    curlAngle: scaleMap(a.curlAngle),
    mcpAngle: scaleMap(a.mcpAngle),
    thumbLift: a.thumbLift * s,
    thumbRetract: a.thumbRetract * s,
    thumbCurl: a.thumbCurl * s,
  };
}

export type { JointTransforms };
