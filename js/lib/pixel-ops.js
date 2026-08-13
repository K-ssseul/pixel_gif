/* pixel-ops.js —— 纯图像处理与帧算法（UMD：浏览器挂全局 PixelOps，Node 可 require）
 * 所有函数均为纯函数，不依赖 DOM，便于单元测试。
 */
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) module.exports = factory();
  else root.PixelOps = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const int = (v) => parseInt(v, 10) || 0;

  // 兼容 Node：无原生 ImageData 时返回纯对象
  function Img(w, h, data) {
    if (typeof ImageData !== "undefined") {
      if (data) return new ImageData(new Uint8ClampedArray(data), w, h);
      return new ImageData(w, h);
    }
    return { width: w, height: h, data: new Uint8ClampedArray(data || w * h * 4) };
  }

  // ---------- 像素化（块采样平均）----------
  function pixelate(src, block) {
    const w = src.width, h = src.height, d = src.data;
    if (block <= 1) return Img(w, h, new Uint8ClampedArray(d));
    const out = Img(w, h), od = out.data;
    for (let by = 0; by < h; by += block)
      for (let bx = 0; bx < w; bx += block) {
        let r = 0, g = 0, b = 0, a = 0, n = 0;
        const xe = Math.min(bx + block, w), ye = Math.min(by + block, h);
        for (let y = by; y < ye; y++)
          for (let x = bx; x < xe; x++) {
            const i = (y * w + x) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; a += d[i + 3]; n++;
          }
        r /= n; g /= n; b /= n; a /= n;
        for (let y = by; y < ye; y++)
          for (let x = bx; x < xe; x++) {
            const i = (y * w + x) * 4;
            od[i] = r; od[i + 1] = g; od[i + 2] = b; od[i + 3] = a;
          }
      }
    return out;
  }

  // ---------- 均匀网格切图 ----------
  function sliceGrid(src, cols, rows) {
    const w = src.width, h = src.height, d = src.data;
    cols = clamp(cols, 1, 64); rows = clamp(rows, 1, 64);
    const cw = Math.floor(w / cols), ch = Math.floor(h / rows);
    if (cw < 1 || ch < 1) return [Img(w, h, new Uint8ClampedArray(d))];
    const frames = [];
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const cell = Img(cw, ch), cd = cell.data;
        for (let y = 0; y < ch; y++)
          for (let x = 0; x < cw; x++) {
            const si = ((r * ch + y) * w + (c * cw + x)) * 4;
            const di = (y * cw + x) * 4;
            cd[di] = d[si]; cd[di + 1] = d[si + 1]; cd[di + 2] = d[si + 2]; cd[di + 3] = d[si + 3];
          }
        frames.push(cell);
      }
    return frames;
  }

  // ---------- 透明切割（按透明缝隙分块）----------
  function sliceTransparent(src, tol) {
    const w = src.width, h = src.height, d = src.data;
    const colTrans = new Array(w).fill(true);
    const rowTrans = new Array(h).fill(true);
    for (let x = 0; x < w; x++) {
      let op = 0;
      for (let y = 0; y < h; y++) if (d[(y * w + x) * 4 + 3] > tol) op++;
      colTrans[x] = op / h < 0.02;
    }
    for (let y = 0; y < h; y++) {
      let op = 0;
      for (let x = 0; x < w; x++) if (d[(y * w + x) * 4 + 3] > tol) op++;
      rowTrans[y] = op / w < 0.02;
    }
    const segs = (arr, len) => {
      const out = []; let s = null;
      for (let i = 0; i < len; i++) {
        if (!arr[i]) { if (s === null) s = i; }
        else if (s !== null) { out.push([s, i - 1]); s = null; }
      }
      if (s !== null) out.push([s, len - 1]);
      return out;
    };
    const cSegs = segs(colTrans, w), rSegs = segs(rowTrans, h);
    if (!cSegs.length || !rSegs.length) return [Img(w, h, new Uint8ClampedArray(d))];
    const frames = [];
    for (const [y0, y1] of rSegs)
      for (const [x0, x1] of cSegs) {
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        let any = false;
        for (let y = y0; y <= y1 && !any; y++)
          for (let x = x0; x <= x1; x++)
            if (d[(y * w + x) * 4 + 3] > tol) { any = true; break; }
        if (!any) continue;
        const cell = Img(cw, ch), cd = cell.data;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const si = (y * w + x) * 4, di = ((y - y0) * cw + (x - x0)) * 4;
            cd[di] = d[si]; cd[di + 1] = d[si + 1]; cd[di + 2] = d[si + 2]; cd[di + 3] = d[si + 3];
          }
        frames.push(cell);
      }
    return frames.length ? frames : [Img(w, h, new Uint8ClampedArray(d))];
  }

  // ---------- 自动检测网格（透明缝隙）----------
  // 有透明像素 → 按透明列/行缝隙切分为规则网格；无透明 → 整图作为 1 帧
  function autoDetectGrid(src, minSeam) {
    minSeam = minSeam || 1;
    const w = src.width, h = src.height, d = src.data;
    let anyTrans = false;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) { anyTrans = true; break; }
    if (!anyTrans) return [Img(w, h, new Uint8ClampedArray(d))];

    const colHas = new Array(w).fill(false);
    const rowHas = new Array(h).fill(false);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        if (d[(y * w + x) * 4 + 3] >= 128) { colHas[x] = true; rowHas[y] = true; }

    const groupSegs = (has, len) => {
      const out = []; let s = null, run = 0;
      for (let i = 0; i < len; i++) {
        if (has[i]) { if (s === null) s = i; run = 0; }
        else { run++; if (run >= minSeam && s !== null) { out.push([s, i - run]); s = null; } }
      }
      if (s !== null) out.push([s, len - 1]);
      return out;
    };
    const cSegs = groupSegs(colHas, w), rSegs = groupSegs(rowHas, h);
    if (!cSegs.length || !rSegs.length) return [Img(w, h, new Uint8ClampedArray(d))];
    const frames = [];
    for (const [y0, y1] of rSegs)
      for (const [x0, x1] of cSegs) {
        const cw = x1 - x0 + 1, ch = y1 - y0 + 1;
        const cell = Img(cw, ch), cd = cell.data;
        for (let y = y0; y <= y1; y++)
          for (let x = x0; x <= x1; x++) {
            const si = (y * w + x) * 4, di = ((y - y0) * cw + (x - x0)) * 4;
            cd[di] = d[si]; cd[di + 1] = d[si + 1]; cd[di + 2] = d[si + 2]; cd[di + 3] = d[si + 3];
          }
        frames.push(cell);
      }
    return frames.length ? frames : [Img(w, h, new Uint8ClampedArray(d))];
  }

  // ---------- 自动抠图（边缘 flood-fill 去背景 → 透明）----------
  // 假设背景是图片四周的颜色；从四条边 flood-fill，颜色距离 <= tol 的视为背景置透明。
  function removeBackground(src, tol, bgColor) {
    const w = src.width, h = src.height, d = src.data;
    const out = Img(w, h, new Uint8ClampedArray(d));
    const od = out.data;
    // 背景色：默认取四条边像素的众数（简单取四角 + 边采样平均）
    let br = 0, bg = 0, bb = 0, bn = 0;
    const sample = (x, y) => { const i = (y * w + x) * 4; br += d[i]; bg += d[i + 1]; bb += d[i + 2]; bn++; };
    for (let x = 0; x < w; x++) { sample(x, 0); sample(x, h - 1); }
    for (let y = 0; y < h; y++) { sample(0, y); sample(w - 1, y); }
    if (bgColor) { br = bgColor[0]; bg = bgColor[1]; bb = bgColor[2]; }
    else { br = br / bn; bg = bg / bn; bb = bb / bn; }

    const reach = new Uint8Array(w * h);
    const queue = [];
    const idx = (x, y) => y * w + x;
    const pushIf = (x, y) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return;
      const p = idx(x, y);
      if (reach[p]) return;
      const i = p * 4;
      const dr = d[i] - br, dg = d[i + 1] - bg, db = d[i + 2] - bb;
      if (dr * dr + dg * dg + db * db <= tol * tol) { reach[p] = 1; queue.push(p); }
    };
    for (let x = 0; x < w; x++) { pushIf(x, 0); pushIf(x, h - 1); }
    for (let y = 0; y < h; y++) { pushIf(0, y); pushIf(w - 1, y); }
    while (queue.length) {
      const p = queue.pop();
      const x = p % w, y = (p / w) | 0;
      pushIf(x + 1, y); pushIf(x - 1, y); pushIf(x, y + 1); pushIf(x, y - 1);
    }
    for (let p = 0; p < w * h; p++) if (reach[p]) od[p * 4 + 3] = 0;
    return out;
  }

  // ---------- 帧尺寸对齐（缩放/letterbox 到基准尺寸）----------
  function fitFrameTo(src, refW, refH) {
    const w = src.width, h = src.height, d = src.data;
    const out = Img(refW, refH), od = out.data; // 默认全透明
    const scale = Math.min(refW / w, refH / h);
    const dw = Math.max(1, Math.round(w * scale)), dh = Math.max(1, Math.round(h * scale));
    const ox = ((refW - dw) / 2) | 0, oy = ((refH - dh) / 2) | 0;
    for (let y = 0; y < dh; y++)
      for (let x = 0; x < dw; x++) {
        const sx = Math.min(w - 1, (x / scale) | 0), sy = Math.min(h - 1, (y / scale) | 0);
        const si = (sy * w + sx) * 4, di = ((oy + y) * refW + (ox + x)) * 4;
        od[di] = d[si]; od[di + 1] = d[si + 1]; od[di + 2] = d[si + 2]; od[di + 3] = d[si + 3];
      }
    return out;
  }

  // 检测帧尺寸是否一致，返回 { uniform, sizes:Set, refIndex }
  function analyzeSizes(frames) {
    const sizes = new Set();
    let refArea = -1, refIndex = 0;
    frames.forEach((f, i) => {
      sizes.add(f.width + "x" + f.height);
      const area = f.width * f.height;
      if (area > refArea) { refArea = area; refIndex = i; }
    });
    return { uniform: sizes.size === 1, sizes, refIndex };
  }

  // 把 frames 全部对齐到 refIndex 的尺寸
  function alignToReference(frames, refIndex) {
    const ref = frames[refIndex];
    if (!ref) return frames;
    return frames.map((f) => (f.width === ref.width && f.height === ref.height) ? f : fitFrameTo(f, ref.width, ref.height));
  }

  // ---------- 帧间混合（线性，处理透明）----------
  function blendFrames(fa, fb, t) {
    const w = fa.width, h = fa.height, a = fa.data, b = fb.data;
    const out = Img(w, h), od = out.data;
    for (let i = 0; i < w * h; i++) {
      const j = i * 4;
      const aa = a[j + 3], ab = b[j + 3];
      if (aa < 128 && ab < 128) { od[j + 3] = 0; continue; }
      if (aa < 128) { od[j] = b[j]; od[j + 1] = b[j + 1]; od[j + 2] = b[j + 2]; od[j + 3] = 255; continue; }
      if (ab < 128) { od[j] = a[j]; od[j + 1] = a[j + 1]; od[j + 2] = a[j + 2]; od[j + 3] = 255; continue; }
      od[j] = a[j] + (b[j] - a[j]) * t;
      od[j + 1] = a[j + 1] + (b[j + 1] - a[j + 1]) * t;
      od[j + 2] = a[j + 2] + (b[j + 2] - a[j + 2]) * t;
      od[j + 3] = 255;
    }
    return out;
  }

  // ---------- 传统光流补帧（块匹配 warp）----------
  // 在 fa 上分块，向 fb 搜索最佳匹配得到运动向量，按 t 前向/后向 warp 后平均。
  function opticalFlowWarp(fa, fb, t, opt) {
    opt = opt || {};
    const B = opt.block || 8, R = opt.radius || 8;
    const w = fa.width, h = fa.height, a = fa.data, b = fb.data;
    // 计算每块的位移 (dx,dy)
    const vx = new Float32Array((((w + B - 1) / B) | 0) * (((h + B - 1) / B) | 0));
    const vy = new Float32Array(vx.length);
    const cols = ((w + B - 1) / B) | 0, rows = ((h + B - 1) / B) | 0;
    const sad = (bx, by, dx, dy) => {
      let s = 0;
      for (let y = 0; y < B; y++)
        for (let x = 0; x < B; x++) {
          const ax = bx + x, ay = by + y;
          const bx2 = bx + dx + x, by2 = by + dy + y;
          if (ax >= w || ay >= h || bx2 < 0 || by2 < 0 || bx2 >= w || by2 >= h) return 1e9;
          const i1 = (ay * w + ax) * 4, i2 = (by2 * w + bx2) * 4;
          if (a[i1 + 3] < 128 || b[i2 + 3] < 128) return 1e9;
          const dr = a[i1] - b[i2], dg = a[i1 + 1] - b[i2 + 1], db = a[i1 + 2] - b[i2 + 2];
          s += dr * dr + dg * dg + db * db;
        }
      return s;
    };
    let bi = 0;
    for (let by = 0; by < h; by += B)
      for (let bx = 0; bx < w; bx += B) {
        let best = 1e9, bdx = 0, bdy = 0;
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++) {
            const s = sad(bx, by, dx, dy);
            if (s < best) { best = s; bdx = dx; bdy = dy; }
          }
        vx[bi] = bdx; vy[bi] = bdy; bi++;
      }
    // warp + 平均
    const out = Img(w, h), od = out.data;
    const acc = new Float32Array(w * h * 4), cnt = new Float32Array(w * h);
    const warp = (src, wt, sign) => {
      bi = 0;
      for (let by = 0; by < h; by += B)
        for (let bx = 0; bx < w; bx += B) {
          const dx = vx[bi] * sign * wt, dy = vy[bi] * sign * wt;
          for (let y = 0; y < B; y++)
            for (let x = 0; x < B; x++) {
              const ox = (bx + x + dx) | 0, oy = (by + y + dy) | 0;
              if (ox < 0 || oy < 0 || ox >= w || oy >= h) continue;
              const si = (oy * w + ox) * 4, di = (by + y) * w + (bx + x);
              if (src[si + 3] < 128) continue;
              acc[di * 4] += src[si]; acc[di * 4 + 1] += src[si + 1];
              acc[di * 4 + 2] += src[si + 2]; acc[di * 4 + 3] += 255; cnt[di] += 1;
            }
          bi++;
        }
    };
    warp(a, t, 1);
    warp(b, 1 - t, -1);
    for (let i = 0; i < w * h; i++) {
      if (cnt[i] < 0.5) { od[i * 4 + 3] = 0; continue; }
      const c = cnt[i];
      od[i * 4] = acc[i * 4] / c; od[i * 4 + 1] = acc[i * 4 + 1] / c;
      od[i * 4 + 2] = acc[i * 4 + 2] / c; od[i * 4 + 3] = 255;
    }
    return out;
  }

  // ---------- 补帧主函数 ----------
  // opts: { method:'linear'|'optical'|'ai', mode:'mult'|'target', mult, target }
  function interpolateFrames(frames, opts) {
    opts = opts || {};
    const n = frames.length;
    if (n < 2) return frames.slice();
    const method = opts.method || "linear";
    const ref = analyzeSizes(frames).refIndex;
    const aligned = alignToReference(frames, ref); // 补帧需同尺寸
    const between = (fa, fb, t) => {
      if (method === "optical") return opticalFlowWarp(fa, fb, t, { block: 8, radius: 8 });
      if (method === "ai") return opticalFlowWarp(fa, fb, t, { block: 4, radius: 12 });
      return blendFrames(fa, fb, t);
    };
    let out;
    if (opts.mode === "target") {
      const T = clamp(int(opts.target), n + 1, 600);
      out = [];
      for (let p = 0; p < T; p++) {
        const pos = (p * (n - 1)) / (T - 1);
        const li = Math.floor(pos), ri = Math.min(n - 1, li + 1), t = pos - li;
        out.push(t <= 0 ? aligned[li] : between(aligned[li], aligned[ri], t));
      }
    } else {
      const mult = clamp(int(opts.mult), 2, 16);
      const k = mult - 1;
      out = [];
      for (let i = 0; i < n; i++) {
        out.push(aligned[i]);
        if (i < n - 1) for (let j = 1; j <= k; j++) out.push(between(aligned[i], aligned[i + 1], j / (k + 1)));
      }
    }
    return out;
  }

  // ---------- 调色板量化（中位切分）----------
  function boxExtent(p) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c[0] < rmin) rmin = c[0]; if (c[0] > rmax) rmax = c[0];
      if (c[1] < gmin) gmin = c[1]; if (c[1] > gmax) gmax = c[1];
      if (c[2] < bmin) bmin = c[2]; if (c[2] > bmax) bmax = c[2];
    }
    return Math.max(rmax - rmin, gmax - gmin, bmax - bmin);
  }
  function avgColor(p) {
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < p.length; i++) { r += p[i][0]; g += p[i][1]; b += p[i][2]; }
    const n = p.length || 1;
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  }
  function splitBox(p) {
    let rmin = 255, rmax = 0, gmin = 255, gmax = 0, bmin = 255, bmax = 0;
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c[0] < rmin) rmin = c[0]; if (c[0] > rmax) rmax = c[0];
      if (c[1] < gmin) gmin = c[1]; if (c[1] > gmax) gmax = c[1];
      if (c[2] < bmin) bmin = c[2]; if (c[2] > bmax) bmax = c[2];
    }
    const rr = rmax - rmin, gr = gmax - gmin, br = bmax - bmin;
    const ch = (gr >= rr && gr >= br) ? 1 : (br >= rr && br >= gr) ? 2 : 0;
    const sorted = p.slice().sort((a, b) => a[ch] - b[ch]);
    const mid = sorted.length >> 1;
    return [{ pixels: sorted.slice(0, mid) }, { pixels: sorted.slice(mid) }];
  }
  function medianCut(colors, maxColors) {
    if (!colors.length) return [[0, 0, 0]];
    let boxes = [{ pixels: colors }];
    while (boxes.length < maxColors) {
      let bi = 0, best = -1;
      for (let i = 0; i < boxes.length; i++) {
        const e = boxExtent(boxes[i].pixels);
        if (e > best) { best = e; bi = i; }
      }
      if (boxes[bi].pixels.length < 2) break;
      const sp = splitBox(boxes[bi].pixels);
      boxes.splice(bi, 1, sp[0], sp[1]);
    }
    return boxes.map((b) => avgColor(b.pixels));
  }

  // 将 RGBA 量化为索引 + 调色板（含透明处理）。rgba 为 Uint8ClampedArray。
  function quantizeFrame(rgba, w, h, maxColors) {
    const total = w * h;
    const opaque = [];
    let hasTrans = false;
    for (let i = 0; i < total; i++) {
      if (rgba[i * 4 + 3] >= 128) opaque.push([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]]);
      else hasTrans = true;
    }
    let L = clamp(maxColors, 2, 256);
    L = 1 << Math.ceil(Math.log2(L));
    if (L < 2) L = 2; if (L > 256) L = 256;
    const nColors = hasTrans ? L - 1 : L;
    const sampleStride = opaque.length > 20000 ? 2 : 1;
    const sampled = [];
    for (let i = 0; i < opaque.length; i += sampleStride) sampled.push(opaque[i]);
    let palette = medianCut(sampled.length ? sampled : opaque, nColors);
    while (palette.length < nColors) palette.push(palette[palette.length - 1] || [0, 0, 0]);
    let transIndex = -1;
    if (hasTrans) { palette.push([0, 0, 0]); transIndex = palette.length - 1; }
    const palArr = [];
    for (let i = 0; i < palette.length; i++) palArr.push(((palette[i][0] | 0) << 16) | ((palette[i][1] | 0) << 8) | (palette[i][2] | 0));
    const indices = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (hasTrans && rgba[i * 4 + 3] < 128) { indices[i] = transIndex; continue; }
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < nColors; k++) {
        const dr = r - palette[k][0], dg = g - palette[k][1], db = b - palette[k][2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = k; }
      }
      indices[i] = best;
    }
    const o = { palette: palArr };
    if (hasTrans) o.transparent = transIndex;
    return { indices, opts: o };
  }

  // ---------- 补帧：逐帧延迟生成器（避免一次性阻塞主线程）----------
  // 与 interpolateFrames 等价，但用 generator 逐张产出中间帧，调用方可 await/yield。
  function* interpolateFramesLazy(frames, opts) {
    opts = opts || {};
    const n = frames.length;
    if (n < 2) { for (const f of frames) yield f; return; }
    const method = opts.method || "linear";
    const ref = analyzeSizes(frames).refIndex;
    const aligned = alignToReference(frames, ref);
    const between = (fa, fb, t) => {
      if (method === "optical") return opticalFlowWarp(fa, fb, t, { block: 8, radius: 8 });
      if (method === "ai") return opticalFlowWarp(fa, fb, t, { block: 4, radius: 12 });
      return blendFrames(fa, fb, t);
    };
    if (opts.mode === "target") {
      const T = clamp(int(opts.target), n + 1, 600);
      for (let p = 0; p < T; p++) {
        const pos = (p * (n - 1)) / (T - 1);
        const li = Math.floor(pos), ri = Math.min(n - 1, li + 1), t = pos - li;
        yield t <= 0 ? aligned[li] : between(aligned[li], aligned[ri], t);
      }
    } else {
      const mult = clamp(int(opts.mult), 2, 16);
      const k = mult - 1;
      for (let i = 0; i < n; i++) {
        yield aligned[i];
        if (i < n - 1) for (let j = 1; j <= k; j++) yield between(aligned[i], aligned[i + 1], j / (k + 1));
      }
    }
  }

  // ---------- 调色板量化（Promise 化，逐帧分块）----------
  // 把单帧量化做成可 await 的形式，便于在主循环里按时间预算 yield。
  // 这里直接同步计算，但返回 Promise，由调用方用"每帧后让出事件循环"来分摊开销。
  function quantizeFrameAsync(rgba, w, h, maxColors) {
    return Promise.resolve(quantizeFrame(rgba, w, h, maxColors));
  }

  // ---------- 全局调色板（跨所有帧共享，消除帧间色彩抖动 / 重影）----------
  // 返回 { palArr(打包0xRRGGBB), paletteRGB([[r,g,b]...]), transIndex, nColors, L }
  // hasTrans=true 时调色板长度 = L(2 的幂)，其中前 L-1 为颜色、最后 1 个为透明索引。
  function buildGlobalPalette(samples, maxColors, hasTrans) {
    let L = clamp(maxColors, 2, 256);
    L = 1 << Math.ceil(Math.log2(L));
    if (L < 2) L = 2; if (L > 256) L = 256;
    const nColors = hasTrans ? L - 1 : L;
    const sampled = samples && samples.length ? samples : [[0, 0, 0]];
    let palette = medianCut(sampled, nColors);
    while (palette.length < nColors) palette.push(palette[palette.length - 1] || [0, 0, 0]);
    let transIndex = -1;
    if (hasTrans) { palette.push([0, 0, 0]); transIndex = palette.length - 1; }
    const palArr = [];
    for (let i = 0; i < palette.length; i++) palArr.push(((palette[i][0] | 0) << 16) | ((palette[i][1] | 0) << 8) | (palette[i][2] | 0));
    return { palArr, paletteRGB: palette, transIndex, nColors, L };
  }

  // 将单帧 RGBA 映射到全局调色板索引（透明像素 → transIndex）。返回 Uint8Array。
  function mapFrameToPalette(rgba, w, h, paletteRGB, nColors, transIndex, hasTrans) {
    const total = w * h;
    const indices = new Uint8Array(total);
    for (let i = 0; i < total; i++) {
      if (hasTrans && rgba[i * 4 + 3] < 128) { indices[i] = transIndex; continue; }
      const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      let best = 0, bd = Infinity;
      for (let k = 0; k < nColors; k++) {
        const dr = r - paletteRGB[k][0], dg = g - paletteRGB[k][1], db = b - paletteRGB[k][2];
        const dd = dr * dr + dg * dg + db * db;
        if (dd < bd) { bd = dd; best = k; }
      }
      indices[i] = best;
    }
    return indices;
  }

  return {
    clamp, int, Img, pixelate, sliceGrid, sliceTransparent, autoDetectGrid,
    removeBackground, fitFrameTo, analyzeSizes, alignToReference,
    blendFrames, opticalFlowWarp, interpolateFrames, interpolateFramesLazy,
    medianCut, quantizeFrame, quantizeFrameAsync,
    buildGlobalPalette, mapFrameToPalette,
  };
});
