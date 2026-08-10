/** Pose model: plain serializable JSON descriptions of hand shapes. */
import { clamp, lerp, quatSlerp, type Quat } from './math.js';
import { FINGER_NAMES, type FingerName, type JointName } from './skeleton.js';

export interface FingerPose {
  /** 0 = straight, 1 = fully flexed (MCP+PIP; DIP follows unless curlTip set) */
  curl?: number;
  /** decoupled fingertip (DIP/IP) curl; defaults to anatomical coupling */
  curlTip?: number;
  /** −1..1 abduction relative to natural splay (positive = toward thumb) */
  spread?: number;
  /** thumb only: 0 = alongside palm, 1 = fully opposed across the palm */
  oppose?: number;
}

export interface WristPose {
  /** flexion(+)/extension(−), radians */
  pitch?: number;
  /** radial(+)/ulnar(−) deviation, radians */
  yaw?: number;
  /** pronation/supination, radians */
  roll?: number;
}

export interface HandPose {
  fingers?: Partial<Record<FingerName, FingerPose>>;
  /** global splay bias applied to all fingers, −1..1 */
  spread?: number;
  wrist?: WristPose;
  /** raw per-joint local rotation overrides (bypass the solver) */
  joints?: Partial<Record<JointName, Quat>>;
  /**
   * Set false to skip finger-collision resolution for this pose
   * (deliberate contact/crossing, e.g. ASL R's crossed fingers).
   */
  collide?: boolean;
}

/** A two-hand pose (e.g. shadow figures that need both hands). */
export interface TwoHandPose {
  left: HandPose;
  right: HandPose;
  /** optional hint for stages: world placement of each hand */
  placement?: {
    left?: HandPlacement;
    right?: HandPlacement;
  };
}

export interface HandPlacement {
  /** metres */
  position?: [number, number, number];
  /** euler XYZ, radians */
  rotation?: [number, number, number];
}

export const isTwoHandPose = (p: HandPose | TwoHandPose): p is TwoHandPose =>
  'left' in p && 'right' in p;

/** Fully-specified finger parameters (defaults applied). */
export interface ResolvedFingerPose {
  curl: number;
  curlTip: number | null;
  spread: number;
  oppose: number;
}

export type ResolvedPose = {
  fingers: Record<FingerName, ResolvedFingerPose>;
  wrist: Required<WristPose>;
  joints: Partial<Record<JointName, Quat>>;
};

/** Apply defaults so every parameter has a concrete value. */
export function resolvePose(pose: HandPose): ResolvedPose {
  const fingers = {} as Record<FingerName, ResolvedFingerPose>;
  for (const f of FINGER_NAMES) {
    const fp = pose.fingers?.[f] ?? {};
    fingers[f] = {
      curl: fp.curl ?? 0,
      curlTip: fp.curlTip ?? null,
      spread: (fp.spread ?? 0) + (pose.spread ?? 0),
      oppose: fp.oppose ?? 0,
    };
  }
  return {
    fingers,
    wrist: {
      pitch: pose.wrist?.pitch ?? 0,
      yaw: pose.wrist?.yaw ?? 0,
      roll: pose.wrist?.roll ?? 0,
    },
    joints: pose.joints ?? {},
  };
}

/**
 * Interpolate two poses in parameter space (natural anatomical in-betweens).
 * Raw joint overrides are slerped when present on either side.
 */
export function blendPoses(a: HandPose, b: HandPose, t: number): HandPose {
  t = clamp(t, 0, 1);
  const ra = resolvePose(a);
  const rb = resolvePose(b);
  const fingers: Partial<Record<FingerName, FingerPose>> = {};
  for (const f of FINGER_NAMES) {
    const fa = ra.fingers[f];
    const fb = rb.fingers[f];
    const tipA = fa.curlTip ?? fa.curl;
    const tipB = fb.curlTip ?? fb.curl;
    const blended: FingerPose = {
      curl: lerp(fa.curl, fb.curl, t),
      spread: lerp(fa.spread, fb.spread, t),
      oppose: lerp(fa.oppose, fb.oppose, t),
    };
    if (fa.curlTip !== null || fb.curlTip !== null) {
      blended.curlTip = lerp(tipA, tipB, t);
    }
    fingers[f] = blended;
  }
  const pose: HandPose = {
    fingers,
    wrist: {
      pitch: lerp(ra.wrist.pitch, rb.wrist.pitch, t),
      yaw: lerp(ra.wrist.yaw, rb.wrist.yaw, t),
      roll: lerp(ra.wrist.roll, rb.wrist.roll, t),
    },
  };
  // a deliberate-contact pose keeps collision resolution off mid-transition
  if (a.collide === false || b.collide === false) pose.collide = false;
  const jointNames = new Set([
    ...Object.keys(ra.joints),
    ...Object.keys(rb.joints),
  ] as JointName[]);
  if (jointNames.size > 0) {
    pose.joints = {};
    for (const j of jointNames) {
      const qa = ra.joints[j];
      const qb = rb.joints[j];
      if (qa && qb) pose.joints[j] = quatSlerp(qa, qb, t);
      else if (qa || qb) pose.joints[j] = (qa ?? qb) as Quat;
    }
  }
  return pose;
}

export const NEUTRAL_POSE: HandPose = {
  fingers: {
    thumb: { curl: 0.15, oppose: 0.1 },
    index: { curl: 0.1 },
    middle: { curl: 0.12 },
    ring: { curl: 0.14 },
    pinky: { curl: 0.16 },
  },
};
