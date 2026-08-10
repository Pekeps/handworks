/**
 * The 25-joint hand skeleton of the WebXR Hand Input spec, plus rest-pose
 * data and axis conventions measured from the vendored `generic-hand` rig
 * (see scripts/calibrate-rig.mjs).
 *
 * The rig's joints are FLAT siblings in the glTF (WebXR tracking writes
 * absolute transforms), so REST_* transforms are in armature space. The
 * anatomical parent→child chain lives in JOINT_PARENT, and parent-relative
 * rest transforms are derived below for forward kinematics.
 *
 * Joint-local conventions (identical for both hands, verified numerically):
 *  - the bone points along local −Z toward the fingertip
 *  - the back of the hand is local +Y
 *  - finger flexion (curl toward the palm) is a positive rotation about −X
 */
import {
  quatInvert,
  quatMultiply,
  quatNormalize,
  quatRotate,
  type Quat,
  type Vec3,
} from './math.js';

export type Side = 'left' | 'right';

export const FINGER_NAMES = ['thumb', 'index', 'middle', 'ring', 'pinky'] as const;
export type FingerName = (typeof FINGER_NAMES)[number];

const FINGER_PREFIX: Record<FingerName, string> = {
  thumb: 'thumb',
  index: 'index-finger',
  middle: 'middle-finger',
  ring: 'ring-finger',
  pinky: 'pinky-finger',
};

export const JOINT_NAMES = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
] as const;
export type JointName = (typeof JOINT_NAMES)[number];

/** Joints of one finger, base to tip (thumb has 4, fingers 5). */
export function fingerJoints(finger: FingerName): JointName[] {
  const p = FINGER_PREFIX[finger];
  return finger === 'thumb'
    ? ([`${p}-metacarpal`, `${p}-phalanx-proximal`, `${p}-phalanx-distal`, `${p}-tip`] as JointName[])
    : ([
        `${p}-metacarpal`,
        `${p}-phalanx-proximal`,
        `${p}-phalanx-intermediate`,
        `${p}-phalanx-distal`,
        `${p}-tip`,
      ] as JointName[]);
}

/** parent joint of each joint (wrist's parent is null) */
export const JOINT_PARENT: Record<JointName, JointName | null> = (() => {
  const map = { wrist: null } as Record<JointName, JointName | null>;
  for (const finger of FINGER_NAMES) {
    const chain = fingerJoints(finger);
    let prev: JointName = 'wrist';
    for (const j of chain) {
      map[j] = prev;
      prev = j;
    }
  }
  return map;
})();

export interface RestTransform {
  /** rest translation in armature space (metres) */
  t: Vec3;
  /** rest rotation in armature space */
  q: Quat;
}

export type RestPose = Record<JointName, RestTransform>;

/* Rest pose measured from the vendored generic-hand GLBs (model space:
 * fingers point −Y, back of hand faces +X on the left hand). */
export const REST_LEFT: RestPose = {
  wrist: { t: [-0.037324, 0.055986, 0.008114], q: [-0.5, 0.5, 0.5, 0.5] },
  'thumb-metacarpal': { t: [-0.018166, 0.020028, -0.019915], q: [-0.470325, -0.128226, 0.2413, 0.839123] },
  'thumb-phalanx-proximal': { t: [-0.003017, -0.003232, -0.036842], q: [-0.4189, -0.03017, 0.255136, 0.87093] },
  'thumb-phalanx-distal': { t: [0.006388, -0.027137, -0.058799], q: [-0.341943, -0.108182, 0.21152, 0.909193] },
  'thumb-tip': { t: [0.011588, -0.035692, -0.069785], q: [-0.344979, -0.112945, 0.208098, 0.908255] },
  'index-finger-metacarpal': { t: [-0.031836, 0.019583, -0.001378], q: [-0.453265, 0.443597, 0.56703, 0.525594] },
  'index-finger-phalanx-proximal': { t: [-0.030008, -0.03601, -0.015437], q: [-0.544424, 0.472279, 0.495467, 0.484839] },
  'index-finger-phalanx-intermediate': { t: [-0.026774, -0.077768, -0.013908], q: [-0.538231, 0.489196, 0.505236, 0.464469] },
  'index-finger-phalanx-distal': { t: [-0.024555, -0.101934, -0.012578], q: [-0.513785, 0.540051, 0.461053, 0.481456] },
  'index-finger-tip': { t: [-0.025165, -0.113431, -0.011311], q: [-0.507647, 0.541658, 0.462514, 0.48475] },
  'middle-finger-metacarpal': { t: [-0.031618, 0.02688, 0.004855], q: [-0.475765, 0.517914, 0.536281, 0.466707] },
  'middle-finger-phalanx-proximal': { t: [-0.034781, -0.03566, 0.006388], q: [-0.542233, 0.500071, 0.505933, 0.447152] },
  'middle-finger-phalanx-intermediate': { t: [-0.030303, -0.082129, 0.010754], q: [-0.539428, 0.510322, 0.505816, 0.43902] },
  'middle-finger-phalanx-distal': { t: [-0.027531, -0.109369, 0.0138], q: [-0.492846, 0.586054, 0.454965, 0.454589] },
  'middle-finger-tip': { t: [-0.028561, -0.121421, 0.015416], q: [-0.483768, 0.579913, 0.466028, 0.460964] },
  'ring-finger-metacarpal': { t: [-0.031618, 0.028996, 0.01638], q: [-0.490272, 0.599352, 0.518919, 0.362123] },
  'ring-finger-phalanx-proximal': { t: [-0.030795, -0.028708, 0.025579], q: [-0.553353, 0.557948, 0.486226, 0.382204] },
  'ring-finger-phalanx-intermediate': { t: [-0.026439, -0.070328, 0.034875], q: [-0.541336, 0.576459, 0.496761, 0.357601] },
  'ring-finger-phalanx-distal': { t: [-0.023156, -0.095902, 0.041306], q: [-0.515743, 0.580167, 0.502349, 0.380869] },
  'ring-finger-tip': { t: [-0.022382, -0.107586, 0.043637], q: [-0.511453, 0.573781, 0.50382, 0.394152] },
  'pinky-finger-metacarpal': { t: [-0.027904, 0.021913, 0.031113], q: [-0.472767, 0.638673, 0.533652, 0.289489] },
  'pinky-finger-phalanx-proximal': { t: [-0.023633, -0.01791, 0.043168], q: [-0.52398, 0.587587, 0.516337, 0.33702] },
  'pinky-finger-phalanx-intermediate': { t: [-0.019207, -0.051417, 0.050481], q: [-0.518079, 0.627426, 0.497943, 0.299973] },
  'pinky-finger-phalanx-distal': { t: [-0.016352, -0.070417, 0.057069], q: [-0.482037, 0.621573, 0.510483, 0.34741] },
  'pinky-finger-tip': { t: [-0.015562, -0.081921, 0.060045], q: [-0.47842, 0.619371, 0.515121, 0.349491] },
};

export const REST_RIGHT: RestPose = {
  wrist: { t: [0.039126, 0.055775, 0.009157], q: [-0.5, -0.5, -0.5, 0.5] },
  'thumb-metacarpal': { t: [0.019968, 0.019817, -0.018871], q: [-0.46433, 0.158257, -0.209365, 0.845883] },
  'thumb-phalanx-proximal': { t: [0.004818, -0.003443, -0.035799], q: [-0.418267, 0.035194, -0.255945, 0.870808] },
  'thumb-phalanx-distal': { t: [-0.004586, -0.027348, -0.057755], q: [-0.344972, 0.108748, -0.208582, 0.908659] },
  'thumb-tip': { t: [-0.009786, -0.035903, -0.068741], q: [-0.343486, 0.114166, -0.214832, 0.9071] },
  'index-finger-metacarpal': { t: [0.032062, 0.026563, -0.001006], q: [-0.480212, -0.454859, -0.521946, 0.538584] },
  'index-finger-phalanx-proximal': { t: [0.03181, -0.032773, -0.014394], q: [-0.54258, -0.463695, -0.502931, 0.487499] },
  'index-finger-phalanx-intermediate': { t: [0.028576, -0.077979, -0.012865], q: [-0.537272, -0.486956, -0.50762, 0.465333] },
  'index-finger-phalanx-distal': { t: [0.026357, -0.102145, -0.011534], q: [-0.507597, -0.542286, -0.463131, 0.48351] },
  'index-finger-tip': { t: [0.026967, -0.113642, -0.010268], q: [-0.512512, -0.547705, -0.458035, 0.477026] },
  'middle-finger-metacarpal': { t: [0.033072, 0.026669, 0.00573], q: [-0.46226, -0.513635, -0.541776, 0.478512] },
  'middle-finger-phalanx-proximal': { t: [0.036583, -0.035871, 0.007431], q: [-0.545212, -0.501496, -0.505165, 0.44278] },
  'middle-finger-phalanx-intermediate': { t: [0.032105, -0.08234, 0.011797], q: [-0.547738, -0.518615, -0.496014, 0.430108] },
  'middle-finger-phalanx-distal': { t: [0.029333, -0.10958, 0.014843], q: [-0.484146, -0.578653, -0.464074, 0.464111] },
  'middle-finger-tip': { t: [0.030363, -0.121632, 0.01646], q: [-0.480411, -0.576434, -0.468972, 0.465827] },
  'ring-finger-metacarpal': { t: [0.033072, 0.028785, 0.017255], q: [-0.470717, -0.585441, -0.530684, 0.392504] },
  'ring-finger-phalanx-proximal': { t: [0.032597, -0.028918, 0.026622], q: [-0.554501, -0.553794, -0.488066, 0.384229] },
  'ring-finger-phalanx-intermediate': { t: [0.028241, -0.070539, 0.035918], q: [-0.545993, -0.578631, -0.491282, 0.354569] },
  'ring-finger-phalanx-distal': { t: [0.024957, -0.096112, 0.042349], q: [-0.512239, -0.576574, -0.503119, 0.389929] },
  'ring-finger-tip': { t: [0.024184, -0.107797, 0.04468], q: [-0.510669, -0.577271, -0.505771, 0.387519] },
  'pinky-finger-metacarpal': { t: [0.029706, 0.021702, 0.032156], q: [-0.459375, -0.642968, -0.534767, 0.299319] },
  'pinky-finger-phalanx-proximal': { t: [0.025435, -0.01812, 0.044211], q: [-0.518028, -0.580733, -0.524518, 0.345365] },
  'pinky-finger-phalanx-intermediate': { t: [0.021009, -0.051627, 0.051525], q: [-0.515963, -0.626419, -0.499638, 0.302893] },
  'pinky-finger-phalanx-distal': { t: [0.018154, -0.070628, 0.058112], q: [-0.484381, -0.621213, -0.509596, 0.346094] },
  'pinky-finger-tip': { t: [0.017364, -0.082131, 0.061088], q: [-0.498105, -0.631593, -0.496324, 0.326564] },
};

// the baked values are rounded to 6 decimals; make them exactly unit-length
for (const rest of [REST_LEFT, REST_RIGHT]) {
  for (const j of Object.values(rest)) {
    j.q = quatNormalize(j.q);
  }
}

export const restPose = (side: Side): RestPose => (side === 'left' ? REST_LEFT : REST_RIGHT);

/** Rest transform of a joint relative to its anatomical parent joint. */
export type RelativeRest = Record<JointName, RestTransform>;

function computeRelative(rest: RestPose): RelativeRest {
  const out = {} as RelativeRest;
  for (const j of JOINT_NAMES) {
    const parent = JOINT_PARENT[j];
    if (!parent) {
      out[j] = { t: [...rest[j].t] as Vec3, q: [...rest[j].q] as Quat };
      continue;
    }
    const p = rest[parent];
    const c = rest[j];
    const invPq = quatInvert(p.q);
    out[j] = {
      t: quatRotate(invPq, [c.t[0] - p.t[0], c.t[1] - p.t[1], c.t[2] - p.t[2]]),
      q: quatNormalize(quatMultiply(invPq, c.q)),
    };
  }
  return out;
}

const REL_LEFT = computeRelative(REST_LEFT);
const REL_RIGHT = computeRelative(REST_RIGHT);

export const relativeRest = (side: Side): RelativeRest =>
  side === 'left' ? REL_LEFT : REL_RIGHT;

/** Axis conventions per hand side, in joint-local space. */
export interface SideAxes {
  /** finger flexion axis (positive angle = curl toward palm) */
  fingerCurl: Vec3;
  /** abduction axis (positive angle = splay toward the thumb side) */
  fingerSpread: Vec3;
  /** thumb flexion axis at MP/IP joints (positive = flex toward palm) */
  thumbCurl: Vec3;
  /** thumb CMC opposition axis (positive = sweep across palm toward pinky) */
  thumbOppose: Vec3;
  /** thumb CMC abduction axis (positive = lift away from the index finger) */
  thumbAbduct: Vec3;
}

/**
 * Measured from the rig; signs verified with forward kinematics in the test
 * suite (fingertips must approach the palm under positive curl, etc.).
 *
 * Every joint (thumb included) has its nail/dorsal side on local +Y and its
 * bone along −Z, so flexion is a pure hinge about local −X for all digits —
 * the thumb's difference is that its whole column is pre-rotated ~90°, not
 * that its joints hinge differently.
 */
export const AXES: Record<Side, SideAxes> = {
  left: {
    fingerCurl: [-1, 0, 0],
    fingerSpread: [0, -1, 0],
    thumbCurl: [-1, 0, 0],
    thumbOppose: [-0.89, 0.31, 0.32],
    thumbAbduct: [0, -1, 0],
  },
  right: {
    fingerCurl: [-1, 0, 0],
    fingerSpread: [0, 1, 0],
    thumbCurl: [-1, 0, 0],
    thumbOppose: [-0.89, -0.31, -0.33],
    thumbAbduct: [0, 1, 0],
  },
};
