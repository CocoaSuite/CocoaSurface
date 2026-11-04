/**
 * Running a graph on the graphics card (decision C1): each node draws into its own texture (16-bit float where
 * the card allows), in order, reading the textures of the nodes feeding it. Only nodes whose fingerprint
 * changed (their settings or anything upstream) are drawn again, so dragging a slider redraws just the part
 * of the graph below it.
 *
 * Pictures come out with the top row first (row 0 = the top of the square), the way image files are stored.
 */
import { evaluationOrder, fingerprints, paramsOf, type GraphNode, type MatGraph } from './graph';
import { nodeDef } from './nodes';
import { VERTEX_SHADER, fragmentShader, uniformsFor } from './shader';

export interface EvaluatorOptions {
  /** Load a project image for Image nodes. */
  loadImage?: (path: string) => Promise<TexImageSource>;
  /** An image finished loading: evaluate again to use it. */
  onImage?: () => void;
}

interface Target {
  tex: WebGLTexture;
  fb: WebGLFramebuffer;
  size: number;
}

interface Shared {
  programs: Map<string, { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> }>;
  quad: WebGLVertexArrayObject;
  blank: WebGLTexture;
  float: boolean;
}
const shared = new WeakMap<WebGL2RenderingContext, Shared>();

const DISPLAY_SHADER = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 outColor;
uniform sampler2D u_tex;
uniform float u_flip;
void main() { vec2 uv = vec2(vUv.x, u_flip > 0.5 ? 1. - vUv.y : vUv.y); outColor = vec4(clamp(texture(u_tex, uv).rgb, 0., 1.), 1.); }`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s) ?? '';
    gl.deleteShader(s);
    throw new Error(`Shader didn't compile: ${log}`);
  }
  return s;
}

function sharedOf(gl: WebGL2RenderingContext): Shared {
  let s = shared.get(gl);
  if (s) return s;
  const quad = gl.createVertexArray()!;
  gl.bindVertexArray(quad);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);
  const blank = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, blank);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
  s = { programs: new Map(), quad, blank, float: !!gl.getExtension('EXT_color_buffer_float') };
  shared.set(gl, s);
  return s;
}

function program(gl: WebGL2RenderingContext, key: string, fragment: () => string) {
  const s = sharedOf(gl);
  let p = s.programs.get(key);
  if (p) return p;
  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, fragment()));
  gl.bindAttribLocation(prog, 0, 'a_pos');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(`Shader didn't link: ${gl.getProgramInfoLog(prog) ?? ''}`);
  p = { prog, loc: new Map() };
  s.programs.set(key, p);
  return p;
}

function uniform(gl: WebGL2RenderingContext, p: { prog: WebGLProgram; loc: Map<string, WebGLUniformLocation | null> }, name: string): WebGLUniformLocation | null {
  if (!p.loc.has(name)) p.loc.set(name, gl.getUniformLocation(p.prog, name));
  return p.loc.get(name)!;
}

export class GraphEvaluator {
  private targets = new Map<string, Target>();
  private prints = new Map<string, string>();
  private images = new Map<string, { tex: WebGLTexture | null; state: 'loading' | 'ready' | 'failed' }>();
  private size = 0;
  private sh: Shared;
  /** What went wrong drawing each node (shader problems), by node id. */
  readonly errors = new Map<string, string>();

  constructor(
    readonly gl: WebGL2RenderingContext,
    private opts: EvaluatorOptions = {},
  ) {
    this.sh = sharedOf(gl);
  }

  /** Draw what changed at `size` pixels square. Returns the ids of the nodes drawn again. */
  evaluate(g: MatGraph, size: number): Set<string> {
    const gl = this.gl;
    if (size !== this.size) {
      for (const t of this.targets.values()) this.free(t);
      this.targets.clear();
      this.prints.clear();
      this.size = size;
    }
    const prints = fingerprints(g, (n) => this.imageState(n));
    const drawn = new Set<string>();
    const live = new Set(g.nodes.map((n) => n.id));
    for (const [id, t] of this.targets) if (!live.has(id)) (this.free(t), this.targets.delete(id), this.prints.delete(id), this.errors.delete(id));
    gl.disable(gl.BLEND);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.sh.quad);
    for (const n of evaluationOrder(g)) {
      const fp = prints.get(n.id)!;
      if (this.prints.get(n.id) === fp && this.targets.has(n.id)) continue;
      try {
        this.draw(g, n);
        this.errors.delete(n.id);
      } catch (e) {
        this.errors.set(n.id, (e as Error).message);
      }
      this.prints.set(n.id, fp);
      drawn.add(n.id);
    }
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return drawn;
  }

  /** The picture a node made (null before it has been drawn). */
  texture(id: string): WebGLTexture | null {
    return this.targets.get(id)?.tex ?? null;
  }

  /**
   * Show a node's picture on the context's own canvas at `w` × `h` (to copy into a thumbnail with drawImage
   * straight after). False if there's nothing to show.
   */
  present(id: string, w: number, h: number): boolean {
    const tex = this.texture(id);
    if (!tex) return false;
    const gl = this.gl;
    const c = gl.canvas as HTMLCanvasElement;
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    this.blit(tex, true);
    return true;
  }

  /** A node's picture as RGBA bytes, top row first (for saving as an image). */
  read(id: string): Uint8Array | null {
    const tex = this.texture(id);
    if (!tex) return null;
    const gl = this.gl;
    const n = this.size;
    const out = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, out);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, out, 0);
    gl.viewport(0, 0, n, n);
    // (Not flipped: row 0 of the framebuffer is the top of the square, so the bytes come out top row first.)
    this.blit(tex, false);
    const px = new Uint8Array(n * n * 4);
    gl.readPixels(0, 0, n, n, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.deleteFramebuffer(fb);
    gl.deleteTexture(out);
    return px;
  }

  get pixels(): number {
    return this.size;
  }

  dispose(): void {
    for (const t of this.targets.values()) this.free(t);
    this.targets.clear();
    for (const i of this.images.values()) if (i.tex) this.gl.deleteTexture(i.tex);
    this.images.clear();
  }

  private blit(tex: WebGLTexture, flip: boolean): void {
    const gl = this.gl;
    const p = program(gl, '#display', () => DISPLAY_SHADER);
    gl.useProgram(p.prog);
    gl.bindVertexArray(this.sh.quad);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(uniform(gl, p, 'u_tex'), 0);
    gl.uniform1f(uniform(gl, p, 'u_flip'), flip ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  private imageState(n: GraphNode): string {
    const def = nodeDef(n.type);
    if (!def?.params.some((p) => p.kind === 'image')) return '';
    const params = paramsOf(n);
    return def.params
      .filter((p) => p.kind === 'image')
      .map((p) => {
        const path = String(params[p.id] ?? '');
        if (!path) return '-';
        this.wantImage(path);
        return `${path}:${this.images.get(path)!.state}`;
      })
      .join(',');
  }

  private wantImage(path: string): void {
    if (this.images.has(path)) return;
    if (!this.opts.loadImage) return void this.images.set(path, { tex: null, state: 'failed' });
    const rec: { tex: WebGLTexture | null; state: 'loading' | 'ready' | 'failed' } = { tex: null, state: 'loading' };
    this.images.set(path, rec);
    this.opts.loadImage(path).then(
      (img) => {
        if (this.images.get(path) !== rec) return;
        const gl = this.gl;
        const tex = gl.createTexture()!;
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        rec.tex = tex;
        rec.state = 'ready';
        this.opts.onImage?.();
      },
      () => {
        rec.state = 'failed';
        this.opts.onImage?.();
      },
    );
  }

  private target(id: string): Target {
    let t = this.targets.get(id);
    if (t) return t;
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    if (this.sh.float) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, this.size, this.size, 0, gl.RGBA, gl.HALF_FLOAT, null);
    else gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.size, this.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    t = { tex, fb, size: this.size };
    this.targets.set(id, t);
    return t;
  }

  private free(t: Target): void {
    this.gl.deleteTexture(t.tex);
    this.gl.deleteFramebuffer(t.fb);
  }

  private draw(g: MatGraph, n: GraphNode): void {
    const gl = this.gl;
    const def = nodeDef(n.type)!;
    const p = program(gl, n.type, () => fragmentShader(n.type));
    const t = this.target(n.id);
    gl.bindFramebuffer(gl.FRAMEBUFFER, t.fb);
    gl.viewport(0, 0, this.size, this.size);
    gl.useProgram(p.prog);
    gl.uniform1f(uniform(gl, p, 'u_px'), 1 / this.size);
    let unit = 0;
    const bind = (name: string, tex: WebGLTexture) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.uniform1i(uniform(gl, p, name), unit);
      unit++;
    };
    for (const u of uniformsFor(n.type, paramsOf(n))) {
      const loc = uniform(gl, p, u.type === 'vec3[]' || u.type === 'float[]' ? `${u.name}[0]` : u.name);
      if (u.type === 'float') gl.uniform1f(loc, u.value as number);
      else if (u.type === 'vec3') gl.uniform3fv(loc, u.value as number[]);
      else if (u.type === 'float[]') gl.uniform1fv(loc, u.value as number[]);
      else if (u.type === 'vec3[]') gl.uniform3fv(loc, u.value as number[]);
      else {
        const img = this.images.get(u.value as string);
        const ok = !!img?.tex;
        bind(u.name, img?.tex ?? this.sh.blank);
        gl.uniform1f(uniform(gl, p, `${u.name}_ok`), ok ? 1 : 0);
      }
    }
    for (const port of def.inputs) {
      const link = g.links.find((x) => x.to === n.id && x.input === port.id);
      const src = link ? this.targets.get(link.from) : undefined;
      bind(`i_${port.id}`, src?.tex ?? this.sh.blank);
      gl.uniform1f(uniform(gl, p, `h_${port.id}`), src ? 1 : 0);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
