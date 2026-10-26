// Motor de render propio sobre WebGL2: mallas estáticas, lotes instanciados,
// texturas a partir de canvas, mapa de sombras direccional, cielo y niebla.

import * as M from './Mat4.js';

const VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUV;
layout(location=3) in vec4 aCol;
layout(location=4) in mat4 iModel;
layout(location=8) in vec4 iColor;
layout(location=9) in vec4 iUV;
uniform mat4 uVP;
uniform mat4 uLightVP;
uniform float uTime;
uniform float uCrowd;
uniform vec2 uExcite;
out vec3 vN;
out vec3 vW;
out vec2 vUV;
out vec4 vCol;
out vec4 vL;
void main() {
  vec4 w = iModel * vec4(aPos, 1.0);
  if (uCrowd > 0.5) {
    float ph = iUV.x;
    float ex = mix(uExcite.x, uExcite.y, iUV.y);
    float jump = max(0.0, sin(uTime * (7.0 + ph * 3.0) + ph * 40.0));
    float sway = sin(uTime * 1.3 + ph * 30.0) * 0.02;
    w.y += jump * ex * 0.3 + sway * aPos.y;
    w.x += sway * aPos.y;
    vUV = aUV;
  } else {
    vUV = iUV.xy + aUV * iUV.zw;
  }
  mat3 m3 = mat3(iModel);
  vec3 s2 = vec3(dot(m3[0], m3[0]), dot(m3[1], m3[1]), dot(m3[2], m3[2]));
  vN = m3 * (aNrm / s2);
  vW = w.xyz;
  vCol = vec4(aCol.rgb * mix(vec3(1.0), iColor.rgb, aCol.a), iColor.a);
  vL = uLightVP * w;
  gl_Position = uVP * w;
}`;

const FS = `#version 300 es
precision highp float;
precision highp sampler2DShadow;
in vec3 vN;
in vec3 vW;
in vec2 vUV;
in vec4 vCol;
in vec4 vL;
uniform sampler2D uMap;
uniform sampler2DShadow uShadow;
uniform vec3 uSun;
uniform vec3 uSunCol;
uniform vec3 uSky;
uniform vec3 uGround;
uniform vec3 uFog;
uniform float uFogD;
uniform vec3 uCam;
uniform vec4 uFlags;   // usa textura, sin iluminar, alpha test, recibe sombra
uniform float uEmissive;
uniform float uSpec;
uniform float uAlpha;
uniform float uShadowOn;
uniform vec3 uLamp[4];
uniform vec3 uLampCol;
out vec4 o;
float shadow() {
  vec3 p = vL.xyz / vL.w * 0.5 + 0.5;
  if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z > 1.0) return 1.0;
  float b = 0.0016;
  float t = 1.0 / 2048.0;
  float s = texture(uShadow, vec3(p.xy + vec2(-t, -t) * 0.7, p.z - b));
  s += texture(uShadow, vec3(p.xy + vec2(t, -t) * 0.7, p.z - b));
  s += texture(uShadow, vec3(p.xy + vec2(-t, t) * 0.7, p.z - b));
  s += texture(uShadow, vec3(p.xy + vec2(t, t) * 0.7, p.z - b));
  return s * 0.25;
}
void main() {
  vec4 base = vCol;
  if (uFlags.x > 0.5) base *= texture(uMap, vUV);
  base.a *= uAlpha;
  if (uFlags.z > 0.5 && base.a < 0.35) discard;
  vec3 col;
  if (uFlags.y > 0.5) {
    col = base.rgb * (1.0 + uEmissive);
  } else {
    vec3 n = normalize(vN);
    if (!gl_FrontFacing) n = -n;
    float ndl = max(dot(n, uSun), 0.0);
    float sh = 1.0;
    if (uFlags.w > 0.5 && uShadowOn > 0.5) sh = mix(0.38, 1.0, shadow());
    vec3 hemi = mix(uGround, uSky, n.y * 0.5 + 0.5);
    vec3 light = hemi + uSunCol * ndl * sh;
    vec3 v = normalize(uCam - vW);
    for (int i = 0; i < 4; i++) {
      vec3 l = normalize(uLamp[i] - vW);
      light += uLampCol * max(dot(n, l), 0.0);
    }
    col = base.rgb * light + base.rgb * uEmissive;
    if (uSpec > 0.0) {
      vec3 h = normalize(uSun + v);
      col += uSunCol * pow(max(dot(n, h), 0.0), 40.0) * uSpec * sh;
    }
  }
  float d = length(uCam - vW);
  float f = 1.0 - exp(-d * uFogD);
  col = mix(col, uFog, f * (uFlags.y > 0.5 ? 0.5 : 1.0));
  o = vec4(col, base.a);
}`;

const VS_DEPTH = `#version 300 es
precision highp float;
layout(location=0) in vec3 aPos;
layout(location=4) in mat4 iModel;
uniform mat4 uVP;
void main() { gl_Position = uVP * iModel * vec4(aPos, 1.0); }`;
const FS_DEPTH = `#version 300 es
precision mediump float;
void main() {}`;

const VS_SKY = `#version 300 es
precision highp float;
uniform mat4 uInv;
out vec3 vDir;
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2)) * 2.0 - 1.0;
  vec4 a = uInv * vec4(p, 1.0, 1.0);
  vec4 b = uInv * vec4(p, -1.0, 1.0);
  vDir = a.xyz / a.w - b.xyz / b.w;
  gl_Position = vec4(p, 0.9999, 1.0);
}`;
const FS_SKY = `#version 300 es
precision highp float;
in vec3 vDir;
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uSun;
uniform vec3 uGlow;
uniform float uNight;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 d = normalize(vDir);
  float h = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uTop, pow(h, 0.55));
  float s = max(dot(d, uSun), 0.0);
  c += uGlow * (pow(s, 240.0) * 2.0 + pow(s, 12.0) * 0.25);
  if (uNight > 0.5) {
    vec2 g = floor(d.xz / max(d.y, 0.05) * 90.0);
    float st = step(0.9965, hash(g)) * smoothstep(0.05, 0.4, d.y);
    c += vec3(st) * (0.5 + 0.5 * hash(g + 3.0));
  } else {
    // Nubes suaves
    vec2 q = d.xz / max(d.y, 0.08) * 1.6;
    float n = sin(q.x * 1.7 + sin(q.y * 1.3)) * sin(q.y * 1.1 + sin(q.x * 0.7)) * 0.5 + 0.5;
    n = smoothstep(0.62, 0.95, n) * smoothstep(0.02, 0.3, d.y);
    c = mix(c, vec3(1.0), n * 0.55);
  }
  if (d.y < 0.0) c = mix(uHorizon, uHorizon * 0.5, clamp(-d.y * 4.0, 0.0, 1.0));
  o = vec4(c, 1.0);
}`;

function compile(gl, vs, fs) {
  const mk = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, mk(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(p));
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    const name = info.name.replace('[0]', '');
    u[name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

export const INSTANCE_FLOATS = 24;

export class Camera {
  constructor() {
    this.pos = [0, 30, 60];
    this.target = [0, 0, 0];
    this.fov = 30 * Math.PI / 180;
    this.aspect = 16 / 9;
    this.near = 0.5;
    this.far = 700;
    this.view = M.create();
    this.proj = M.create();
    this.vp = M.create();
    this.inv = M.create();
  }
  update() {
    M.perspective(this.proj, this.fov, this.aspect, this.near, this.far);
    M.lookAt(this.view, this.pos[0], this.pos[1], this.pos[2], this.target[0], this.target[1], this.target[2]);
    M.multiply(this.vp, this.proj, this.view);
    M.invert(this.inv, this.vp);
  }
}

export class Scene {
  constructor() {
    this.items = [];
  }
  /** item: { geo, mat, batch?, castShadow?, visible? } */
  add(item) {
    if (item.visible === undefined) item.visible = true;
    this.items.push(item);
    return item;
  }
}

/** Lote de instancias: matriz + color + rectángulo UV por instancia. */
export class Batch {
  constructor(renderer, geo, capacity, dynamic = true) {
    const gl = renderer.gl;
    this.gl = gl;
    this.geo = geo;
    this.capacity = capacity;
    this.data = new Float32Array(capacity * INSTANCE_FLOATS);
    this.count = 0;
    this.dirty = true;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    renderer.bindGeometryAttribs(geo);
    this.buf = gl.createBuffer();
    renderer.track.vaos.push(this.vao);
    renderer.track.bufs.push(this.buf);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, dynamic ? gl.DYNAMIC_DRAW : gl.STATIC_DRAW);
    const stride = INSTANCE_FLOATS * 4;
    for (let i = 0; i < 4; i++) {
      gl.enableVertexAttribArray(4 + i);
      gl.vertexAttribPointer(4 + i, 4, gl.FLOAT, false, stride, i * 16);
      gl.vertexAttribDivisor(4 + i, 1);
    }
    gl.enableVertexAttribArray(8);
    gl.vertexAttribPointer(8, 4, gl.FLOAT, false, stride, 64);
    gl.vertexAttribDivisor(8, 1);
    gl.enableVertexAttribArray(9);
    gl.vertexAttribPointer(9, 4, gl.FLOAT, false, stride, 80);
    gl.vertexAttribDivisor(9, 1);
    gl.bindVertexArray(null);
  }
  reset() {
    this.count = 0;
    this.dirty = true;
  }
  /** Añade una instancia. m: matriz 4x4. */
  push(m, r = 1, g = 1, b = 1, a = 1, u0 = 0, v0 = 0, us = 1, vs = 1) {
    if (this.count >= this.capacity) return;
    const o = this.count * INSTANCE_FLOATS, d = this.data;
    d.set(m, o);
    d[o + 16] = r; d[o + 17] = g; d[o + 18] = b; d[o + 19] = a;
    d[o + 20] = u0; d[o + 21] = v0; d[o + 22] = us; d[o + 23] = vs;
    this.count++;
  }
  upload() {
    if (!this.dirty) return;
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * INSTANCE_FLOATS);
    this.dirty = false;
  }
}

export class Renderer {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl2', { antialias: opts.antialias !== false, alpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 no disponible');
    this.gl = gl;
    this.main = compile(gl, VS, FS);
    this.depth = compile(gl, VS_DEPTH, FS_DEPTH);
    this.sky = compile(gl, VS_SKY, FS_SKY);
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.maxAniso = this.aniso ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    // Valores por defecto de los atributos de instancia para mallas no instanciadas
    gl.vertexAttrib4f(4, 1, 0, 0, 0);
    gl.vertexAttrib4f(5, 0, 1, 0, 0);
    gl.vertexAttrib4f(6, 0, 0, 1, 0);
    gl.vertexAttrib4f(7, 0, 0, 0, 1);
    gl.vertexAttrib4f(8, 1, 1, 1, 1);
    gl.vertexAttrib4f(9, 0, 0, 1, 1);
    gl.vertexAttrib4f(3, 1, 1, 1, 1);
    this.track = { texs: [], bufs: [], vaos: [] };
    this.white = this.texture(this.solidCanvas('#ffffff'));
    this.track.texs.length = 0; // la textura blanca es permanente
    this.shadowSize = 0;
    this.setShadowSize(opts.shadowSize ?? 2048);
    this.lightVP = M.create();
    this.tmpA = M.create();
    this.tmpB = M.create();
    this.skyVao = gl.createVertexArray();
    this.pixelRatio = 1;
    this.stats = { draws: 0, instances: 0 };
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  solidCanvas(color) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    const x = c.getContext('2d');
    x.fillStyle = color;
    x.fillRect(0, 0, 2, 2);
    return c;
  }

  setShadowSize(size) {
    const gl = this.gl;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFbo); this.shadowTex = null; }
    this.shadowSize = size;
    if (!size) return;
    this.shadowTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.DEPTH_COMPONENT24, size, size, 0, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, this.shadowTex, 0);
    gl.drawBuffers([gl.NONE]);
    gl.readBuffer(gl.NONE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  resize(w, h, dpr) {
    this.pixelRatio = dpr;
    const cw = Math.max(2, Math.round(w * dpr)), ch = Math.max(2, Math.round(h * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
  }

  bindGeometryAttribs(geo) {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.vbo);
    const stride = 12 * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, stride, 24);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 32);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.ibo);
  }

  /** data: { vertices: Float32Array intercalado (pos3, nrm3, uv2, col4), indices: Uint32Array } */
  geometry(data) {
    const gl = this.gl;
    const geo = { count: data.indices.length };
    geo.vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, geo.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, data.vertices, gl.STATIC_DRAW);
    geo.ibo = gl.createBuffer();
    geo.vao = gl.createVertexArray();
    gl.bindVertexArray(geo.vao);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, geo.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data.indices, gl.STATIC_DRAW);
    this.bindGeometryAttribs(geo);
    gl.bindVertexArray(null);
    this.track.bufs.push(geo.vbo, geo.ibo);
    this.track.vaos.push(geo.vao);
    return geo;
  }

  batch(geo, capacity, dynamic = true) {
    return new Batch(this, geo, capacity, dynamic);
  }

  texture(src, o = {}) {
    const gl = this.gl;
    const t = gl.createTexture();
    const tex = { t, mip: o.mip !== false, w: src.width, h: src.height };
    this.track.texs.push(t);
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const wrap = o.repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, o.nearest ? gl.NEAREST : gl.LINEAR);
    if (tex.mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (this.aniso && o.aniso !== 0) gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(o.aniso || 8, this.maxAniso));
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return tex;
  }

  /** Libera todos los recursos de la escena anterior antes de montar otra. */
  releaseAll() {
    const gl = this.gl, k = this.track;
    gl.bindVertexArray(null);
    for (const t of k.texs) gl.deleteTexture(t);
    for (const b of k.bufs) gl.deleteBuffer(b);
    for (const v of k.vaos) gl.deleteVertexArray(v);
    k.texs.length = 0; k.bufs.length = 0; k.vaos.length = 0;
  }

  updateTexture(tex, src) {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, tex.t);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (tex.mip) gl.generateMipmap(gl.TEXTURE_2D);
  }

  drawItem(it, u, depthOnly) {
    const gl = this.gl;
    if (it.batch) {
      const b = it.batch;
      if (!b.count) return;
      b.upload();
      gl.bindVertexArray(b.vao);
      gl.drawElementsInstanced(gl.TRIANGLES, it.geo.count, gl.UNSIGNED_INT, 0, b.count);
      this.stats.instances += b.count;
    } else {
      gl.bindVertexArray(it.geo.vao);
      gl.drawElements(gl.TRIANGLES, it.geo.count, gl.UNSIGNED_INT, 0);
    }
    this.stats.draws++;
  }

  /**
   * env: { sun:[x,y,z], sunCol, sky, ground, fog, fogD, top, horizon, glow, night,
   *        lamps:[[x,y,z]x4], lampCol, shadowFocus:[x,z], shadowRange, excite:[home, away] }
   */
  render(scene, cam, env, time) {
    const gl = this.gl;
    this.stats.draws = 0;
    this.stats.instances = 0;
    const items = scene.items;

    // --- Pase de sombras ---
    const shadows = !!this.shadowSize && env.shadows !== false;
    if (shadows) {
      const R = env.shadowRange || 45;
      const fx = env.shadowFocus ? env.shadowFocus[0] : 0, fz = env.shadowFocus ? env.shadowFocus[1] : 0;
      const s = env.sun;
      M.lookAt(this.tmpA, fx + s[0] * 120, s[1] * 120, fz + s[2] * 120, fx, 0, fz);
      M.ortho(this.tmpB, -R, R, -R, R, 20, 260);
      M.multiply(this.lightVP, this.tmpB, this.tmpA);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
      gl.viewport(0, 0, this.shadowSize, this.shadowSize);
      gl.clearDepth(1);
      gl.depthMask(true);
      gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.useProgram(this.depth.p);
      gl.uniformMatrix4fv(this.depth.u.uVP, false, this.lightVP);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(2, 4);
      gl.disable(gl.BLEND);
      gl.disable(gl.CULL_FACE);
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.visible && it.castShadow) this.drawItem(it, null, true);
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // --- Pase principal ---
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    // Cielo
    gl.useProgram(this.sky.p);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(this.sky.u.uInv, false, cam.inv);
    gl.uniform3fv(this.sky.u.uTop, env.top);
    gl.uniform3fv(this.sky.u.uHorizon, env.horizon);
    gl.uniform3fv(this.sky.u.uSun, env.sun);
    gl.uniform3fv(this.sky.u.uGlow, env.glow);
    gl.uniform1f(this.sky.u.uNight, env.night ? 1 : 0);
    gl.bindVertexArray(this.skyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);

    const P = this.main, u = P.u;
    gl.useProgram(P.p);
    gl.uniformMatrix4fv(u.uVP, false, cam.vp);
    gl.uniformMatrix4fv(u.uLightVP, false, this.lightVP);
    gl.uniform1f(u.uTime, time);
    gl.uniform3fv(u.uSun, env.sun);
    gl.uniform3fv(u.uSunCol, env.sunCol);
    gl.uniform3fv(u.uSky, env.sky);
    gl.uniform3fv(u.uGround, env.ground);
    gl.uniform3fv(u.uFog, env.fog);
    gl.uniform1f(u.uFogD, env.fogD);
    gl.uniform3fv(u.uCam, cam.pos);
    gl.uniform2fv(u.uExcite, env.excite || [0, 0]);
    gl.uniform1f(u.uShadowOn, shadows ? 1 : 0);
    gl.uniform3fv(u.uLamp, env.lampFlat);
    gl.uniform3fv(u.uLampCol, env.lampCol);
    gl.uniform1i(u.uMap, 0);
    gl.uniform1i(u.uShadow, 1);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, shadows ? this.shadowTex : null);
    gl.activeTexture(gl.TEXTURE0);

    for (let pass = 0; pass < 2; pass++) {
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it.visible) continue;
        const m = it.mat;
        const transparent = !!m.blend;
        if ((pass === 1) !== transparent) continue;
        gl.bindTexture(gl.TEXTURE_2D, m.map ? m.map.t : this.white.t);
        gl.uniform4f(u.uFlags, m.map ? 1 : 0, m.unlit ? 1 : 0, m.alphaTest ? 1 : 0, m.noShadow ? 0 : 1);
        gl.uniform1f(u.uEmissive, m.emissive || 0);
        gl.uniform1f(u.uSpec, m.spec || 0);
        gl.uniform1f(u.uAlpha, m.alpha === undefined ? 1 : m.alpha);
        gl.uniform1f(u.uCrowd, m.crowd ? 1 : 0);
        if (m.doubleSided) gl.disable(gl.CULL_FACE); else { gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK); }
        if (transparent) {
          gl.enable(gl.BLEND);
          if (m.blend === 'add') gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
          else gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
          gl.depthMask(false);
        } else {
          gl.disable(gl.BLEND);
          gl.depthMask(true);
        }
        if (m.offset) { gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(-2, -4); }
        if (m.noDepth) gl.disable(gl.DEPTH_TEST);
        this.drawItem(it, u, false);
        if (m.offset) gl.disable(gl.POLYGON_OFFSET_FILL);
        if (m.noDepth) gl.enable(gl.DEPTH_TEST);
      }
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);
    gl.bindVertexArray(null);
  }
}
