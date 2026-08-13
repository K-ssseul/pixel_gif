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

console.log(`\n=== ${pass} passed, ${fail} failed ===`);
process.exit(fail ? 1 : 0);
