/**
 * Anatomy solver: converts pose parameters into joint rotations for the
 * WebXR hand skeleton, respecting human range of motion, then runs forward
 * kinematics to produce armature-space transforms renderers can apply
 * directly (the standard rigs keep joints as flat siblings).
 */
import {
  clamp,
  DEG,
  QUAT_IDENTITY,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatRotate,
  type Quat,
  type Vec3,
} from './math.js';
import { resolvePose, type HandPose } from './pose.js';
import {
  AXES,
  FINGER_NAMES,
  fingerJoints,
  JOINT_NAMES,
  JOINT_PARENT,
  relativeRest,
  type FingerName,
  type JointName,
  type Side,
} from './skeleton.js';

/** Range-of-motion maxima (radians). Sources: typical clinical ROM values. */
export const ROM = {
  mcpFlex: 90 * DEG,
  pipFlex: 105 * DEG,
  dipFlex: 75 * DEG,
  /** DIP flexes at ~⅔ of PIP flexion (tendon coupling) */
  dipCoupling: 2 / 3,
  /** slight hyper-extension allowed at MCP for negative curl */
  mcpHyper: 25 * DEG,
  /** max abduction at MCP, scaled per finger below */
  spreadMax: 22 * DEG,
  thumbCmcOppose: 60 * DEG,
  thumbCmcAbduct: 40 * DEG,
  thumbMpFlex: 55 * DEG,
  thumbIpFlex: 80 * DEG,
  wristPitch: 70 * DEG,
  wristYaw: 30 * DEG,
  wristRoll: 80 * DEG,
} as const;

/** Per-finger splay scale/direction (positive pose spread = toward thumb). */
const SPREAD_SCALE: Record<Exclude<FingerName, 'thumb'>, number> = {
  index: 1.0,
  middle: 0.25,
  ring: -0.7,
  pinky: -1.3,
};

export interface SolveOptions {
  side?: Side;
  /** clamp parameters to human range of motion (default true) */
  clamp?: boolean;
}

/** Rotation of each joint relative to its rest orientation, joint-local. */
export type JointDeltas = Record<JointName, Quat>;

export interface JointTransform {
  /** armature-space position (metres) */
  position: Vec3;
  /** armature-space rotation */
  rotation: Quat;
}

export type JointTransforms = Record<JointName, JointTransform>;

const maybeClamp = (v: number, lo: number, hi: number, doClamp: boolean): number =>
  doClamp ? clamp(v, lo, hi) : v;

/**
 * Solve pose parameters into per-joint delta rotations (relative to rest,
 * in each joint's local frame). Deterministic; raw `joints` overrides are
 * treated as parent-relative rotation deltas and win over the solver.
 */
export function solveDeltas(pose: HandPose, options: SolveOptions = {}): JointDeltas {
  const side = options.side ?? 'right';
  const doClamp = options.clamp ?? true;
  const axes = AXES[side];
  const p = resolvePose(pose);

  const out = {} as JointDeltas;
  for (const j of JOINT_NAMES) out[j] = QUAT_IDENTITY;

  // --- fingers ---
  for (const finger of FINGER_NAMES) {
    if (finger === 'thumb') continue;
    const fp = p.fingers[finger];
    const curl = maybeClamp(fp.curl, -ROM.mcpHyper / ROM.mcpFlex, 1, doClamp);
    const spread = maybeClamp(fp.spread, -1.5, 1.5, doClamp);
    const [, mcp, pip, dip] = fingerJoints(finger);

    const posCurl = Math.max(0, curl);
    const pipAngle = posCurl * ROM.pipFlex;
    const tipCurl = fp.curlTip ?? (posCurl * ROM.dipCoupling * ROM.pipFlex) / ROM.dipFlex;
    const dipAngle = maybeClamp(tipCurl, -0.2, 1, doClamp) * ROM.dipFlex;

    const mcpFlexQ = quatFromAxisAngle(axes.fingerCurl, curl * ROM.mcpFlex);
    const spreadAngle =
      spread * ROM.spreadMax * SPREAD_SCALE[finger as Exclude<FingerName, 'thumb'>];
    // splay fades out as the finger curls (fingers converge in a fist)
    const spreadQ = quatFromAxisAngle(
      axes.fingerSpread,
      spreadAngle * (1 - 0.8 * clamp(posCurl, 0, 1)),
    );

    out[mcp!] = quatNormalize(quatMultiply(spreadQ, mcpFlexQ));
    out[pip!] = quatFromAxisAngle(axes.fingerCurl, pipAngle);
    out[dip!] = quatFromAxisAngle(axes.fingerCurl, dipAngle);
  }

  // --- thumb ---
  {
    const fp = p.fingers.thumb;
    const curl = maybeClamp(fp.curl, -0.3, 1, doClamp);
    const oppose = maybeClamp(fp.oppose, 0, 1, doClamp);
    const spread = maybeClamp(fp.spread, -1, 1, doClamp);
    const [cmc, mp, ip] = fingerJoints('thumb');

    const opposeQ = quatFromAxisAngle(axes.thumbOppose, oppose * ROM.thumbCmcOppose);
    const abductQ = quatFromAxisAngle(axes.thumbAbduct, -spread * ROM.thumbCmcAbduct);
    out[cmc!] = quatNormalize(quatMultiply(opposeQ, abductQ));
    out[mp!] = quatFromAxisAngle(axes.thumbCurl, curl * ROM.thumbMpFlex);
    const tipCurl = fp.curlTip ?? curl * 0.9;
    out[ip!] = quatFromAxisAngle(
      axes.thumbCurl,
      maybeClamp(tipCurl, -0.3, 1, doClamp) * ROM.thumbIpFlex,
    );
  }

  // --- wrist ---
  {
    const { pitch, yaw, roll } = p.wrist;
    if (pitch !== 0 || yaw !== 0 || roll !== 0) {
      const pitchQ = quatFromAxisAngle(
        axes.fingerCurl,
        maybeClamp(pitch, -ROM.wristPitch, ROM.wristPitch, doClamp),
      );
      const yawQ = quatFromAxisAngle(
        axes.fingerSpread,
        maybeClamp(yaw, -ROM.wristYaw, ROM.wristYaw, doClamp),
      );
      const rollQ = quatFromAxisAngle(
        [0, 0, -1],
        maybeClamp(roll, -ROM.wristRoll, ROM.wristRoll, doClamp),
      );
      out.wrist = quatNormalize(quatMultiply(rollQ, quatMultiply(yawQ, pitchQ)));
    }
  }

  // --- raw overrides win ---
  for (const [joint, q] of Object.entries(p.joints) as [JointName, Quat][]) {
    out[joint] = q;
  }

  return out;
}

/**
 * Solve a pose all the way to armature-space joint transforms via forward
 * kinematics over the anatomical hierarchy. This is what renderers apply:
 * set each joint node's position and rotation (the standard WebXR hand rigs
 * keep joints as flat siblings, so both must be written).
 */
export function solvePose(pose: HandPose, options: SolveOptions = {}): JointTransforms {
  const side = options.side ?? 'right';
  const deltas = solveDeltas(pose, options);
  const rel = relativeRest(side);

  const out = {} as JointTransforms;
  // JOINT_NAMES is ordered parents-first (wrist, then each finger base→tip)
  for (const j of JOINT_NAMES) {
    const parent = JOINT_PARENT[j];
    const local = quatNormalize(quatMultiply(rel[j].q, deltas[j]));
    if (!parent) {
      out[j] = { position: rel[j].t, rotation: local };
      continue;
    }
    const p = out[parent];
    const off = quatRotate(p.rotation, rel[j].t);
    out[j] = {
      position: [p.position[0] + off[0], p.position[1] + off[1], p.position[2] + off[2]],
      rotation: quatNormalize(quatMultiply(p.rotation, local)),
    };
  }
  return out;
}
