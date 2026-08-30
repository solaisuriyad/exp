import * as THREE from 'three';
import { SHIPS, WORLD } from './core/config.js';
import type { EnemyKind } from './core/types.js';
import type { Bullet } from './entities/bullet.js';

export type BulletFlavour = 'player' | 'playerPower' | 'enemy' | 'enemyHeavy';
import type { Enemy } from './entities/enemy.js';
import type { Pickup } from './entities/pickup.js';
import type { Player } from './entities/player.js';
import type { ParticleField, RingField } from './fx/particles.js';
import type { CameraShake } from './fx/shake.js';

/**
 * All rendering lives here. The simulation never touches Three.js, which keeps
 * the gameplay testable and means the visual layer can be swapped wholesale.
 *
 * Everything is generated procedurally — no model or texture files ship in the
 * APK, so the whole game is a few hundred KB of JavaScript.
 */

const COL = {
  bg: 0x04030f,
  fog: 0x08061c,
  hull: 0x8fd3ff,
  hullDark: 0x2b4a7a,
  accent: 0x64f5ff,
  engine: 0x53d6ff,
  playerBullet: 0x9dff6a,
  enemyBullet: 0xff4d6d,
  grunt: 0xff5566,
  darter: 0xff49c8,
  tank: 0xffa23a,
  boss: 0xb44dff,
  weapon: 0x9dff6a,
  shield: 0x4dc3ff,
  nova: 0xffe14d,
};

const makeCircleTexture = (): THREE.Texture => {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.65)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
};

/** Painted nebula used as the inside of a large sphere. */
const makeNebulaTexture = (): THREE.Texture => {
  const w = 1024;
  const h = 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;

  ctx.fillStyle = '#04030f';
  ctx.fillRect(0, 0, w, h);

  const blobs: Array<[number, number, number, string]> = [
    [0.18, 0.35, 0.42, 'rgba(70,40,140,0.55)'],
    [0.62, 0.62, 0.5, 'rgba(20,90,150,0.45)'],
    [0.85, 0.25, 0.34, 'rgba(150,40,110,0.35)'],
    [0.4, 0.8, 0.3, 'rgba(20,120,120,0.3)'],
    [0.05, 0.7, 0.28, 'rgba(90,30,120,0.35)'],
  ];
  for (const [fx, fy, fr, color] of blobs) {
    const cx = fx * w;
    const cy = fy * h;
    const r = fr * w;
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    g.addColorStop(0, color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  // Fine star dust baked into the skybox so the far field is never empty.
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = 0.15 + Math.random() * 0.6;
    ctx.fillStyle = `rgba(255,255,255,${a})`;
    ctx.fillRect(x, y, Math.random() < 0.9 ? 1 : 2, 1);
  }

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.mapping = THREE.EquirectangularReflectionMapping;
  return tex;
};

export interface RendererQuality {
  bloom: boolean;
  pixelRatioCap: number;
  particleScale: number;
}

export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;

  private composer: unknown = null;
  private bloomEnabled = false;
  private quality: RendererQuality;

  private readonly disposables: Array<{ dispose: () => void }> = [];

  // Shared geometry / materials — one instance each, reused across the pool.
  private readonly geo: Record<string, THREE.BufferGeometry> = {};
  private readonly mat: Record<string, THREE.Material> = {};

  private ship: THREE.Group | null = null;
  private hullMat: THREE.MeshStandardMaterial | null = null;
  private lastShipColor = 0;
  private engineGlow: THREE.Mesh | null = null;
  private lockReticle: THREE.Group | null = null;
  private shieldBubble: THREE.Mesh | null = null;
  private novaRing: THREE.Mesh | null = null;

  private stars!: THREE.Points;
  private starPositions!: Float32Array;
  private readonly starCount = 1400;
  private readonly starSpread = 130;

  private speedLines!: THREE.LineSegments;
  private speedPositions!: Float32Array;

  private readonly bulletMeshes: THREE.Mesh[] = [];
  private readonly enemyMeshes: Map<Enemy, THREE.Object3D> = new Map();
  private readonly pickupMeshes: Map<Pickup, THREE.Mesh> = new Map();

  private particlePoints!: THREE.Points;
  private particleGeo!: THREE.BufferGeometry;
  private readonly ringMeshes: THREE.Mesh[] = [];
  private readonly activeRings: Map<unknown, THREE.Mesh> = new Map();

  private cameraBase = new THREE.Vector3(0, 1.5, 15);
  private shakeRef: CameraShake | null = null;
  private time = 0;

  constructor(canvas: HTMLCanvasElement, quality: Partial<RendererQuality> = {}) {
    this.quality = {
      bloom: quality.bloom ?? true,
      pixelRatioCap: quality.pixelRatioCap ?? 2,
      particleScale: quality.particleScale ?? 1,
    };

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: 'high-performance',
      alpha: false,
      stencil: false,
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    this.camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.5, 900);
    this.camera.position.copy(this.cameraBase);

    this.scene.background = new THREE.Color(COL.bg);
    this.scene.fog = new THREE.Fog(COL.fog, 70, 300);

    this.buildEnvironment();
    this.buildLights();
    this.buildPlayer();
    this.buildParticles();
    void this.initBloom();
  }

  // ---------------------------------------------------------------- setup

  private track<T extends { dispose: () => void }>(x: T): T {
    this.disposables.push(x);
    return x;
  }

  private buildEnvironment(): void {
    // Nebula skybox.
    const nebTex = this.track(makeNebulaTexture());
    const skyGeo = this.track(new THREE.SphereGeometry(600, 32, 20));
    const skyMat = this.track(
      new THREE.MeshBasicMaterial({
        map: nebTex,
        side: THREE.BackSide,
        fog: false,
        depthWrite: false,
      }),
    );
    const sky = new THREE.Mesh(skyGeo, skyMat);
    sky.renderOrder = -10;
    this.scene.add(sky);

    // Parallax starfield.
    const dotTex = this.track(makeCircleTexture());
    this.starPositions = new Float32Array(this.starCount * 3);
    const colors = new Float32Array(this.starCount * 3);
    for (let i = 0; i < this.starCount; i++) {
      this.starPositions[i * 3] = (Math.random() - 0.5) * this.starSpread * 2.2;
      this.starPositions[i * 3 + 1] = (Math.random() - 0.5) * this.starSpread * 1.4;
      this.starPositions[i * 3 + 2] = -Math.random() * 420 + 30;
      const tint = 0.6 + Math.random() * 0.4;
      const warm = Math.random() < 0.25;
      colors[i * 3] = tint * (warm ? 1 : 0.75);
      colors[i * 3 + 1] = tint * 0.85;
      colors[i * 3 + 2] = tint * (warm ? 0.7 : 1);
    }
    const starGeo = this.track(new THREE.BufferGeometry());
    starGeo.setAttribute('position', new THREE.BufferAttribute(this.starPositions, 3));
    starGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const starMat = this.track(
      new THREE.PointsMaterial({
        size: 1.5,
        map: dotTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.stars = new THREE.Points(starGeo, starMat);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);

    // Speed lines — short Z-aligned segments that streak past for a sense of pace.
    const lineCount = 160;
    this.speedPositions = new Float32Array(lineCount * 6);
    for (let i = 0; i < lineCount; i++) {
      const x = (Math.random() - 0.5) * 90;
      const y = (Math.random() - 0.5) * 60;
      const z = -Math.random() * 300 + 20;
      const len = 3 + Math.random() * 7;
      this.speedPositions.set([x, y, z, x, y, z + len], i * 6);
    }
    const lineGeo = this.track(new THREE.BufferGeometry());
    lineGeo.setAttribute('position', new THREE.BufferAttribute(this.speedPositions, 3));
    const lineMat = this.track(
      new THREE.LineBasicMaterial({
        color: 0x6fa8ff,
        transparent: true,
        opacity: 0.22,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    this.speedLines = new THREE.LineSegments(lineGeo, lineMat);
    this.speedLines.frustumCulled = false;
    this.scene.add(this.speedLines);
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0x334466, 1.1));
    const hemi = new THREE.HemisphereLight(0x4466aa, 0x110a22, 0.9);
    this.scene.add(hemi);

    const key = new THREE.DirectionalLight(0xbfe4ff, 1.9);
    key.position.set(-6, 12, 18);
    this.scene.add(key);

    const rim = new THREE.DirectionalLight(0xff5fa8, 1.15);
    rim.position.set(9, -5, -14);
    this.scene.add(rim);

    const shipLight = new THREE.PointLight(0x66e0ff, 22, 26, 2);
    shipLight.position.set(0, 0, 2);
    this.scene.add(shipLight);
  }

  private buildPlayer(): void {
    const g = new THREE.Group();

    const hullMat = this.track(
      new THREE.MeshStandardMaterial({
        color: COL.hull,
        metalness: 0.85,
        roughness: 0.28,
        emissive: new THREE.Color(0x0a2540),
      }),
    ) as THREE.MeshStandardMaterial;
    this.hullMat = hullMat;
    const darkMat = this.track(
      new THREE.MeshStandardMaterial({
        color: COL.hullDark,
        metalness: 0.7,
        roughness: 0.45,
      }),
    );
    const accentMat = this.track(
      new THREE.MeshStandardMaterial({
        color: COL.accent,
        emissive: new THREE.Color(COL.accent),
        emissiveIntensity: 1.6,
        metalness: 0.2,
        roughness: 0.3,
      }),
    );

    const fuselage = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.85, 4.4, 6)), hullMat);
    fuselage.rotation.x = -Math.PI / 2;
    g.add(fuselage);

    const spine = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.55, 0.4, 2.6)), darkMat);
    spine.position.set(0, -0.12, 0.5);
    g.add(spine);

    const wingGeo = this.track(new THREE.BoxGeometry(3.4, 0.16, 1.5));
    const wingL = new THREE.Mesh(wingGeo, hullMat);
    wingL.position.set(-1.5, -0.1, 0.7);
    wingL.rotation.z = 0.22;
    wingL.rotation.y = -0.18;
    g.add(wingL);
    const wingR = new THREE.Mesh(wingGeo, hullMat);
    wingR.position.set(1.5, -0.1, 0.7);
    wingR.rotation.z = -0.22;
    wingR.rotation.y = 0.18;
    g.add(wingR);

    const tipGeo = this.track(new THREE.ConeGeometry(0.22, 1.1, 5));
    for (const sx of [-1, 1]) {
      const tip = new THREE.Mesh(tipGeo, accentMat);
      tip.rotation.x = -Math.PI / 2;
      tip.position.set(sx * 2.9, 0.02, 0.55);
      g.add(tip);
    }

    const cockpit = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(0.46, 12, 10)),
      this.track(
        new THREE.MeshStandardMaterial({
          color: 0x0d2a44,
          emissive: new THREE.Color(0x2b7fff),
          emissiveIntensity: 0.9,
          metalness: 0.4,
          roughness: 0.1,
        }),
      ),
    );
    cockpit.position.set(0, 0.34, -0.3);
    cockpit.scale.set(1, 0.7, 1.5);
    g.add(cockpit);

    // Engine exhaust: an additive cone plus a point light for glow spill.
    const glowMat = this.track(
      new THREE.MeshBasicMaterial({
        color: COL.engine,
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    const glow = new THREE.Mesh(this.track(new THREE.ConeGeometry(0.44, 2.1, 10, 1, true)), glowMat);
    glow.rotation.x = Math.PI / 2;
    glow.position.set(0, -0.05, 2.4);
    g.add(glow);
    this.engineGlow = glow;

    const engineLight = new THREE.PointLight(COL.engine, 10, 12, 2);
    engineLight.position.set(0, 0, 2.6);
    g.add(engineLight);

    // Shield bubble, hidden until active.
    this.shieldBubble = new THREE.Mesh(
      this.track(new THREE.SphereGeometry(2.35, 20, 16)),
      this.track(
        new THREE.MeshBasicMaterial({
          color: 0x59d8ff,
          transparent: true,
          opacity: 0.16,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
        }),
      ),
    );
    this.shieldBubble.visible = false;
    g.add(this.shieldBubble);

    // Nova ring.
    this.novaRing = new THREE.Mesh(
      this.track(new THREE.TorusGeometry(3.1, 0.16, 8, 40)),
      this.track(
        new THREE.MeshBasicMaterial({
          color: COL.nova,
          transparent: true,
          opacity: 0.75,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    this.novaRing.rotation.x = Math.PI / 2;
    this.novaRing.visible = false;
    g.add(this.novaRing);

    this.ship = g;
    this.scene.add(g);

    // Aim-lock reticle: two counter-rotating rings, billboarded in syncLock.
    const ret = new THREE.Group();
    const retMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xff4d6d,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        side: THREE.DoubleSide,
      }),
    );
    const r1 = new THREE.Mesh(this.track(new THREE.RingGeometry(3.1, 3.35, 32)), retMat);
    const r2 = new THREE.Mesh(
      this.track(new THREE.RingGeometry(3.8, 3.95, 4, 1, Math.PI / 6)),
      retMat,
    );
    ret.add(r1, r2);
    ret.visible = false;
    this.lockReticle = ret;
    this.scene.add(ret);
  }

  private buildParticles(): void {
    const dotTex = this.track(makeCircleTexture());
    const max = 700;
    this.particleGeo = this.track(new THREE.BufferGeometry());
    const pos = new Float32Array(max * 3);
    const col = new Float32Array(max * 3);
    const siz = new Float32Array(max);
    this.particleGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particleGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.particleGeo.setAttribute('aSize', new THREE.BufferAttribute(siz, 1));
    this.particleGeo.setDrawRange(0, 0);

    const mat = this.track(
      new THREE.PointsMaterial({
        size: 1,
        map: dotTex,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        sizeAttenuation: true,
        fog: false,
      }),
    );
    this.particlePoints = new THREE.Points(this.particleGeo, mat);
    this.particlePoints.frustumCulled = false;
    this.scene.add(this.particlePoints);

    const ringGeo = this.track(new THREE.RingGeometry(0.85, 1, 32));
    const ringMat = this.track(
      new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.7,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    );
    for (let i = 0; i < 24; i++) {
      const m = new THREE.Mesh(ringGeo, ringMat.clone());
      m.visible = false;
      this.scene.add(m);
      this.ringMeshes.push(m);
    }
  }

  private async initBloom(): Promise<void> {
    if (!this.quality.bloom) return;
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
        import('three/examples/jsm/postprocessing/EffectComposer.js'),
        import('three/examples/jsm/postprocessing/RenderPass.js'),
        import('three/examples/jsm/postprocessing/UnrealBloomPass.js'),
      ]);
      const composer = new EffectComposer(this.renderer);
      composer.addPass(new RenderPass(this.scene, this.camera));
      const bloom = new UnrealBloomPass(
        new THREE.Vector2(window.innerWidth, window.innerHeight),
        0.62,
        0.72,
        0.82,
      );
      composer.addPass(bloom);
      composer.setSize(window.innerWidth, window.innerHeight);
      this.composer = composer;
      this.bloomEnabled = true;
    } catch {
      // Post-processing unavailable (old WebGL) — plain forward render is fine.
      this.composer = null;
      this.bloomEnabled = false;
    }
  }

  setBloom(on: boolean): void {
    this.bloomEnabled = on && this.composer !== null;
    this.quality.bloom = on;
  }

  get bloomActive(): boolean {
    return this.bloomEnabled;
  }

  // ------------------------------------------------------------- pooling

  private bulletGeometry(): THREE.BufferGeometry {
    return (this.geo.bullet ??= this.track(new THREE.CapsuleGeometry(0.2, 1.5, 3, 6)));
  }

  private bulletMaterial(variant: BulletFlavour): THREE.Material {
    const color =
      variant === 'player'
        ? COL.playerBullet
        : variant === 'playerPower'
          ? 0xfff6c8
          : variant === 'enemyHeavy'
            ? 0xffa23a
            : COL.enemyBullet;
    return (this.mat[`bullet_${variant}`] ??= this.track(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ));
  }

  obtainBulletMesh(variant: BulletFlavour): THREE.Mesh {
    let m = this.bulletMeshes.pop();
    if (!m) {
      m = new THREE.Mesh(this.bulletGeometry(), this.bulletMaterial(variant));
      m.frustumCulled = false;
      this.scene.add(m);
    }
    m.material = this.bulletMaterial(variant);
    m.scale.setScalar(variant === 'playerPower' ? 1.9 : variant === 'enemyHeavy' ? 1.6 : 1);
    m.visible = true;
    return m;
  }

  releaseBulletMesh(mesh: THREE.Mesh): void {
    mesh.visible = false;
    mesh.scale.setScalar(1);
    if (this.bulletMeshes.length < 220) this.bulletMeshes.push(mesh);
    else this.scene.remove(mesh);
  }

  private buildEnemyMesh(kind: EnemyKind): THREE.Object3D {
    switch (kind) {
      case 'grunt': {
        const mat = this.track(
          new THREE.MeshStandardMaterial({
            color: COL.grunt,
            emissive: new THREE.Color(0x440008),
            metalness: 0.6,
            roughness: 0.4,
            flatShading: true,
          }),
        );
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.track(new THREE.OctahedronGeometry(1.7, 0)), mat);
        body.scale.set(1, 0.75, 1.35);
        g.add(body);
        const eye = new THREE.Mesh(
          this.track(new THREE.SphereGeometry(0.42, 10, 8)),
          this.track(
            new THREE.MeshBasicMaterial({ color: 0xffe08a, fog: false }),
          ),
        );
        eye.position.set(0, 0, 1.5);
        g.add(eye);
        return g;
      }
      case 'darter': {
        const mat = this.track(
          new THREE.MeshStandardMaterial({
            color: COL.darter,
            emissive: new THREE.Color(0x3a0030),
            metalness: 0.5,
            roughness: 0.35,
            flatShading: true,
          }),
        );
        const m = new THREE.Mesh(this.track(new THREE.TetrahedronGeometry(1.75, 0)), mat);
        m.scale.set(0.85, 0.85, 2.1);
        m.rotation.x = Math.PI / 2;
        return m;
      }
      case 'tank': {
        const mat = this.track(
          new THREE.MeshStandardMaterial({
            color: COL.tank,
            emissive: new THREE.Color(0x331500),
            metalness: 0.75,
            roughness: 0.5,
            flatShading: true,
          }),
        );
        const g = new THREE.Group();
        const body = new THREE.Mesh(this.track(new THREE.DodecahedronGeometry(2.5, 0)), mat);
        g.add(body);
        const ringMat = this.track(
          new THREE.MeshBasicMaterial({
            color: 0xffd08a,
            transparent: true,
            opacity: 0.6,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(3.2, 0.14, 6, 24)), ringMat);
        ring.rotation.x = Math.PI / 2.4;
        g.add(ring);
        return g;
      }
      case 'boss': {
        const g = new THREE.Group();
        const mat = this.track(
          new THREE.MeshStandardMaterial({
            color: COL.boss,
            emissive: new THREE.Color(0x26004d),
            metalness: 0.8,
            roughness: 0.35,
            flatShading: true,
          }),
        );
        const core = new THREE.Mesh(this.track(new THREE.IcosahedronGeometry(5.2, 1)), mat);
        g.add(core);
        const shellMat = this.track(
          new THREE.MeshBasicMaterial({
            color: 0xd58bff,
            wireframe: true,
            transparent: true,
            opacity: 0.4,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        const shell = new THREE.Mesh(this.track(new THREE.IcosahedronGeometry(7.4, 1)), shellMat);
        g.add(shell);
        const ringMat = this.track(
          new THREE.MeshBasicMaterial({
            color: 0xff6ae0,
            transparent: true,
            opacity: 0.55,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            fog: false,
          }),
        );
        for (const [r, rx, rz] of [
          [8.6, Math.PI / 2, 0],
          [9.6, Math.PI / 2.6, 0.4],
        ] as const) {
          const ring = new THREE.Mesh(this.track(new THREE.TorusGeometry(r, 0.22, 6, 48)), ringMat);
          ring.rotation.x = rx;
          ring.rotation.z = rz;
          g.add(ring);
        }
        const eye = new THREE.Mesh(
          this.track(new THREE.SphereGeometry(1.5, 14, 12)),
          this.track(new THREE.MeshBasicMaterial({ color: 0xfff0a0, fog: false })),
        );
        eye.position.set(0, 0, 4.6);
        g.add(eye);
        return g;
      }
      default: {
        // Unreachable for the current archetype set; keeps the switch total.
        return new THREE.Mesh(this.track(new THREE.SphereGeometry(1.6, 8, 6)));
      }
    }
  }

  obtainEnemyMesh(e: Enemy): THREE.Object3D {
    let obj = this.enemyMeshes.get(e);
    if (!obj) {
      obj = this.buildEnemyMesh(e.kind);
      this.enemyMeshes.set(e, obj);
      this.scene.add(obj);
    }
    obj.visible = true;
    return obj;
  }

  releaseEnemyMesh(e: Enemy): void {
    const obj = this.enemyMeshes.get(e);
    if (obj) {
      obj.visible = false;
      this.enemyMeshes.delete(e);
      this.scene.remove(obj);
    }
  }

  private pickupMaterial(kind: Pickup['kind']): THREE.Material {
    const key = `pickup_${kind}`;
    const color =
      kind === 'weapon'
        ? COL.weapon
        : kind === 'shield'
          ? COL.shield
          : kind === 'nova'
            ? COL.nova
            : 0x59ffd8;
    return (this.mat[key] ??= this.track(
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ));
  }

  obtainPickupMesh(p: Pickup): THREE.Mesh {
    let mesh = this.pickupMeshes.get(p);
    if (!mesh) {
      const geo =
        p.kind === 'weapon'
          ? this.track(new THREE.OctahedronGeometry(1.15, 0))
          : p.kind === 'shield'
            ? this.track(new THREE.IcosahedronGeometry(1.15, 0))
            : p.kind === 'aegis'
              ? this.track(new THREE.TorusGeometry(1.05, 0.3, 8, 6)) // hex shield ring
              : this.track(new THREE.TorusKnotGeometry(0.8, 0.28, 40, 6));
      mesh = new THREE.Mesh(geo, this.pickupMaterial(p.kind));
      mesh.frustumCulled = false;
      this.pickupMeshes.set(p, mesh);
      this.scene.add(mesh);
    }
    mesh.material = this.pickupMaterial(p.kind);
    mesh.visible = true;
    return mesh;
  }

  releasePickupMesh(p: Pickup): void {
    const mesh = this.pickupMeshes.get(p);
    if (mesh) {
      mesh.visible = false;
      this.pickupMeshes.delete(p);
      this.scene.remove(mesh);
    }
  }

  setShake(shake: CameraShake): void {
    this.shakeRef = shake;
  }

  // ------------------------------------------------------------ per-frame

  syncPlayer(p: Player, dt: number): void {
    if (!this.ship) return;
    this.ship.visible = p.alive;

    // Per-ship hull tint.
    const shipColor = SHIPS[p.shipId].color;
    if (this.hullMat && shipColor !== this.lastShipColor) {
      this.lastShipColor = shipColor;
      this.hullMat.color.setHex(shipColor);
      this.hullMat.emissive.setHex(shipColor).multiplyScalar(0.12);
    }
    this.ship.position.set(p.x, p.y, WORLD.playerZ);
    this.ship.rotation.z = p.bank;
    this.ship.rotation.x = Math.sin(this.time * 1.7) * 0.02;

    // Blink while invulnerable.
    const blinking = p.invuln > 0 && Math.floor(this.time * 18) % 2 === 0;
    this.ship.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.visible = !blinking;
    });

    if (this.engineGlow) {
      const s = 0.7 + p.throttle * 0.9 + Math.sin(this.time * 40) * 0.07;
      this.engineGlow.scale.set(1, s, 1);
      this.engineGlow.visible = !blinking;
    }

    if (this.shieldBubble) {
      const guarded = p.guard > 0;
      const on = guarded || p.invuln > 0 || p.shields < 3;
      this.shieldBubble.visible = on;
      if (on) {
        const mat = this.shieldBubble.material as THREE.MeshBasicMaterial;
        // AEGIS reads teal, hull shields read blue.
        mat.color.setHex(guarded ? 0x59ffd8 : 0x59d8ff);
        const pulse = 1 + Math.sin(this.time * 5) * 0.05;
        this.shieldBubble.scale.setScalar(guarded ? pulse * 1.12 : pulse);
        mat.opacity =
          (guarded ? 0.2 : 0.1) +
          Math.sin(this.time * 6) * 0.05 +
          (p.invuln > 0 ? 0.12 : 0);
      }
    }

    if (this.novaRing) {
      this.novaRing.visible = p.nova > 0;
      if (p.nova > 0) {
        this.novaRing.rotation.z += dt * 3.2;
        const s = 1 + Math.sin(this.time * 8) * 0.1;
        this.novaRing.scale.setScalar(s);
      }
    }
  }

  syncBullets(bullets: readonly Bullet[]): void {
    for (const b of bullets) {
      if (!b.mesh) continue;
      b.mesh.position.set(b.x, b.y, b.z);
      // Point the capsule along its velocity so shots read as tracers.
      const len = Math.hypot(b.vx, b.vy, b.vz) || 1;
      b.mesh.quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        new THREE.Vector3(b.vx / len, b.vy / len, b.vz / len),
      );
    }
  }

  syncEnemies(enemies: readonly Enemy[], dt: number): void {
    for (const e of enemies) {
      const obj = e.mesh;
      if (!obj) continue;
      obj.position.set(e.x, e.y, e.z);
      const spin = dt * (e.kind === 'boss' ? 0.5 : e.kind === 'tank' ? 0.8 : 2.1);
      obj.rotation.y += spin;
      obj.rotation.z = Math.sin(this.time * 2 + e.phase) * 0.18;
      // Fade in over the first 0.4s so spawns do not pop.
      if (e.age < 0.4) {
        const s = 0.4 + (e.age / 0.4) * 0.6;
        obj.scale.setScalar(s);
      } else if (obj.scale.x !== 1) {
        obj.scale.setScalar(1);
      }
    }
  }

  syncPickups(pickups: readonly Pickup[], dt: number): void {
    for (const p of pickups) {
      const mesh = p.mesh;
      if (!mesh) continue;
      mesh.position.set(p.x, p.y + Math.sin(p.age * 3) * 0.35, p.z);
      mesh.rotation.y += dt * 2.4;
      mesh.rotation.x += dt * 1.1;
      const pulse = 1 + Math.sin(p.age * 6) * 0.12;
      mesh.scale.setScalar(pulse);
    }
  }

  syncLock(target: { x: number; y: number; z: number } | null, dt: number): void {
    if (!this.lockReticle) return;
    if (!target) {
      this.lockReticle.visible = false;
      return;
    }
    this.lockReticle.visible = true;
    this.lockReticle.position.set(target.x, target.y, target.z);
    this.lockReticle.lookAt(this.camera.position);
    this.lockReticle.rotation.z += dt * 2.4;
    const pulse = 1 + Math.sin(this.time * 9) * 0.07;
    this.lockReticle.scale.setScalar(pulse);
  }

  syncParticles(field: ParticleField, rings: RingField): void {
    const posAttr = this.particleGeo.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.particleGeo.getAttribute('color') as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;
    const n = Math.min(field.alive, posAttr.count);
    for (let i = 0; i < n; i++) {
      pos[i * 3] = field.px[i]!;
      pos[i * 3 + 1] = field.py[i]!;
      pos[i * 3 + 2] = field.pz[i]!;
      const f = field.fraction(i);
      const c = field.color[i]!;
      const r = ((c >> 16) & 255) / 255;
      const g = ((c >> 8) & 255) / 255;
      const b = (c & 255) / 255;
      col[i * 3] = r * f;
      col[i * 3 + 1] = g * f;
      col[i * 3 + 2] = b * f;
    }
    this.particleGeo.setDrawRange(0, n);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Rings.
    for (const mesh of this.ringMeshes) mesh.visible = false;
    this.activeRings.clear();
    let ri = 0;
    for (const ring of rings.rings) {
      const mesh = this.ringMeshes[ri++];
      if (!mesh) break;
      const t = ring.age / ring.life;
      const radius = ring.from + (ring.to - ring.from) * (1 - Math.pow(1 - t, 2));
      mesh.visible = true;
      mesh.position.set(ring.x, ring.y, ring.z);
      mesh.scale.setScalar(radius);
      const mat = mesh.material as THREE.MeshBasicMaterial;
      mat.color.setHex(ring.color);
      mat.opacity = (1 - t) * 0.75;
    }
  }

  updateEnvironment(dt: number, speedBoost: number): void {
    this.time += dt;

    // Stars stream toward the camera and recycle at the far plane.
    const zSpeed = (60 + speedBoost * 90) * dt;
    for (let i = 0; i < this.starCount; i++) {
      let z = this.starPositions[i * 3 + 2]! + zSpeed;
      if (z > 30) {
        z -= 450;
        this.starPositions[i * 3] = (Math.random() - 0.5) * this.starSpread * 2.2;
        this.starPositions[i * 3 + 1] = (Math.random() - 0.5) * this.starSpread * 1.4;
      }
      this.starPositions[i * 3 + 2] = z;
    }
    (this.stars.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;

    const lineSpeed = (170 + speedBoost * 240) * dt;
    for (let i = 0; i < this.speedPositions.length / 6; i++) {
      const base = i * 6;
      let z0 = this.speedPositions[base + 2]! + lineSpeed;
      let z1 = this.speedPositions[base + 5]! + lineSpeed;
      if (z0 > 25) {
        const shift = z0 - (-Math.random() * 300 + 20);
        z0 -= shift;
        z1 -= shift;
        this.speedPositions[base] = (Math.random() - 0.5) * 90;
        this.speedPositions[base + 1] = (Math.random() - 0.5) * 60;
        this.speedPositions[base + 3] = this.speedPositions[base]!;
        this.speedPositions[base + 4] = this.speedPositions[base + 1]!;
      }
      this.speedPositions[base + 2] = z0;
      this.speedPositions[base + 5] = z1;
    }
    (this.speedLines.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.speedLines.material as THREE.LineBasicMaterial).opacity = 0.14 + speedBoost * 0.2;
  }

  updateCamera(playerX: number, playerY: number, dt: number): void {
    // The camera leans slightly into the player's movement, which sells speed
    // without moving the playfield out of frame.
    const targetX = playerX * 0.22;
    const targetY = this.cameraBase.y + playerY * 0.14;
    const k = Math.min(1, dt * 3.2);
    this.camera.position.x += (targetX - this.camera.position.x) * k;
    this.camera.position.y += (targetY - this.camera.position.y) * k;

    if (this.shakeRef) {
      const s = this.shakeRef.sample();
      this.camera.position.x += s.x;
      this.camera.position.y += s.y;
      this.camera.rotation.z = s.roll;
    } else {
      this.camera.rotation.z = 0;
    }
    this.camera.lookAt(playerX * 0.1, playerY * 0.06, -40);
  }

  render(): void {
    if (this.bloomEnabled && this.composer) {
      (this.composer as { render: () => void }).render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  resize(w: number, h: number): void {
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.quality.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      (this.composer as { setSize: (w: number, h: number) => void }).setSize(w, h);
    }
  }

  dispose(): void {
    for (const d of this.disposables) {
      try {
        d.dispose();
      } catch {
        /* already disposed */
      }
    }
    this.renderer.dispose();
  }
}
