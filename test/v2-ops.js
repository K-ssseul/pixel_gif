// 纯算法单元测试（Node）：验证 pixel-ops 的新增函数
global.ImageData = class {
  constructor(a, b, c) {
    if (a instanceof Uint8ClampedArray) { this.data = a; this.width = b; this.height = c; }
    else { this.width = a; this.height = b; this.data = new Uint8ClampedArray(a * b * 4); }
  }
};
const O = require("../js/lib/pixel-ops.js");
const { GifWriter, GifReader } = require("../js/lib/omggif.js");

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log("[PASS]", name); } else { fail++; console.log("[FAIL]", name); } }

function mk(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, c = fn(x, y);
    d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; d[i + 3] = c[3];
  }
  return O.Img(w, h, d);
}

// 1) medianCut 不再抛错（回归：box 结构一致性）
try {
  const colors = [];
  for (let i = 0; i < 500; i++) colors.push([(i * 7) & 255, (i * 13) & 255, (i * 5) & 255]);
  const pal = O.medianCut(colors, 16);
  ok("medianCut 返回 16 色", pal.length === 16);
} catch (e) { ok("medianCut 不抛错", false); console.error(e); }

// 2) autoDetectGrid：64x64，2x2 网格，缝隙透明
{
  const img = mk(64, 64, (x, y) => {
    const gap = (x % 32 === 0) || (y % 32 === 0); // 缝隙列/行（仅 1px 缝隙）
    if (gap) return [0, 0, 0, 0];
    const c = ((x >> 5) + (y >> 5)) % 2 ? 200 : 80;
    return [c, c, c, 255];
  });
  const cells = O.autoDetectGrid(img, 1);
  ok("autoDetectGrid 识别 4 格", cells.length === 4);
  ok("autoDetectGrid 每格 31x31", cells[0].width === 31 && cells[0].height === 31);
}

// 3) autoDetectGrid：无透明 → 整图 1 帧
{
  const img = mk(64, 64, () => [100, 100, 100, 255]);
  const cells = O.autoDetectGrid(img);
  ok("无透明图 → 1 帧", cells.length === 1);
}

// 4) removeBackground：白边去透明
{
  const img = mk(20, 20, (x, y) => {
    if (x === 0 || y === 0 || x === 19 || y === 19) return [255, 255, 255, 255];
    return [123, 45, 67, 255];
  });
  const out = O.removeBackground(img, 40);
  let borderTransparent = true;
  for (let x = 0; x < 20; x++) if (out.data[(0 * 20 + x) * 4 + 3] !== 0) borderTransparent = false;
  let centerKept = out.data[(10 * 20 + 10) * 4 + 3] === 255;
  ok("removeBackground 白边变透明", borderTransparent);
  ok("removeBackground 中心保留", centerKept);
}

// 5) alignToReference：不同尺寸 → 同尺寸
{
  const f1 = mk(10, 10, () => [10, 10, 10, 255]);
  const f2 = mk(20, 15, () => [20, 20, 20, 255]);
  const f3 = mk(12, 18, () => [30, 30, 30, 255]);
  const a = O.alignToReference([f1, f2, f3], 1);
  const allSame = a.every((f) => f.width === 20 && f.height === 15);
  ok("alignToReference 统一尺寸 20x15", allSame);
  ok("analyzeSizes 非统一", O.analyzeSizes([f1, f2, f3]).uniform === false);
}

// 6) interpolateFrames 线性倍率 2x：2 帧 → 3 帧
{
  const f1 = mk(8, 8, () => [255, 0, 0, 255]);
  const f2 = mk(8, 8, () => [0, 0, 255, 255]);
  const out = O.interpolateFrames([f1, f2], { method: "linear", mode: "mult", mult: 2 });
  ok("线性 2x 得 3 帧", out.length === 3);
  // 中间帧应介于红蓝之间
  const mid = out[1].data;
  ok("中间帧为混合色", mid[0] > 80 && mid[0] < 200 && mid[2] > 80 && mid[2] < 200);
}

// 7) interpolateFrames 光流：2 帧 → 不抛错且尺寸一致
{
  const f1 = mk(16, 16, (x) => [(x * 16) & 255, 0, 0, 255]);
  const f2 = mk(16, 16, (x) => [((x + 4) * 16) & 255, 0, 0, 255]);
  const out = O.interpolateFrames([f1, f2], { method: "optical", mode: "mult", mult: 3 });
  ok("光流 3x 得 4 帧", out.length === 4);
  ok("光流输出同尺寸", out.every((f) => f.width === 16 && f.height === 16));
}

// 8) interpolateFrames 目标帧数
{
  const fs = [mk(8, 8, (x, y) => [x * 30, y * 30, 0, 255]), mk(8, 8, () => [200, 50, 0, 255]), mk(8, 8, () => [0, 200, 50, 255])];
  const out = O.interpolateFrames(fs, { method: "linear", mode: "target", target: 9 });
  ok("目标 9 帧", out.length === 9);
}

// 9) 编码 → 解码 往返：验证生成的 GIF 合法（含透明）
{
  const W = 16, H = 16;
  const fr = [];
  for (let f = 0; f < 3; f++) {
    const d = new Uint8ClampedArray(W * H * 4);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const on = ((x + f) % 4) !== 0; // 部分像素透明
      d[i] = 200; d[i + 1] = 50; d[i + 2] = 80; d[i + 3] = on ? 255 : 0;
    }
    fr.push(O.Img(W, H, d));
  }
  const buf = new Uint8Array(W * H * 3 * fr.length + 8192);
  const gif = new GifWriter(buf, W, H, { loop: 0 });
  for (const f of fr) {
    const { indices, opts } = O.quantizeFrame(f.data, W, H, 64);
    gif.addFrame(0, 0, W, H, indices, Object.assign({ delay: 10 }, opts));
  }
  const len = gif.end();
  const r = new GifReader(buf.subarray(0, len));
  ok("往返：帧数=3", r.numFrames() === 3);
  ok("往返：尺寸 16x16", r.width === 16 && r.height === 16);
  // 校验透明像素：解码第 0 帧第 0 列应仍有透明
  const dec = new Uint8ClampedArray(W * H * 4);
  r.decodeAndBlitFrameRGBA(0, dec);
  let transparentOk = false;
  for (let x = 0; x < W; x++) if (dec[(0 * W + x) * 4 + 3] === 0) { transparentOk = true; break; }
  ok("往返：透明像素保留", transparentOk);
}

// 10) 重影修复：透明孔洞帧在 dispose:2 下不应残留上一帧颜色
{
  const W = 16, H = 16;
  // 帧1：全红不透明
  const f1 = mk(W, H, () => [220, 40, 40, 255]);
  // 帧2：红底 + 中心 4x4 透明孔洞
  const f2 = mk(W, H, (x, y) => ((x >= 6 && x < 10 && y >= 6 && y < 10) ? [0, 0, 0, 0] : [220, 40, 40, 255]));
  const samples = [];
  for (const f of [f1, f2]) {
    const d = f.data;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] >= 128) samples.push([d[i], d[i + 1], d[i + 2]]);
  }
  const gp = O.buildGlobalPalette(samples, 64, true);
  const buf = new Uint8Array(W * H * 3 * 2 + 8192);
  const gif = new GifWriter(buf, W, H, { loop: 0, palette: gp.palArr, background: gp.transIndex });
  for (const f of [f1, f2]) {
    const idx = O.mapFrameToPalette(f.data, W, H, gp.paletteRGB, gp.nColors, gp.transIndex, true);
    gif.addFrame(0, 0, W, H, idx, { delay: 10, transparent: gp.transIndex, disposal: 2 });
  }
  const len = gif.end();
  const r = new GifReader(buf.subarray(0, len));
  ok("重影测试：全局调色板长度=64", gp.palArr.length === 64);
  ok("重影测试：transIndex = 63", gp.transIndex === 63);

  // 解码并按 dispose 合成（与 app.js decodeGif 一致；omggif 需顺序解码并累加进 full）
  const full = new Uint8ClampedArray(W * H * 4);
  let prevDisposal = 0, prevRect = null;
  for (let f = 0; f < r.numFrames(); f++) {
    const info = r.frameInfo(f);
    if (prevRect && prevDisposal === 2) {
      for (let y = prevRect.top; y < prevRect.top + prevRect.height; y++)
        for (let x = prevRect.left; x < prevRect.left + prevRect.width; x++) {
          const i = (y * W + x) * 4; full[i] = full[i + 1] = full[i + 2] = full[i + 3] = 0;
        }
    }
    r.decodeAndBlitFrameRGBA(f, full); // 顺序解码，累加进 full；透明索引像素自动跳过
    prevDisposal = info.disposal; prevRect = { left: info.x, top: info.y, width: info.width, height: info.height };
  }
  const hi = ((8 * W) + 8) * 4; // 孔洞中心
  const holeAlpha = full[hi + 3];
  ok("重影测试：帧2 孔洞解码为透明（无重影）", holeAlpha === 0);
  // 对照：若用 dispose:0（旧逻辑）会残留红色——此处确认透明，即修复生效
  ok("重影测试：孔洞周围仍保留红色", full[(3 * W + 3) * 4 + 3] === 255 && full[(3 * W + 3) * 4] > 180);
}

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
