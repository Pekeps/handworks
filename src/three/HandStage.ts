import {
  ACESFilmicToneMapping,
  AmbientLight,
  Clock,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PCFSoftShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  SpotLight,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  getPreset,
  isTwoHandPose,
  type HandPose,
  type Side,
  type TwoHandPose,
} from '../core/index.js';
import { HandModel, type HandModelOptions, type PoseCommandOptions } from './HandModel.js';

export interface HandStageOptions {
  /** element the canvas is appended to (defaults to document.body) */
  container?: HTMLElement;
  /** use an existing canvas instead */
  canvas?: HTMLCanvasElement;
  background?: number | string;
  /** enable orbit controls (default true) */
  controls?: boolean;
}

export interface ShadowTheaterOptions {
  /** render hands as pure black cutouts instead of lit skin (default false) */
  silhouette?: boolean;
  /** wall colour */
  wallColor?: number | string;
}

/**
 * Turnkey scene: renderer, camera, lights, frame loop and resize handling.
 * Everything is exposed (`stage.scene`, `stage.camera`, `stage.renderer`)
 * so you can customize freely.
 */
export class HandStage {
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls | null;
  readonly hands: Partial<Record<Side, HandModel>> = {};
  /** parent group for each hand, used for placement */
  private mounts: Partial<Record<Side, Group>> = {};
  private clock = new Clock();
  private disposed = false;
  private keyLight: DirectionalLight;
  private fillLight: HemisphereLight;
  private theater: {
    wall: Mesh;
    lamp: SpotLight;
    ambient: AmbientLight;
    silhouette: boolean;
  } | null = null;
  private resizeObserver: ResizeObserver | null = null;
  /** extra per-frame callbacks (dt in ms) */
  onFrame: ((dt: number) => void) | null = null;

  constructor(options: HandStageOptions = {}) {
    const container = options.container ?? document.body;
    this.renderer = new WebGLRenderer({
      canvas: options.canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFSoftShadowMap;
    if (!options.canvas) container.appendChild(this.renderer.domElement);
    const host = options.canvas?.parentElement ?? container;

    this.scene = new Scene();
    this.scene.background = new Color(options.background ?? 0x14161a);

    this.camera = new PerspectiveCamera(35, 1, 0.01, 10);
    this.camera.position.set(0, 0.05, 0.55);
    this.camera.lookAt(0, 0.05, 0);

    this.keyLight = new DirectionalLight(0xfffaf4, 2.2);
    this.keyLight.position.set(0.4, 0.6, 0.7);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(1024, 1024);
    this.scene.add(this.keyLight);
    this.fillLight = new HemisphereLight(0xdde4f5, 0x4a4540, 0.9);
    this.scene.add(this.fillLight);

    this.controls =
      (options.controls ?? true)
        ? new OrbitControls(this.camera, this.renderer.domElement)
        : null;
    if (this.controls) {
      this.controls.target.set(0, 0.05, 0);
      this.controls.enableDamping = true;
    }

    const resize = () => {
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = '100%';
      this.renderer.domElement.style.height = '100%';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    };
    resize();
    this.resizeObserver = new ResizeObserver(resize);
    this.resizeObserver.observe(host);

    this.renderer.setAnimationLoop(() => this.tick());
  }

  /** Load and add a hand. Fingers point up, palm toward the camera. */
  async addHand(options: HandModelOptions & { position?: [number, number, number] } = {}): Promise<HandModel> {
    const side = options.side ?? 'right';
    const model = await HandModel.load(options);
    const mount = new Group();
    // Rig rest: fingers −Y, back of hand toward +X (left) / −X (right).
    // Stand the hand up and face the palm at the camera.
    model.object3D.rotation.set(0, (side === 'left' ? 1 : -1) * (Math.PI / 2), Math.PI);
    model.object3D.position.set(0, 0.09, 0); // wrist sits slightly below origin
    mount.add(model.object3D);
    const otherSide: Side = side === 'left' ? 'right' : 'left';
    const twoHands = !!this.mounts[otherSide];
    mount.position.set(
      options.position?.[0] ?? (twoHands ? (side === 'left' ? -0.12 : 0.12) : 0),
      options.position?.[1] ?? 0,
      options.position?.[2] ?? 0,
    );
    if (twoHands && !options.position) {
      this.mounts[otherSide]!.position.x = otherSide === 'left' ? -0.12 : 0.12;
    }
    this.scene.add(mount);
    this.hands[side] = model;
    this.mounts[side] = mount;
    if (this.theater) this.applyTheaterMaterials();
    return model;
  }

  /** Apply a one- or two-hand pose/preset to the stage's hands. */
  async pose(
    poseOrName: HandPose | TwoHandPose | string,
    options: PoseCommandOptions = {},
  ): Promise<void> {
    const resolved = typeof poseOrName === 'string' ? getPreset(poseOrName) : poseOrName;
    if (!resolved) throw new Error(`handworks: unknown preset "${String(poseOrName)}"`);
    if (isTwoHandPose(resolved)) {
      const tasks: Promise<void>[] = [];
      for (const side of ['left', 'right'] as Side[]) {
        let hand = this.hands[side];
        if (!hand) hand = await this.addHand({ side });
        const placement = resolved.placement?.[side];
        const mount = this.mounts[side]!;
        if (placement?.position) mount.position.set(...placement.position);
        if (placement?.rotation) mount.rotation.set(...placement.rotation);
        tasks.push(hand.pose(resolved[side], options));
      }
      await Promise.all(tasks);
      return;
    }
    const hand = this.hands.right ?? this.hands.left;
    if (!hand) throw new Error('handworks: no hands on stage; call addHand() first');
    await hand.pose(resolved, options);
  }

  /**
   * Shadow-theater mode: a warm lamp in front, a wall behind, and the hand's
   * shadow doing the acting. Pass null to leave the mode.
   */
  shadowTheater(options: ShadowTheaterOptions | null = {}): void {
    if (options === null) {
      if (!this.theater) return;
      this.scene.remove(this.theater.wall, this.theater.lamp, this.theater.ambient);
      this.keyLight.intensity = 2.6;
      this.fillLight.intensity = 1.1;
      this.theater = null;
      this.applyTheaterMaterials();
      return;
    }
    if (this.theater) {
      this.theater.silhouette = options.silhouette ?? this.theater.silhouette;
      this.applyTheaterMaterials();
      return;
    }
    const wall = new Mesh(
      new PlaneGeometry(2.5, 1.8),
      new MeshStandardMaterial({ color: new Color(options.wallColor ?? 0xf5e9d0), roughness: 1 }),
    );
    wall.position.set(0, 0.05, -0.5);
    wall.receiveShadow = true;

    const lamp = new SpotLight(0xffe6b8, 60, 6, 0.5, 0.35, 1.4);
    lamp.position.set(0, 0.1, 1.4);
    lamp.target = wall;
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.camera.near = 0.5;
    lamp.shadow.camera.far = 4;

    const ambient = new AmbientLight(0x404040, 0.6);

    this.keyLight.intensity = 0;
    this.fillLight.intensity = 0.15;
    this.scene.add(wall, lamp, ambient);
    this.theater = { wall, lamp, ambient, silhouette: options.silhouette ?? false };
    this.applyTheaterMaterials();
  }

  private applyTheaterMaterials(): void {
    const silhouette = this.theater?.silhouette ?? false;
    for (const side of ['left', 'right'] as Side[]) {
      this.hands[side]?.object3D.traverse((node) => {
        const mesh = node as Mesh;
        if (!mesh.isMesh) return;
        const mat = mesh.material as MeshStandardMaterial;
        if (!mat?.isMeshStandardMaterial) return;
        if (silhouette) {
          mat.color.set(0x000000);
          mat.roughness = 1;
        } else {
          mat.color.set(0xffffff);
          mat.roughness = 0.55;
        }
      });
    }
  }

  private tick(): void {
    if (this.disposed) return;
    const dt = Math.min(this.clock.getDelta() * 1000, 50);
    for (const side of ['left', 'right'] as Side[]) this.hands[side]?.update(dt);
    this.onFrame?.(dt);
    this.controls?.update();
    this.renderer.render(this.scene, this.camera);
  }

  dispose(): void {
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.resizeObserver?.disconnect();
    this.controls?.dispose();
    this.renderer.dispose();
  }
}
