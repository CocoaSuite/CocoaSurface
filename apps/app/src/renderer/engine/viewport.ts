import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { findLayer, type Channel } from '@cocoasurface/project';
import { currentLayer, currentSet, get, push, toast, useApp } from '../store';
import { engine } from './engine';
import { cageGeometry, settingsOf } from '../baking';
import { BAKE_LAYER, hexRgb, type Key, type StrokeOptions } from './gpu';

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
  private needs = true;
  private raf = 0;
  private ro: ResizeObserver;
  private cursor: HTMLDivElement;
  private stroke: { set: string; opts: StrokeOptions; last: THREE.Vector2; carry: number } | null = null;
  private ray = new THREE.Raycaster();
  private queued: THREE.Vector3[] = [];
  private unsub: () => void;

  constructor(readonly host: HTMLElement) {
    this.r = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.r.toneMapping = THREE.AgXToneMapping;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.r.setClearColor(0x1b1b1b, 1);
    host.appendChild(this.r.domElement);
    this.r.domElement.className = 'cs-gl';
    const pm = new THREE.PMREMGenerator(this.r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
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
    if (s.bakePaint) {
      const v = s.tool === 'erase' ? (s.bakePaint === 'skew' ? 0 : 0.5) : s.bakeValue;
      return { set: t.id, opts: { key: s.bakePaint, layer: BAKE_LAYER, values: new Map([[s.bakePaint, [v, v, v, 1]]]), opacity: s.brush.opacity, erase: false } };
    }
    if (!l) return 'Pick a layer to paint on.';
    if (l.locked) return 'The layer is locked.';
    if (!l.visible) return 'The layer is hidden.';
    const erase = s.tool === 'erase';
    const b = s.brush;
    const values = new Map<Key, [number, number, number, number]>();
    let key: Key;
    const item = s.maskItem ? l.mask?.items.find((x) => x.id === s.maskItem) : undefined;
    if (s.maskItem && item) {
      if (item.kind !== 'paint') return 'Pick a Paint item in the mask to draw on it.';
      const v = b.maskValue;
      return { set: t.id, opts: { key: 'grey', layer: item.id, values: new Map([['grey', [v, v, v, 1]]]), opacity: b.opacity, erase } };
    } else if (l.kind === 'paint') {
      key = 'color';
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
    } else return l.kind === 'fill' ? 'Fill layers show through their mask. Add a black mask and a Paint item to draw where it shows.' : 'Groups can’t be painted.';
    return { set: t.id, opts: { key, layer: l.id, values, opacity: b.opacity, erase } };
  }

  private dabsAlong(from: THREE.Vector2, to: THREE.Vector2, carry: number): { dabs: THREE.Vector3[]; carry: number } {
    const b = get().brush;
    const k = this.r.getPixelRatio();
    const radius = (b.size / 2) * k;
    const step = Math.max(1, radius * 2 * b.spacing);
    const len = from.distanceTo(to);
    const out: THREE.Vector3[] = [];
    let d = carry;
    while (d <= len) {
      const p = from.clone().lerp(to, len ? d / len : 0);
      out.push(new THREE.Vector3(p.x, p.y, radius));
      d += step;
    }
    if (get().symmetry) for (const m of out.map((p) => this.mirror(p))) if (m) out.push(m);
    return { dabs: out, carry: d - len };
  }

  /** The dab on the other side of the model (mirrored across X), if it can be seen. */
  private mirror(p: THREE.Vector3): THREE.Vector3 | null {
    const m = engine.model;
    if (!m) return null;
    const w = this.r.domElement.width, h = this.r.domElement.height;
    this.ray.setFromCamera(new THREE.Vector2((p.x / w) * 2 - 1, (p.y / h) * 2 - 1), this.camera);
    const hit = this.ray.intersectObjects(m.parts.map((x) => x.mesh), false)[0];
    if (!hit) return null;
    const q = hit.point.clone();
    q.x = -q.x;
    q.project(this.camera);
    if (Math.abs(q.x) > 1 || Math.abs(q.y) > 1) return null;
    return new THREE.Vector3((q.x * 0.5 + 0.5) * w, (q.y * 0.5 + 0.5) * h, p.z);
  }

  private bindInput(): void {
    const el = this.r.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerleave', () => (this.cursor.style.display = 'none'));
    window.addEventListener('keydown', (e) => e.key === 'Alt' && this.navButtons(true));
    window.addEventListener('keyup', (e) => e.key === 'Alt' && this.navButtons(false));
    window.addEventListener('blur', () => this.navButtons(false));
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
      const t = this.strokeTarget();
      if (typeof t === 'string') return toast(t);
      el.setPointerCapture(e.pointerId);
      const g = engine.sets.get(t.set)!;
      g.ensure();
      engine.p!.measure(this.camera, el.width, el.height);
      g.beginStroke();
      const at = this.screen(e);
      this.stroke = { ...t, last: at, carry: 0 };
      engine.active = { set: t.set, layer: t.opts.layer, keys: [...t.opts.values.keys()] };
      this.paintTo(at);
    });
    el.addEventListener('pointermove', (e) => {
      const b = el.getBoundingClientRect();
      this.cursor.style.transform = `translate(${e.clientX - b.left}px, ${e.clientY - b.top}px)`;
      this.cursor.style.display = get().tool === 'orbit' ? 'none' : 'block';
      if (this.stroke) for (const ev of e.getCoalescedEvents?.() ?? [e]) this.paintTo(this.screen(ev));
    });
    const end = () => {
      const st = this.stroke;
      if (!st) return;
      this.flush();
      this.stroke = null;
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
      push({ label: st.opts.layer === BAKE_LAYER ? `Paint ${st.opts.key}` : `${get().tool === 'erase' ? 'Erase' : 'Paint'} on ${l?.name ?? 'layer'}`, undo: swapAll, redo: swapAll, drop: () => old.forEach((t) => t.dispose()) });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  }

  private paintTo(at: THREE.Vector2): void {
    const st = this.stroke!;
    const { dabs, carry } = this.dabsAlong(st.last, at, st.carry);
    st.last = at;
    st.carry = carry;
    this.queued.push(...dabs);
    this.redraw();
  }

  /** Draw the dabs gathered since the last frame. */
  private flush(): void {
    const st = this.stroke;
    if (!st || !this.queued.length) return;
    const g = engine.sets.get(st.set)!;
    const b = get().brush;
    const el = this.r.domElement;
    g.dabs(this.camera, new THREE.Vector2(el.width, el.height), this.queued, b.hardness, b.flow);
    this.queued = [];
    g.preview(st.opts);
    requestFor(st.set, st.opts);
  }
}

/** Recomposite what a stroke changes: its channels, everything for a mask, nothing for bake maps. */
function requestFor(set: string, o: StrokeOptions): void {
  if (o.key === 'skew' || o.key === 'offset') engine.request(set, []);
  else if (o.key === 'grey') engine.request(set);
  else engine.request(set, [...o.values.keys()].filter((k): k is Channel => k !== 'grey' && k !== 'skew' && k !== 'offset'));
}
