import {
  Bone,
  Group,
  Material,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  SkinnedMesh,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { bakeCreaseMap, type CreaseMap } from './creases.js';
import { createSkinMaterial, type SkinOptions } from './skin.js';
import {
  applyAdjustToPose,
  detectContacts,
  emptyAdjust,
  fingerspellSequence,
  maxDepth,
  getPreset,
  isTwoHandPose,
  JOINT_NAMES,
  mixAdjust,
  NEUTRAL_POSE,
  PoseTween,
  Sequencer,
  solvePoseTracked,
  solveWithAdjust,
  asl,
  aslKeyFor,
  type CollisionAdjust,
  type FingerName,
  type FingerspellOptions,
  type HandPose,
  type JointName,
  type SequenceStep,
  type Side,
  type TweenOptions,
} from '../core/index.js';

export interface HandModelOptions {
  side?: Side;
  /** custom GLB url; must be rigged with WebXR hand joint names */
  url?: string | URL;
  /** reuse an existing loader (e.g. with DRACO configured) */
  loader?: GLTFLoader;
  /**
   * Procedural skin material options (see SkinOptions / SKIN_TONES).
   * Pass false to keep the model's own material.
   */
  skin?: SkinOptions | false;
}

export interface PoseCommandOptions extends TweenOptions {}

const DEFAULT_URLS: Record<Side, URL> = {
  left: new URL('../assets/left.glb', import.meta.url),
  right: new URL('../assets/right.glb', import.meta.url),
};

/**
 * A rigged, skinned hand driven by the handworks pose engine.
 * Add `model.object3D` to any three.js scene and call `model.update(dt)`
 * from your frame loop (dt in milliseconds).
 */
export class HandModel {
  readonly side: Side;
  readonly object3D: Group;
  private bones = new Map<JointName, Bone>();
  private currentPose: HandPose = NEUTRAL_POSE;
  private tween: PoseTween | null = null;
  private tweenResolve: (() => void) | null = null;
  private sequencer = new Sequencer();
  private dirty = true;
  /** live per-finger parameter proxies (hand.fingers.index.curl = 0.5) */
  readonly fingers: Record<FingerName, LiveFinger>;

  /** UV-space crease map baked from this mesh's geometry (see creases.ts) */
  private creaseMap: CreaseMap | null = null;

  private constructor(side: Side, root: Group, skin: SkinOptions | false) {
    this.side = side;
    this.object3D = root;
    root.traverse((node: Object3D) => {
      if ((node as Bone).isBone && JOINT_NAMES.includes(node.name as JointName)) {
        this.bones.set(node.name as JointName, node as Bone);
      }
      if ((node as Mesh).isMesh) {
        node.castShadow = true;
        node.frustumCulled = false;
        const mesh = node as SkinnedMesh;
        if (skin !== false) {
          this.creaseMap ??= bakeCreaseMap(mesh.geometry, side);
          (mesh.material as Material).dispose();
          mesh.material = createSkinMaterial(skin, this.creaseMap);
        } else {
          const mat = mesh.material as MeshStandardMaterial;
          if (mat?.isMeshStandardMaterial) {
            mat.roughness = 0.55;
            mat.metalness = 0;
          }
        }
      }
    });
    this.fingers = Object.fromEntries(
      (['thumb', 'index', 'middle', 'ring', 'pinky'] as FingerName[]).map((f) => [
        f,
        new LiveFinger(this, f),
      ]),
    ) as Record<FingerName, LiveFinger>;
  }

  static async load(options: HandModelOptions = {}): Promise<HandModel> {
    const side = options.side ?? 'right';
    const url = options.url ?? DEFAULT_URLS[side];
    const loader = options.loader ?? new GLTFLoader();
    const gltf = await loader.loadAsync(url.toString());
    const root = new Group();
    root.name = `handworks-${side}`;
    root.add(gltf.scene);
    const model = new HandModel(side, root, options.skin ?? {});
    if (model.bones.size < 25) {
      throw new Error(
        `handworks: model at ${url} exposes ${model.bones.size}/25 WebXR hand joints`,
      );
    }
    model.applyPose(model.currentPose);
    return model;
  }

  /** Swap the procedural skin (e.g. a different tone). */
  setSkin(options: SkinOptions): void {
    this.object3D.traverse((node) => {
      const mesh = node as Mesh;
      if (!mesh.isMesh) return;
      this.creaseMap ??= bakeCreaseMap(mesh.geometry, this.side);
      (mesh.material as Material).dispose();
      mesh.material = createSkinMaterial(options, this.creaseMap);
    });
  }

  /** The raw three.js bone for a joint — full manual control. */
  joint(name: JointName): Bone {
    const bone = this.bones.get(name);
    if (!bone) throw new Error(`handworks: unknown joint ${name}`);
    return bone;
  }

  /** Current pose (parametric description, not raw bone state). */
  getPose(): HandPose {
    return this.currentPose;
  }

  /**
   * The pose the hand is ACTUALLY holding: current pose with the collision
   * corrections folded back into its parameters. When collision prevention
   * blocks part of a motion, this differs from getPose() — feed it to UIs so
   * controls settle where the fingers really stopped, or setPose() it to
   * commit the physical pose as the new intent.
   */
  getEffectivePose(): HandPose {
    const { adjust } = solvePoseTracked(this.currentPose, { side: this.side }, this.adjustState);
    return applyAdjustToPose(this.currentPose, adjust);
  }

  /** Snap to a pose instantly. Accepts a pose object or preset name ("asl.B"). */
  setPose(pose: HandPose | string): void {
    this.cancelAnimation();
    this.currentPose = this.resolve(pose);
    this.dirty = true;
  }

  /** Tween to a pose. Resolves when the motion completes. */
  pose(pose: HandPose | string, options: PoseCommandOptions = {}): Promise<void> {
    this.cancelAnimation();
    const target = this.resolve(pose);
    this.tween = new PoseTween(this.currentPose, target, options);
    return new Promise<void>((resolve) => {
      this.tweenResolve = resolve;
    });
  }

  /** Play a pose sequence. Resolves when it finishes. */
  sequence(steps: SequenceStep[], callbacks: { onStep?: (step: SequenceStep, i: number) => void } = {}): Promise<void> {
    this.cancelAnimation();
    return new Promise<void>((resolve) => {
      this.sequencer.play(steps, this.currentPose, {
        onStep: callbacks.onStep,
        onDone: resolve,
      });
    });
  }

  /** Fingerspell text using ASL handshapes. */
  fingerspell(
    text: string,
    options: Partial<FingerspellOptions> & { onLetter?: (letter: string) => void } = {},
  ): Promise<void> {
    const alphabet: Record<string, HandPose> = {};
    for (const ch of new Set(text.toUpperCase())) {
      const key = aslKeyFor(ch);
      if (key && asl[key]) alphabet[ch] = asl[key];
    }
    const steps = fingerspellSequence(text, { ...options, alphabet });
    return this.sequence(steps, {
      onStep: (step) => {
        if (step.label && step.label !== ' ' && !step.label.endsWith('-bounce')) {
          options.onLetter?.(step.label);
        }
      },
    });
  }

  /** Merge a partial finger change into the current pose (live sliders). */
  mergeFinger(finger: FingerName, patch: Partial<Record<string, number>>): void {
    this.cancelAnimation();
    const pose: HandPose = structuredClone(this.currentPose);
    pose.fingers = { ...pose.fingers, [finger]: { ...pose.fingers?.[finger], ...patch } };
    this.currentPose = pose;
    this.dirty = true;
  }

  set spread(v: number) {
    this.cancelAnimation();
    this.currentPose = { ...this.currentPose, spread: v };
    this.dirty = true;
  }

  setWrist(patch: { pitch?: number; yaw?: number; roll?: number }): void {
    this.cancelAnimation();
    this.currentPose = {
      ...this.currentPose,
      wrist: { ...this.currentPose.wrist, ...patch },
    };
    this.dirty = true;
  }

  /** Advance animations and write joint rotations. dt in milliseconds. */
  update(dt: number): void {
    if (this.tween) {
      this.currentPose = this.tween.advance(dt);
      this.dirty = true;
      if (this.tween.done) {
        this.tween = null;
        this.tweenResolve?.();
        this.tweenResolve = null;
      }
    } else if (this.sequencer.playing) {
      this.currentPose = this.sequencer.advance(dt);
      this.dirty = true;
    }
    if (this.dirty) {
      this.dirty = !this.applyPose(this.currentPose, dt);
    }
  }

  private resolve(pose: HandPose | string): HandPose {
    if (typeof pose !== 'string') return pose;
    const found = getPreset(pose);
    if (!found) throw new Error(`handworks: unknown preset "${pose}"`);
    if (isTwoHandPose(found)) return found[this.side];
    return found;
  }

  private cancelAnimation(): void {
    this.tween = null;
    this.tweenResolve?.();
    this.tweenResolve = null;
    this.sequencer.stop();
  }

  /** collision corrections from the previous frame (temporal smoothing) */
  private adjustState: CollisionAdjust = emptyAdjust();
  /** the previous frame's UNSMOOTHED solve result — warm-starting the next
   *  solve from here (a fixed point) keeps the target stable frame-to-frame
   *  instead of re-deriving it from the moving smoothed state, which made
   *  touching contacts twitch while settling */
  private adjustTarget: CollisionAdjust | undefined;

  /**
   * Solve and write joint transforms. Collision corrections are smoothed
   * over time (~80 ms) so a resolving contact never teleports the hand.
   * Returns true once the corrections have settled (safe to stop updating).
   */
  private applyPose(pose: HandPose, dt = Infinity): boolean {
    const { adjust: target } = solvePoseTracked(
      pose,
      { side: this.side },
      this.adjustTarget ?? this.adjustState,
    );
    this.adjustTarget = target;
    const alpha = dt === Infinity ? 1 : 1 - Math.exp(-dt / 80);
    this.adjustState = mixAdjust(this.adjustState, target, alpha);
    // render from the smoothed corrections — continuous, so no twitching.
    // Only when they visibly penetrate (they lag a fast-moving pose) does a
    // warm-started cleanup re-resolve kick in; near rest and at touching
    // contacts the threshold keeps the discrete resolver out of the frame.
    let transforms = solveWithAdjust(pose, { side: this.side }, this.adjustState);
    if ((pose.collide ?? true) && maxDepth(detectContacts(transforms)) > 0.0012) {
      transforms = solvePoseTracked(pose, { side: this.side }, this.adjustState).transforms;
    }
    // the rig keeps joints as flat siblings (WebXR convention), so write
    // armature-space position AND rotation computed by the core's FK
    for (const [name, bone] of this.bones) {
      const t = transforms[name];
      bone.position.set(t.position[0], t.position[1], t.position[2]);
      (bone.quaternion as Quaternion).set(
        t.rotation[0],
        t.rotation[1],
        t.rotation[2],
        t.rotation[3],
      );
    }
    // settled when the smoothed corrections have reached the target
    const diff =
      Math.abs(this.adjustState.thumbLift - target.thumbLift) +
      Math.abs(this.adjustState.thumbRetract - target.thumbRetract) +
      Math.abs(this.adjustState.thumbCurl - target.thumbCurl) +
      (['thumb', 'index', 'middle', 'ring', 'pinky'] as const).reduce(
        (s, f) =>
          s +
          Math.abs((this.adjustState.spreadAngle[f] ?? 0) - (target.spreadAngle[f] ?? 0)) +
          Math.abs((this.adjustState.curlAngle[f] ?? 0) - (target.curlAngle[f] ?? 0)) +
          Math.abs((this.adjustState.mcpAngle[f] ?? 0) - (target.mcpAngle[f] ?? 0)),
        0,
      );
    return diff < 0.002;
  }
}

/** Live parameter accessors for one finger. */
class LiveFinger {
  constructor(
    private model: HandModel,
    private name: FingerName,
  ) {}
  private get params() {
    return this.model.getPose().fingers?.[this.name] ?? {};
  }
  get curl(): number {
    return this.params.curl ?? 0;
  }
  set curl(v: number) {
    this.model.mergeFinger(this.name, { curl: v });
  }
  get spread(): number {
    return this.params.spread ?? 0;
  }
  set spread(v: number) {
    this.model.mergeFinger(this.name, { spread: v });
  }
  get oppose(): number {
    return this.params.oppose ?? 0;
  }
  set oppose(v: number) {
    this.model.mergeFinger(this.name, { oppose: v });
  }
  get curlTip(): number | undefined {
    return this.params.curlTip;
  }
  set curlTip(v: number | undefined) {
    this.model.mergeFinger(this.name, { curlTip: v });
  }
}
