import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { findLayer, type Channel } from '@cocoasurface/project';
import { currentLayer, currentSet, get, push, toast, useApp } from '../store';
import { engine } from './engine';
import { cageGeometry, settingsOf } from '../baking';
import { BAKE_LAYER, hexRgb, type Key, type StrokeOptions, type Tip } from './gpu';
import { islandAt } from './model';

export type CameraView = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';

export class Viewport {
  readonly r: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly persp = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
  readonly ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, -50, 50);
  readonly controls: OrbitControls;
  private grid = new THREE.GridHelper(4, 20, 0x3a3a3a, 0x2a2a2a);
  private wire = new THREE.Group();
  private wireOf: unknown = null;
  private cage = new THREE.Group();
  private cageKey = '';
  private lightDrag: { x: number; turn: number } | null = null;
  private envTex: THREE.Texture;
  private pm: THREE.PMREMGenerator;
  private envs = new Map<string, { light: THREE.Texture; sky: THREE.Texture | null }>();
  private envLoading = new Set<string>();
  private needs = true;
  private raf = 0;
  private ro: ResizeObserver;
  private cursor: HTMLDivElement;
  private stroke: { set: string; opts: StrokeOptions; last: THREE.Vector2; lazy: THREE.Vector2; carry: number; pressure: number; uv: THREE.Vector2 | null } | null = null;
  private ray = new THREE.Raycaster();
  private queued: THREE.Vector4[] = [];
  private stencilDrag: { x: number; y: number; sx: number; sy: number } | null = null;
  private sDown = false;
  private unsub: () => void;

  constructor(readonly host: HTMLElement) {
    this.r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.r.toneMapping = THREE.AgXToneMapping;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.setClearColor(0x1b1b1b, 1);
    host.appendChild(this.r.domElement);
    this.r.domElement.className = 'cs-gl';
    this.pm = new THREE.PMREMGenerator(this.r);
    this.envTex = this.pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.envs.set('studio', { light: this.envTex, sky: null });
    this.scene.environment = this.envTex;
    this.scene.add(this.grid, this.wire, this.cage);
    this.grid.position.y = -1;
    this.persp.position.set(0, 0.3, 3.4);
    this.ortho.position.copy(this.persp.position);
    this.controls = new OrbitControls(this.persp, this.r.domElement);
    this.controls.enableDamping = false;
    this.controls.addEventListener('change', () => this.redraw());
    this.navButtons(false);
    this.cursor = document.createElement('div');
    this.cursor.className = 'cs-cursor';
    this.cursor.style.width = this.cursor.style.height = `${get().brush.size}px`;
    host.appendChild(this.cursor);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(host);
    engine.attach(this.r);
    engine.onChange = () => this.redraw();
    this.bindInput();
    this.unsub = useApp.subscribe((s, p) => {
      if (s.view !== p.view || s.project !== p.project || s.setId !== p.setId) this.applyView();
      if (s.view.cage !== p.view.cage || s.cagePreview !== p.cagePreview || s.project !== p.project || s.setId !== p.setId) this.showCage();
      if (s.brush.size !== p.brush.size) this.cursor.style.width = this.cursor.style.height = `${s.brush.size}px`;
      if (s.tool !== p.tool) this.navButtons(false);
    });
    this.resize();
    this.applyView();
    this.loop();
  }

  get camera(): THREE.PerspectiveCamera | THREE.OrthographicCamera {
    return get().view.ortho ? this.ortho : this.persp;
  }

  redraw(): void {
    this.needs = true;
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    this.unsub();
    this.controls.dispose();
    this.r.dispose();
    this.r.domElement.remove();
    this.cursor.remove();
  }

  private navButtons(alt: boolean): void {
    const orbit = alt || get().tool === 'orbit';
    this.controls.mouseButtons = { LEFT: orbit ? THREE.MOUSE.ROTATE : (null as unknown as THREE.MOUSE), MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
  }

  private resize(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    if (!w || !h) return;
    this.r.setSize(w, h);
    this.persp.aspect = w / h;
    this.persp.updateProjectionMatrix();
    this.fitOrtho();
    this.redraw();
  }

  private fitOrtho(): void {
    const w = this.host.clientWidth, h = this.host.clientHeight;
    const d = this.persp.position.distanceTo(this.controls.target) * Math.tan(THREE.MathUtils.degToRad(this.persp.fov / 2));
    this.ortho.left = (-d * w) / h;
    this.ortho.right = (d * w) / h;
    this.ortho.top = d;
    this.ortho.bottom = -d;
    this.ortho.updateProjectionMatrix();
  }

  /** Show the model with the current texture sets' materials. */
  showModel(): void {
    const m = engine.model;
    for (const c of [...this.scene.children]) if (c.userData.model) this.scene.remove(c);
    if (m) {
      m.root.userData.model = true;
      this.scene.add(m.root);
      this.frame();
    }
    this.applyView();
  }

  frame(): void {
    const m = engine.model;
    if (!m) return;
    const box = new THREE.Box3().setFromObject(m.root);
    const c = box.getCenter(new THREE.Vector3());
    const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
    const dir = this.persp.position.clone().sub(this.controls.target).normalize();
    this.controls.target.copy(c);
    this.persp.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(this.persp.fov / 2)) * 1.05);
    this.grid.position.y = box.min.y;
    this.syncOrtho();
    this.controls.update();
  }

  look(v: CameraView): void {
    const t = this.controls.target, d = this.persp.position.distanceTo(t);
    const dirs: Record<CameraView, [number, number, number]> = { front: [0, 0, 1], back: [0, 0, -1], left: [-1, 0, 0], right: [1, 0, 0], top: [0, 1, 0.0001], bottom: [0, -1, 0.0001] };
    this.persp.position.copy(t).add(new THREE.Vector3(...dirs[v]).multiplyScalar(d));
    this.syncOrtho();
    this.controls.update();
  }

  private syncOrtho(): void {
    this.ortho.position.copy(this.persp.position);
    this.ortho.quaternion.copy(this.persp.quaternion);
    this.fitOrtho();
  }

  applyView(): void {
    const s = get();
    const v = s.view;
    this.controls.object = this.camera;
    this.syncOrtho();
    this.grid.visible = v.grid;
    this.scene.environmentIntensity = v.light;
    this.scene.environmentRotation.set(0, THREE.MathUtils.degToRad(v.turn), 0);
    this.scene.backgroundRotation.copy(this.scene.environmentRotation);
    const env = this.environment(v.env);
    if (env) this.scene.environment = env.light;
    // The skies are ordinary pictures, not HDR, so they need more strength to light like the studio.
    this.scene.environmentIntensity = v.light * (env?.sky ? 1.8 : 1);
    this.scene.background = v.showEnv && env ? (env.sky ?? env.light) : null;
    this.scene.backgroundBlurriness = env && !env.sky ? 0.5 : 0;
    const m = engine.model;
    if (!v.wire || this.wireOf !== m) {
      for (const c of this.wire.children) (c as THREE.LineSegments).geometry.dispose();
      this.wire.clear();
      this.wireOf = null;
    }
    if (m && s.project) {
      for (const part of m.parts) {
        part.mesh.material = part.slots.map((slot) => {
          const t = s.project!.textureSets.find((x) => x.slots.includes(slot));
          if (!t) return new THREE.MeshStandardMaterial({ color: 0x555555 });
          return v.mode === 'material' ? engine.litMaterial(t.id) : engine.channelMaterial(t.id, v.mode as Exclude<typeof v.mode, 'material'>);
        });
        if (v.wire && this.wireOf !== m) {
          const w = new THREE.LineSegments(new THREE.WireframeGeometry(part.mesh.geometry), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
          this.wire.add(w);
        }
      }
      if (v.wire) this.wireOf = m;
    }
    this.redraw();
  }

  /** An environment's lighting and sky, loaded the first time it's used. */
  private environment(id: string): { light: THREE.Texture; sky: THREE.Texture | null } | null {
    const e = this.envs.get(id);
    if (e || this.envLoading.has(id)) return e ?? null;
    this.envLoading.add(id);
    new THREE.TextureLoader().load(`./env/${id}.jpg`, (sky) => {
      sky.mapping = THREE.EquirectangularReflectionMapping;
      sky.colorSpace = THREE.SRGBColorSpace;
      this.envs.set(id, { light: this.pm.fromEquirectangular(sky).texture, sky });
      this.envLoading.delete(id);
      this.applyView();
    });
    return null;
  }

  /** The bake cage as a see-through shell with its wires. */
  showCage(): void {
    const s = get();
    const t = currentSet(s);
    const st = t && (s.cagePreview ?? settingsOf(t));
    const key = s.view.cage && t && st ? JSON.stringify([t.id, st.useHigh, st.averageNormals, st.cages, st.front, !!engine.high, engine.model?.name]) : '';
    if (key === this.cageKey) return;
    this.cageKey = key;
    for (const c of this.cage.children) {
      const m = c as THREE.Mesh;
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.cage.clear();
    if (key && t && st) {
      for (const g of cageGeometry(t.id, st)) {
        this.cage.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffcd15, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide })));
        this.cage.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffcd15, transparent: true, opacity: 0.35, wireframe: true, depthWrite: false })));
      }
    }
    this.redraw();
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    this.flush();
    if (engine.update()) {
      const s = get();
      if (s.view.mode !== 'material') for (const t of s.project?.textureSets ?? []) engine.channelMaterial(t.id, s.view.mode as Exclude<typeof s.view.mode, 'material'>);
      this.needs = true;
    }
    if (!this.needs) return;
    this.needs = false;
    this.r.setRenderTarget(null);
    this.r.render(this.scene, this.camera);
  };

  // Painting

  private screen(e: PointerEvent): THREE.Vector2 {
    const b = this.r.domElement.getBoundingClientRect();
    const k = this.r.getPixelRatio();
    return new THREE.Vector2((e.clientX - b.left) * k, (b.bottom - e.clientY) * k);
  }

  /** What a stroke would paint now, or why it can't. */
  private strokeTarget(): { set: string; opts: StrokeOptions } | string {
    const s = get();
    const t = currentSet(s);
    const l = currentLayer(s);
    if (!engine.model || !t) return 'Open a model to paint on.';
    const erase = s.tool === 'erase';
    if (s.bakePaint) {
      const v = erase ? (s.bakePaint === 'skew' ? 0 : 0.5) : s.bakeValue;
      return { set: t.id, opts: { key: s.bakePaint, layer: BAKE_LAYER, values: new Map([[s.bakePaint, [v, v, v, 1]]]), opacity: s.brush.opacity, erase: false } };
    }
    if (!l) return 'Pick a layer to paint on.';
    if (l.locked) return 'The layer is locked.';
    if (!l.visible) return 'The layer is hidden.';
    const b = s.brush;
    const item = s.maskItem ? l.mask?.items.find((x) => x.id === s.maskItem) : undefined;
    if (s.maskItem && item) {
      if (item.kind !== 'paint') return 'Pick a Paint effect in the mask to draw on it.';
      const v = b.maskValue;
      return { set: t.id, opts: { key: 'grey', layer: item.id, values: new Map([['grey', [v, v, v, 1]]]), opacity: b.opacity, erase } };
    }
    const fx = s.effect ? l.effects?.find((x) => x.id === s.effect) : undefined;
    if (fx && fx.kind !== 'paint') return 'Pick a Paint effect to draw on it.';
    if (!fx && l.kind !== 'paint') return l.kind === 'fill' ? 'Add a Paint effect or a mask to draw on a fill layer.' : 'Groups can’t be painted.';
    const values = new Map<Key, [number, number, number, number]>();
    for (const c of l.channels) {
      if (!t.channels.includes(c) || c === 'normal') continue;
      const v: Record<string, [number, number, number]> = {
        color: hexRgb(b.color),
        glow: hexRgb(b.glow),
        roughness: [b.roughness, b.roughness, b.roughness],
        metalness: [b.metalness, b.metalness, b.metalness],
        height: [b.height, b.height, b.height],
        occlusion: [1, 1, 1],
        opacity: [1, 1, 1],
      };
      values.set(c, [...v[c]!, 1]);
    }
    if (!values.size) return 'The layer paints none of the texture set’s channels.';
    return { set: t.id, opts: { key: 'color', layer: fx?.id ?? l.id, values, opacity: b.opacity, erase } };
  }

  private tip(): Tip {
    const s = get(), b = s.brush;
    const el = this.r.domElement;
    const st = s.stencil?.on ? s.stencil : null;
    const sImg = st && engine.toolImage(st.name);
    return {
      hardness: b.hardness,
      flow: b.flow,
      shape: b.shape === 'square' ? 1 : b.shape === 'image' ? 2 : 0,
      angle: THREE.MathUtils.degToRad(b.angle),
      alpha: (b.shape === 'image' && b.alpha && engine.toolImage(b.alpha)?.tex) || null,
      stencil: st && sImg ? { tex: sImg.tex, at: new THREE.Vector4(st.x * el.width, (1 - st.y) * el.height, st.scale * el.width, THREE.MathUtils.degToRad(st.angle)), aspect: sImg.aspect } : null,
    };
  }

  private dabsAlong(from: THREE.Vector2, to: THREE.Vector2, carry: number, p0: number, p1: number): { dabs: THREE.Vector4[]; carry: number } {
    const b = get().brush;
    const k = this.r.getPixelRatio();
    const radius = (b.size / 2) * k;
    const bySize = b.pressure === 'size' || b.pressure === 'both', byFlow = b.pressure === 'flow' || b.pressure === 'both';
    const step = Math.max(1, radius * 2 * b.spacing * (bySize ? Math.max(0.1, Math.min(p0, p1)) : 1));
    const len = from.distanceTo(to);
    const out: THREE.Vector4[] = [];
    let d = carry;
    while (d <= len) {
      const f = len ? d / len : 0;
      const p = from.clone().lerp(to, f);
      const pr = p0 + (p1 - p0) * f;
      out.push(new THREE.Vector4(p.x, p.y, radius * (bySize ? Math.max(0.05, pr) : 1), byFlow ? pr : 1));
      d += step;
    }
    if (get().symmetry) for (const m of out.map((p) => this.mirror(p))) if (m) out.push(m);
    return { dabs: out, carry: d - len };
  }

  private hit(x: number, y: number): THREE.Intersection | null {
    const m = engine.model;
    if (!m) return null;
    const w = this.r.domElement.width, h = this.r.domElement.height;
    this.ray.setFromCamera(new THREE.Vector2((x / w) * 2 - 1, (y / h) * 2 - 1), this.camera);
    return this.ray.intersectObjects(m.parts.map((p) => p.mesh), false)[0] ?? null;
  }

  /** The dab on the other side of the model (mirrored across X), if it can be seen. */
  private mirror(p: THREE.Vector4): THREE.Vector4 | null {
    const hit = this.hit(p.x, p.y);
    if (!hit) return null;
    const w = this.r.domElement.width, h = this.r.domElement.height;
    const q = hit.point.clone();
    q.x = -q.x;
    q.project(this.camera);
    if (Math.abs(q.x) > 1 || Math.abs(q.y) > 1) return null;
    return new THREE.Vector4((q.x * 0.5 + 0.5) * w, (q.y * 0.5 + 0.5) * h, p.z, p.w);
  }

  private bindInput(): void {
    const el = this.r.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => (this.cursor.style.display = 'none'));
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Alt') this.navButtons(true);
      if (e.code === 'KeyS' && !e.ctrlKey && !e.metaKey && !(e.target as HTMLElement).closest?.('input, textarea, select')) this.sDown = true;
    });
    window.addEventListener('keyup', (e) => {
      if (e.key === 'Alt') this.navButtons(false);
      if (e.code === 'KeyS') this.sDown = false;
    });
    window.addEventListener('blur', () => (this.navButtons(false), (this.sDown = false)));
    // S and drag moves the stencil, S and the wheel scales it.
    el.addEventListener('wheel', (e) => {
      const st = get().stencil;
      if (!this.sDown || !st) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      useApp.setState({ stencil: { ...st, scale: Math.max(0.02, Math.min(10, st.scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08))) } });
    }, { capture: true, passive: false });
    // Shift and right-drag turns the light around the model.
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 2 || !e.shiftKey) return;
      e.stopImmediatePropagation();
      this.controls.enabled = false;
      el.setPointerCapture(e.pointerId);
      this.lightDrag = { x: e.clientX, turn: get().view.turn };
    }, { capture: true });
    el.addEventListener('pointermove', (e) => {
      const d = this.lightDrag;
      if (!d) return;
      const turn = (((d.turn + (e.clientX - d.x) * 0.5) % 360) + 360) % 360;
      useApp.setState((s) => ({ view: { ...s.view, turn } }));
    });
    const endLight = () => {
      if (!this.lightDrag) return;
      this.lightDrag = null;
      this.controls.enabled = true;
    };
    el.addEventListener('pointerup', endLight);
    el.addEventListener('pointercancel', endLight);
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.altKey || get().tool === 'orbit') return;
      const st = get().stencil;
      if (this.sDown && st) {
        el.setPointerCapture(e.pointerId);
        this.stencilDrag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y };
        return;
      }
      const t = this.strokeTarget();
      if (typeof t === 'string') return toast(t);
      const g = engine.sets.get(t.set)!;
      g.ensure();
      if (get().tool === 'fill') return this.fillAt(e, t);
      el.setPointerCapture(e.pointerId);
      engine.p!.measure(this.camera, el.width, el.height);
      g.beginStroke();
      const at = this.screen(e);
      const pr = pressureOf(e);
      this.stroke = { ...t, last: at, lazy: at.clone(), carry: 0, pressure: pr, uv: this.hit(at.x, at.y)?.uv?.clone() ?? null };
      engine.active = { set: t.set, layer: t.opts.layer, keys: [...t.opts.values.keys()] };
      this.paintTo(at, pr, true);
    });
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      const sd = this.stencilDrag, st = get().stencil;
      if (sd && st) {
        useApp.setState({ stencil: { ...st, x: sd.sx + (e.clientX - sd.x) / b.width, y: sd.sy + (e.clientY - sd.y) / b.height } });
        return;
      }
      this.cursor.style.transform = `translate(${e.clientX - b.left}px, ${e.clientY - b.top}px)`;
      this.cursor.style.display = get().tool === 'orbit' ? 'none' : 'block';
      if (this.stroke) for (const ev of e.getCoalescedEvents?.() ?? [e]) this.paintTo(this.screen(ev), pressureOf(ev));
    });
    const end = () => {
      this.stencilDrag = null;
      const st = this.stroke;
      if (!st) return;
      this.flush();
      this.stroke = null;
      this.finish(st);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  /** The stroke becomes part of its layer, as one undo step. */
  private finish(st: { set: string; opts: StrokeOptions }): void {
    const g = engine.sets.get(st.set)!;
    const old = g.endStroke(st.opts);
    engine.active = null;
    requestFor(st.set, st.opts);
    const keys = [...old.keys()];
    const swapAll = () => {
      for (const k of keys) old.set(k, g.swap(st.opts.layer, k, old.get(k)!)!);
      engine.request(st.set);
    };
    const l = findLayer(currentSet()?.layers ?? [], st.opts.layer) ?? currentLayer();
    const verb = { erase: 'Erase', fill: 'Fill', smudge: 'Smudge', blur: 'Blur' }[get().tool as string] ?? 'Paint';
    push({ label: st.opts.layer === BAKE_LAYER ? `Paint ${st.opts.key}` : `${verb} on ${l?.name ?? 'layer'}`, undo: swapAll, redo: swapAll, drop: () => old.forEach((t) => t.dispose()) });
  }

  /** The fill tool: the UV island (or mesh) under the pointer, at once. */
  private fillAt(e: PointerEvent, t: { set: string; opts: StrokeOptions }): void {
    const at = this.screen(e);
    const hit = this.hit(at.x, at.y);
    const m = engine.model!;
    const part = hit ? m.parts.findIndex((p) => p.mesh === hit.object) : -1;
    if (!hit || part < 0 || hit.faceIndex == null) return toast('Click on the model to fill.');
    const g = engine.sets.get(t.set)!;
    if (!g.parts.includes(part)) return toast('That part belongs to another texture set.');
    g.beginStroke();
    g.fillPart(part, get().brush.fillBy === 'island' ? islandAt(m.parts[part]!.mesh.geometry, hit.faceIndex) : -1);
    engine.active = { set: t.set, layer: t.opts.layer, keys: [...t.opts.values.keys()] };
    g.preview(t.opts);
    this.finish(t);
  }

  private paintTo(at: THREE.Vector2, pr: number, first = false): void {
    const st = this.stroke!;
    let to = at;
    const lazy = get().brush.stabilize * this.r.getPixelRatio();
    if (lazy > 0 && !first) {
      const d = at.distanceTo(st.lazy);
      if (d <= lazy) return;
      to = st.lazy.clone().lerp(at, (d - lazy) / d);
      st.lazy.copy(to);
    }
    const { dabs, carry } = this.dabsAlong(st.last, to, st.carry, st.pressure, pr);
    st.last = to;
    st.carry = carry;
    st.pressure = pr;
    this.queued.push(...dabs);
    this.redraw();
  }

  /** Draw the dabs gathered since the last frame. */
  private flush(): void {
    const st = this.stroke;
    if (!st || !this.queued.length) return;
    const g = engine.sets.get(st.set)!;
    const el = this.r.domElement;
    g.dabs(this.camera, new THREE.Vector2(el.width, el.height), this.queued, this.tip());
    this.queued = [];
    const tool = get().tool;
    if (tool === 'smudge' || tool === 'blur') {
      const offset = new THREE.Vector2();
      if (tool === 'smudge') {
        const uv = this.hit(st.last.x, st.last.y)?.uv?.clone() ?? null;
        if (uv && st.uv) {
          offset.subVectors(st.uv, uv);
          if (offset.length() > 0.05) offset.set(0, 0);
        }
        st.uv = uv;
      }
      g.smearStroke(st.opts, tool === 'smudge' ? 1 : 0, 6 / g.size, offset);
    } else g.preview(st.opts);
    requestFor(st.set, st.opts);
  }
}

const pressureOf = (e: PointerEvent) => (e.pointerType === 'pen' ? Math.max(0.01, e.pressure) : 1);

/** Recomposite what a stroke changes: its channels, everything for a mask, nothing for bake maps. */
function requestFor(set: string, o: StrokeOptions): void {
  if (o.key === 'skew' || o.key === 'offset') engine.request(set, []);
  else if (o.key === 'grey') engine.request(set);
  else engine.request(set, [...o.values.keys()].filter((k): k is Channel => k !== 'grey' && k !== 'skew' && k !== 'offset'));
}
