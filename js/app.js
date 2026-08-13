/* 像素风 GIF 生成器 v2 —— 纯前端实现，源文件本地处理不上传
 * 依赖：js/lib/omggif.js (GifWriter/GifReader) 与 js/lib/pixel-ops.js (PixelOps)
 */
(function () {
  "use strict";

  const MAX_FILE = 10 * 1024 * 1024; // 10MB
  const MAX_DIM = 500;               // 输出分辨率上限
  const O = PixelOps;                // 纯算法模块（全局）

  const state = {
    rawSource: null,           // 原始 ImageData
    sourceImageData: null,     // 抠图后的 ImageData
    sourceIsSequence: false,
    gifFrames: [],
    sourceW: 0, sourceH: 0,
    frames: [],                // [{ id, data:ImageData(像素化), w, h, selected, group }]
    groups: [{ id: 0, name: "分组 1", color: "#ff5c8a" }],
    activeGroup: 0,
    step: 1,
    resultUrl: null,
    resultGroup: 0,
  };
  let frameSeq = 1;
  const groupColors = ["#ff5c8a", "#5cc8ff", "#9b7bff", "#ffb35c", "#5cff9b", "#ff5c5c", "#c8ff5c", "#5c9bff"];

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const int = (v) => parseInt(v, 10) || 0;

  let toastTimer = null;
  function toast(msg, type) {
    const t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.className = "toast" + (type === "error" ? " error" : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.add("hidden"), 2600);
  }

  // 取某分组的帧
  const groupFrames = (gid) => state.frames.filter((f) => f.group === gid);

  // ---------- 多帧 GIF 解码 ----------
  function decodeGif(arrayBuffer) {
    const reader = new GifReader(new Uint8Array(arrayBuffer));
    const W = reader.width, H = reader.height;
    const n = reader.numFrames();
    const full = new Uint8ClampedArray(W * H * 4);
    const out = [];
    let prevDisposal = 0, prevRect = null;
    for (let f = 0; f < n; f++) {
      const info = reader.frameInfo(f);
      if (prevRect && prevDisposal === 2) {
        for (let y = prevRect.top; y < prevRect.top + prevRect.height; y++)
          for (let x = prevRect.left; x < prevRect.left + prevRect.width; x++) {
            const i = (y * W + x) * 4; full[i] = full[i + 1] = full[i + 2] = full[i + 3] = 0;
          }
      }
      const rgba = new Uint8ClampedArray(W * H * 4);
      reader.decodeAndBlitFrameRGBA(f, rgba);
      for (let i = 0; i < W * H; i++) {
        if (rgba[i * 4 + 3] === 255) {
          const j = i * 4; full[j] = rgba[j]; full[j + 1] = rgba[j + 1]; full[j + 2] = rgba[j + 2]; full[j + 3] = 255;
        }
      }
      out.push({ data: new Uint8ClampedArray(full), w: W, h: H });
      prevDisposal = info.disposal;
      prevRect = { left: info.x, top: info.y, width: info.width, height: info.height };
    }
    return out;
  }

  function hasTransparency(img) {
    const d = img.data;
    for (let i = 3; i < d.length; i += 4) if (d[i] < 128) return true;
    return false;
  }

  // ---------- 步骤导航 ----------
  function goStep(step) {
    state.step = step;
    for (let i = 1; i <= 3; i++) {
      const p = $("panel-" + i); if (p) p.classList.toggle("hidden", i !== step);
      const btn = document.querySelector('.step[data-step="' + i + '"]');
      if (btn) { btn.classList.toggle("active", i === step); btn.classList.toggle("done", i < step); btn.disabled = i > step; }
    }
  }

  // ---------- 上传处理 ----------
  function handleFile(file) {
    if (!file) return;
    const okType = /image\/(jpeg|png|gif)/.test(file.type);
    if (!okType) { toast("仅支持 JPG / PNG / GIF 格式", "error"); return; }
    if (file.size > MAX_FILE) { toast("文件超过 10MB 限制", "error"); return; }

    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result;
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement("canvas");
        cv.width = img.naturalWidth; cv.height = img.naturalHeight;
        const ctx = cv.getContext("2d");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, cv.width, cv.height);

        state.rawSource = data;
        state.sourceW = cv.width; state.sourceH = cv.height;
        state.sourceIsSequence = false; state.gifFrames = [];

        // 自动抠图：仅对“无透明”的图执行（避免伤害已透明精灵）
        if (file.type !== "image/gif" && $("autoBg") && $("autoBg").checked && !hasTransparency(data)) {
          const tol = clamp(int($("bgTolerance").value), 1, 255);
          state.sourceImageData = O.removeBackground(data, tol);
          toast("已自动抠除背景（透明化）");
        } else {
          state.sourceImageData = data;
        }

        const sc = $("sourceCanvas");
        if (sc) { sc.width = cv.width; sc.height = cv.height; sc.getContext("2d").putImageData(state.sourceImageData, 0, 0); }
        const sm = $("sourceMeta"); if (sm) sm.textContent = `${cv.width}×${cv.height} ｜ ${(file.size / 1024).toFixed(1)}KB ｜ ${file.type}`;
        const sp = $("sourcePreview"); if (sp) sp.classList.remove("hidden");

        if (file.type === "image/gif") {
          try {
            const frames = decodeGif(buf);
            if (frames.length > 1) {
              state.sourceIsSequence = true; state.gifFrames = frames;
              state.sourceW = frames[0].w; state.sourceH = frames[0].h;
              const sm2 = $("sliceMode"); if (sm2) sm2.disabled = true;
              const gp = $("gridParams"); if (gp) gp.classList.add("hidden");
              const tp = $("transparentParams"); if (tp) tp.classList.add("hidden");
              const ap = $("autoParams"); if (ap) ap.classList.add("hidden");
              toast(`已识别为 ${frames.length} 帧序列 GIF，直接作为帧序列`);
            } else { const sm2 = $("sliceMode"); if (sm2) sm2.disabled = false; toast("单帧 GIF，按精灵表处理"); }
          } catch (e) { const sm2 = $("sliceMode"); if (sm2) sm2.disabled = false; toast("GIF 解码失败，按单图处理", "error"); }
        } else { const sm2 = $("sliceMode"); if (sm2) sm2.disabled = false; }

        goStep(2);
        resetFrames();
      };
      img.onerror = () => toast("图片解析失败", "error");
      img.src = URL.createObjectURL(file);
    };
    reader.readAsArrayBuffer(file);
  }

  // 重置帧列表（重新切图时）
  function resetFrames() {
    state.groups = [{ id: 0, name: "分组 1", color: groupColors[0] }];
    state.activeGroup = 0;
    state.frames = [];
    renderGroups();
  }

  // ---------- 切图 + 像素化 ----------
  function applySlice() {
    if (!state.sourceImageData) { toast("请先上传图片", "error"); return; }
    const block = clamp(int($("pixelSize").value), 1, 64);
    let cells;
    if (state.sourceIsSequence) {
      cells = state.gifFrames.map((f) => O.Img(f.w, f.h, new Uint8ClampedArray(f.data)));
    } else {
      const mode = $("sliceMode") ? $("sliceMode").value : "auto";
      if (mode === "grid") cells = O.sliceGrid(state.sourceImageData, int($("cols").value), int($("rows").value));
      else if (mode === "transparent") cells = O.sliceTransparent(state.sourceImageData, clamp(int($("tolerance").value), 0, 255));
      else cells = O.autoDetectGrid(state.sourceImageData, 1);
    }
    const gid = state.activeGroup;
    state.frames = cells.map((cell) => ({
      id: frameSeq++, data: O.pixelate(cell, block), w: cell.width, h: cell.height, selected: true, group: gid,
    }));
    renderFrames();
    // 尺寸对齐
    const info = O.analyzeSizes(state.frames);
    if (!info.uniform) {
      const ref = applyAlignment(info.refIndex); // 默认以最大帧为基准
      openAlignModal(ref);
    } else {
      setDefaultDims(info.refIndex);
    }
    toast(`已生成 ${state.frames.length} 帧`);
  }

  // 以 refIndex 为基准对齐所有帧（缩放/居中留边）
  function applyAlignment(refIndex) {
    const ref = state.frames[refIndex];
    if (!ref) return refIndex;
    state.frames = state.frames.map((f) =>
      (f.width === ref.width && f.height === ref.height) ? f : Object.assign({}, f, { data: O.fitFrameTo(f.data, ref.width, ref.height), w: ref.width, h: ref.height }));
    renderFrames();
    setDefaultDims(refIndex);
    return refIndex;
  }

  // 输出尺寸默认 = 基准帧尺寸（与切图大小一致）
  function setDefaultDims(refIndex) {
    const ref = state.frames[refIndex] || state.frames[0];
    if (!ref) return;
    const ow = $("outW"), oh = $("outH");
    if (ow) ow.value = String(clamp(ref.w, 8, MAX_DIM));
    if (oh) oh.value = String(clamp(ref.h, 8, MAX_DIM));
  }

  // ---------- 对齐弹窗 ----------
  function openAlignModal(refIndex) {
    const modal = $("alignModal"); if (!modal) return;
    const list = $("alignList"); if (list) {
      list.innerHTML = "";
      state.frames.forEach((f, i) => {
        const row = document.createElement("label");
        row.className = "align-row";
        const radio = document.createElement("input");
        radio.type = "radio"; radio.name = "alignRef"; radio.value = String(i);
        if (i === refIndex) radio.checked = true;
        const span = document.createElement("span");
        span.textContent = `帧 ${i + 1}（${f.w}×${f.h}）`;
        row.appendChild(radio); row.appendChild(span);
        list.appendChild(row);
      });
    }
    const note = $("alignNote");
    if (note) note.textContent = `已默认以最大帧（帧 ${refIndex + 1}，${state.frames[refIndex].w}×${state.frames[refIndex].h}）为基准，其余帧将缩放/居中留边对齐。`;
    modal.classList.remove("hidden");
  }
  function closeAlignModal() { const m = $("alignModal"); if (m) m.classList.add("hidden"); }
  function confirmAlign() {
    const sel = document.querySelector('input[name="alignRef"]:checked');
    if (sel) applyAlignment(int(sel.value));
    closeAlignModal();
  }

  // ---------- 帧列表渲染（含分组）----------
  function renderFrames() {
    const grid = $("framesGrid"); if (!grid) return;
    grid.innerHTML = "";
    state.frames.forEach((f, idx) => {
      const card = document.createElement("div");
      card.className = "frame-card" + (f.selected ? " selected" : "");
      card.style.borderColor = f.selected ? groupColor(f.group) : "";
      const cv = document.createElement("canvas");
      cv.width = f.w; cv.height = f.h;
      cv.getContext("2d").putImageData(f.data, 0, 0);
      const check = document.createElement("div");
      check.className = "check"; check.textContent = f.selected ? "✓" : "";
      const label = document.createElement("div");
      label.className = "idx"; label.textContent = "帧 " + (idx + 1);
      // 分组下拉
      const gsel = document.createElement("select");
      gsel.className = "frame-group";
      state.groups.forEach((g) => {
        const opt = document.createElement("option"); opt.value = String(g.id); opt.textContent = g.name;
        if (g.id === f.group) opt.selected = true; gsel.appendChild(opt);
      });
      gsel.addEventListener("change", () => { f.group = int(gsel.value); if (f.group === state.activeGroup) card.classList.add("in-active"); else card.classList.remove("in-active"); });
      card.appendChild(cv); card.appendChild(check); card.appendChild(label); card.appendChild(gsel);
      card.onclick = (e) => {
        if (e.target === gsel) return;
        f.selected = !f.selected;
        card.classList.toggle("selected", f.selected);
        card.style.borderColor = f.selected ? groupColor(f.group) : "";
        check.textContent = f.selected ? "✓" : "";
        updateFrameCount();
      };
      if (f.group !== state.activeGroup) card.classList.add("in-active");
      grid.appendChild(card);
    });
    updateFrameCount();
  }
  const groupColor = (gid) => { const g = state.groups.find((x) => x.id === gid); return g ? g.color : "#888"; };
  function updateFrameCount() {
    const sel = state.frames.filter((f) => f.selected && f.group === state.activeGroup).length;
    const tot = groupFrames(state.activeGroup).length;
    const fc = $("frameCount"); if (fc) fc.textContent = `当前分组：${groupName(state.activeGroup)} ｜ 共 ${tot} 帧，已选 ${sel} 帧`;
  }
  const groupName = (gid) => { const g = state.groups.find((x) => x.id === gid); return g ? g.name : "?"; };

  // ---------- 分组管理 ----------
  function renderGroups() {
    const bar = $("groupBar"); if (!bar) return;
    bar.innerHTML = "";
    state.groups.forEach((g) => {
      const chip = document.createElement("button");
      chip.className = "group-chip" + (g.id === state.activeGroup ? " active" : "");
      chip.style.background = g.color;
      chip.textContent = g.name;
      chip.onclick = () => { state.activeGroup = g.id; renderGroups(); renderFrames(); updateFrameCount(); onActiveGroupChange(); };
      bar.appendChild(chip);
    });
    const add = document.createElement("button");
    add.className = "group-chip add"; add.textContent = "＋ 新建分组";
    add.onclick = addGroup;
    bar.appendChild(add);
    const gsel = $("groupSelect");
    if (gsel) { gsel.innerHTML = ""; state.groups.forEach((g) => { const o = document.createElement("option"); o.value = String(g.id); o.textContent = g.name; if (g.id === state.activeGroup) o.selected = true; gsel.appendChild(o); }); }
  }
  function addGroup() {
    const id = state.groups.length ? Math.max(...state.groups.map((g) => g.id)) + 1 : 1;
    const name = "分组 " + (state.groups.length + 1);
    const color = groupColors[state.groups.length % groupColors.length];
    state.groups.push({ id, name, color });
    state.activeGroup = id;
    renderGroups(); renderFrames(); updateFrameCount(); onActiveGroupChange();
    toast(`已新建 ${name}`);
  }
  function deleteGroup() {
    if (state.groups.length <= 1) { toast("至少保留一个分组", "error"); return; }
    const gid = state.activeGroup;
    state.frames = state.frames.filter((f) => f.group !== gid);
    state.groups = state.groups.filter((g) => g.id !== gid);
    state.activeGroup = state.groups[0].id;
    renderGroups(); renderFrames(); updateFrameCount(); onActiveGroupChange();
  }
  // 切换到某分组时：同步输出尺寸为该组基准、刷新预览
  function onActiveGroupChange() {
    const fs = groupFrames(state.activeGroup);
    if (fs.length) { const info = O.analyzeSizes(fs); setDefaultDims(info.refIndex); }
    if (state.step === 3) { generateGif(); startLivePreview(); }
  }

  // ---------- 智能补帧（作用于当前分组已选帧）----------
  // 异步：逐张生成中间帧并让出事件循环，避免大帧数/光流时卡死页面。
  let interpToken = 0;
  async function applyInterp() {
    const src = groupFrames(state.activeGroup).filter((f) => f.selected).map((f) => f.data);
    if (src.length < 2) { toast("当前分组至少需要 2 帧才能补帧", "error"); return; }
    const method = $("interpMethod") ? $("interpMethod").value : "linear";
    const mode = $("interpMode") ? $("interpMode").value : "mult";
    const mult = int($("interpMult").value);
    const target = int($("interpTarget").value);
    const token = ++interpToken;
    const gen = O.interpolateFramesLazy(src, { method, mode, mult, target });
    const out = [];
    const yieldEvery = method === "linear" ? 64 : 12; // 光流/AI 更重，更频繁让出
    showProgress("补帧中", 0);
    let count = 0, base = src.length;
    for (const d of gen) {
      if (token !== interpToken) { showProgress(null, 0); return; } // 被新的补帧取消
      out.push(d);
      count++;
      // 进度无法预知总数（target 已知），用已生成/估算总数显示
      const est = mode === "target" ? clamp(target, base + 1, 600) : base + (base - 1) * (mult - 1);
      if (count % yieldEvery === 0) {
        showProgress("补帧中", est ? count / est : 0);
        await new Promise((r) => setTimeout(r, 0)); // 让出主线程，保持可响应
      }
    }
    // 用插值结果替换当前分组（保留分组归属，全部选中）
    const gid = state.activeGroup;
    state.frames = state.frames.filter((f) => f.group !== gid);
    out.forEach((d) => state.frames.push({ id: frameSeq++, data: d, w: d.width, h: d.height, selected: true, group: gid }));
    const info = O.analyzeSizes(groupFrames(gid));
    if (!info.uniform) applyAlignment(info.refIndex);
    renderFrames(); updateFrameCount();
    showProgress(null, 0);
    toast(`补帧完成：当前分组 ${src.length} → ${out.length} 帧（${methodLabel(method)}）`);
  }
  const methodLabel = (m) => ({ linear: "线性混合", optical: "传统光流", ai: "AI 补帧(RIFE 近似)" }[m] || m);

  // ---------- GIF 生成引擎（针对当前分组）----------
  // 异步：逐帧编码并在时间预算内让出主线程，更新进度条；用 token 取消过期生成。
  // 重影修复：使用全局调色板 + dispose:2（透明区域还原为背景/透明），避免前后帧叠加。
  let genToken = 0;
  async function generateGif() {
    const outW = clamp(int($("outW").value), 8, MAX_DIM);
    const outH = clamp(int($("outH").value), 8, MAX_DIM);
    const frameDelayMs = clamp(int($("frameDelay").value), 20, 2000);
    const delayCs = Math.max(2, Math.round(frameDelayMs / 10)); // omggif 单位为 1/100 秒
    const quality = int($("quality").value);
    const gid = int(($("groupSelect") && $("groupSelect").value) || state.activeGroup);
    state.activeGroup = gid;
    const groupFs = groupFrames(gid);
    const selected = groupFs.filter((f) => f.selected);
    if (!selected.length) { toast("请至少选择一帧", "error"); return; }

    const token = ++genToken; // 取消上一次未完成的生成（实时预览/切分组触发）
    showProgress("生成中", 0);

    // 确保同尺寸
    const info = O.analyzeSizes(selected);
    let framesData = selected.map((f) => f.data);
    if (!info.uniform) framesData = O.alignToReference(framesData, info.refIndex);

    const tc = document.createElement("canvas"); tc.width = outW; tc.height = outH;
    const tctx = tc.getContext("2d"); tctx.imageSmoothingEnabled = false;
    const total = framesData.length;

    // 第一遍：把每帧缩放到输出尺寸，并采集不透明像素用于全局调色板，同时判定是否含透明
    const scaled = [];
    const samples = [];
    let hasTrans = false;
    const sampleStride = Math.max(1, Math.floor((outW * outH * total) / 30000));
    let scnt = 0;
    for (const f of framesData) {
      const sc = document.createElement("canvas"); sc.width = f.width; sc.height = f.height;
      sc.getContext("2d").putImageData(f, 0, 0);
      tctx.clearRect(0, 0, outW, outH);
      tctx.drawImage(sc, 0, 0, outW, outH);
      const od = tctx.getImageData(0, 0, outW, outH).data;
      scaled.push(od);
      for (let i = 0; i < od.length; i += 4) {
        if (od[i + 3] < 128) { hasTrans = true; continue; }
        if ((scnt++ % sampleStride) === 0) samples.push([od[i], od[i + 1], od[i + 2]]);
      }
    }

    // 构建全局调色板
    const gp = O.buildGlobalPalette(samples, quality, hasTrans);

    const mkBuf = () => new Uint8Array(outW * outH * 3 * total + 8192);
    let buf = mkBuf(), gif, len;
    const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

    const encodeAll = async () => {
      gif = new GifWriter(buf, outW, outH, hasTrans
        ? { loop: 0, palette: gp.palArr, background: gp.transIndex }
        : { loop: 0, palette: gp.palArr });
      let done = 0;
      const BUDGET = 24; // ms：每帧后累计超过该预算就让出，防止页面无响应
      let t0 = now();
      for (let k = 0; k < scaled.length; k++) {
        if (token !== genToken) { showProgress(null, 0); return false; } // 过期，丢弃
        const indices = O.mapFrameToPalette(scaled[k], outW, outH, gp.paletteRGB, gp.nColors, gp.transIndex, hasTrans);
        gif.addFrame(0, 0, outW, outH, indices, {
          delay: delayCs,
          transparent: hasTrans ? gp.transIndex : undefined,
          disposal: hasTrans ? 2 : 1, // 透明帧：还原背景，消除重影（omggif 选项名为 disposal）
        });
        done++;
        if (now() - t0 >= BUDGET) {
          showProgress("生成中", done / total);
          await new Promise((r) => setTimeout(r, 0)); // 让出主线程
          t0 = now();
        }
      }
      len = gif.end();
      return true;
    };

    try {
      const ok = await encodeAll();
      if (!ok) return;
    } catch (e) {
      if (String(e).includes("buffer") || String(e).includes("range")) {
        buf = new Uint8Array(outW * outH * 6 * total + 16384);
        const ok = await encodeAll();
        if (!ok) return;
      } else throw e;
    }

    if (token !== genToken) { showProgress(null, 0); return; } // 编码后再次检查

    const blob = new Blob([buf.subarray(0, len)], { type: "image/gif" });
    if (state.resultUrl) URL.revokeObjectURL(state.resultUrl);
    state.resultUrl = URL.createObjectURL(blob);
    state.resultGroup = gid;
    const rp = $("resultPreview"); if (rp) { rp.src = state.resultUrl; fitPreview(outW, outH); }
    const db = $("downloadBtn"); if (db) { db.href = state.resultUrl; db.classList.remove("hidden"); db.download = `pixel-${groupName(gid)}.gif`; }
    const gs = $("genStatus"); if (gs) gs.textContent =
      `已生成 ｜ ${selected.length} 帧 ｜ ${outW}×${outH} ｜ 帧间隔 ${frameDelayMs}ms（≈${Math.round(1000 / frameDelayMs)}fps）｜ 画质 ${quality} 色 ｜ ${(blob.size / 1024).toFixed(1)}KB`;
    showProgress(null, 0);
  }

  // 预览窗口自适应 GIF 实际尺寸（像素级清晰，上限封顶）
  function fitPreview(w, h) {
    const disp = Math.max(1, Math.min(480 / w, 480 / h));
    const rp = $("resultPreview");
    if (rp) { rp.style.width = (w * disp) + "px"; rp.style.height = (h * disp) + "px"; }
  }

  // ---------- 实时预览播放器（不重新编码，直接按帧间隔循环播放选中帧）----------
  let liveTimer = null, liveIdx = 0, liveFrames = [], liveCanvas = null, liveCtx = null;
  const getFrameDelayMs = () => clamp(int($("frameDelay").value), 20, 2000);
  function ensureLiveCanvas() {
    if (!liveCanvas) { liveCanvas = $("livePreview"); liveCtx = liveCanvas ? liveCanvas.getContext("2d") : null; }
  }
  function reportLivePos() {
    const pos = $("liveFramePos"), tot = $("liveFrameTotal");
    if (pos) pos.textContent = liveFrames.length ? String(liveIdx + 1) : "0";
    if (tot) tot.textContent = String(liveFrames.length);
  }
  function drawLiveFrame() {
    if (!liveCtx || !liveFrames.length) { reportLivePos(); return; }
    const f = liveFrames[liveIdx];
    const sc = document.createElement("canvas"); sc.width = f.width; sc.height = f.height;
    sc.getContext("2d").putImageData(f, 0, 0);
    liveCtx.imageSmoothingEnabled = false;
    liveCtx.clearRect(0, 0, liveCanvas.width, liveCanvas.height);
    liveCtx.drawImage(sc, 0, 0, liveCanvas.width, liveCanvas.height); // 拉伸到输出尺寸，与导出一致
    reportLivePos();
    liveTimer = setTimeout(liveTick, getFrameDelayMs()); // 下一帧：读取当前帧间隔
  }
  function liveTick() {
    if (!liveFrames.length) { liveTimer = null; return; }
    liveIdx = (liveIdx + 1) % liveFrames.length;
    drawLiveFrame();
  }
  function stopLivePreview() { if (liveTimer) { clearTimeout(liveTimer); liveTimer = null; } }
  // 重新采集选中帧并（从首帧）开始播放；改尺寸/分组/帧选择时调用
  function startLivePreview() {
    ensureLiveCanvas();
    if (!liveCanvas) return;
    updateFrameDelayLabel();
    stopLivePreview();
    liveFrames = groupFrames(state.activeGroup).filter((f) => f.selected);
    const outW = clamp(int($("outW").value), 8, MAX_DIM);
    const outH = clamp(int($("outH").value), 8, MAX_DIM);
    liveCanvas.width = outW; liveCanvas.height = outH;
    const disp = Math.max(1, Math.min(480 / outW, 480 / outH));
    liveCanvas.style.width = (outW * disp) + "px";
    liveCanvas.style.height = (outH * disp) + "px";
    liveIdx = 0;
    if (!liveFrames.length) { liveCtx.clearRect(0, 0, outW, outH); reportLivePos(); return; }
    drawLiveFrame();
  }
  // 仅更新帧间隔显示（不重置播放），拖动滑块即时反映节奏
  function updateFrameDelayLabel() {
    const ms = getFrameDelayMs();
    const v = $("frameDelayVal"); if (v) v.textContent = String(ms);
    const fps = $("frameDelayFps"); if (fps) fps.textContent = `（≈${Math.round(1000 / ms)} fps）`;
  }

  // 进度条（null 表示隐藏）
  function showProgress(label, ratio) {
    const wrap = $("progress"), bar = $("progressBar"), lab = $("progressLabel");
    if (!wrap) return;
    if (label == null) { wrap.classList.add("hidden"); return; }
    wrap.classList.remove("hidden");
    if (bar) bar.style.width = Math.max(0, Math.min(100, Math.round(ratio * 100))) + "%";
    if (lab) lab.textContent = `${label} ｜ ${Math.round(ratio * 100)}%`;
  }

  // 导出所有分组（逐个生成并触发下载）
  async function exportAll() {
    const boxes = document.querySelectorAll(".group-chip");
    let any = false;
    for (const g of state.groups) {
      const fs = groupFrames(g.id).filter((f) => f.selected);
      if (!fs.length) continue;
      any = true;
      state.activeGroup = g.id;
      const sel = $("groupSelect"); if (sel) sel.value = String(g.id);
      const urlPrev = state.resultUrl;
      await generateGif();
      const url = state.resultUrl;
      if (url && url !== urlPrev) {
        const a = document.createElement("a");
        a.href = url; a.download = `pixel-${g.name}.gif`;
        document.body.appendChild(a); a.click(); a.remove();
      }
      await new Promise((r) => setTimeout(r, 0)); // 让出一帧，避免连续下载卡顿
    }
    if (!any) toast("没有可导出的分组", "error");
    else toast("已导出全部分组 GIF");
  }

  // ---------- 事件绑定 ----------
  function bind() {
    const zone = $("uploadZone"), input = $("fileInput");
    if (zone) zone.onclick = () => input && input.click();
    if (input) input.onchange = () => { if (input.files[0]) handleFile(input.files[0]); input.value = ""; };
    const dz = (ev) => { ev.preventDefault(); zone && zone.classList.add("dragover"); };
    const dz2 = (ev) => { ev.preventDefault(); zone && zone.classList.remove("dragover"); };
    if (zone) { ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, dz)); ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, dz2)); }
    if (zone) zone.addEventListener("drop", (e) => { const f = e.dataTransfer.files[0]; if (f) handleFile(f); });
    const rb = $("reuploadBtn"); if (rb) rb.onclick = () => { const sp = $("sourcePreview"); if (sp) sp.classList.add("hidden"); state.frames = []; state.rawSource = null; state.sourceImageData = null; state.gifFrames = []; resetFrames(); goStep(1); };

    const sm = $("sliceMode"); if (sm) sm.onchange = () => {
      const m = sm.value;
      toggleShow("gridParams", m === "grid");
      toggleShow("transparentParams", m === "transparent");
      toggleShow("autoParams", m === "auto");
    };
    const ap = $("applySlice"); if (ap) ap.onclick = applySlice;
    const sa = $("selectAll"); if (sa) sa.onclick = () => { groupFrames(state.activeGroup).forEach((f) => (f.selected = true)); renderFrames(); };
    const sn = $("selectNone"); if (sn) sn.onclick = () => { groupFrames(state.activeGroup).forEach((f) => (f.selected = false)); renderFrames(); };

    // 步骤 2 → 3
    const toStep3 = document.createElement("button");
    toStep3.className = "btn btn-primary"; toStep3.textContent = "下一步：生成 GIF";
    toStep3.onclick = () => {
      const sel = groupFrames(state.activeGroup).filter((f) => f.selected).length;
      if (!sel) { toast("请至少选择一帧", "error"); return; }
      goStep(3); generateGif(); startLivePreview();
    };
    const tb = document.querySelector("#panel-2 .frames-toolbar"); if (tb) tb.appendChild(toStep3);

    // 分组操作
    const ng = $("newGroupBtn"); if (ng) ng.onclick = addGroup;
    const dg = $("delGroupBtn"); if (dg) dg.onclick = deleteGroup;
    const ai = $("applyInterp"); if (ai) ai.onclick = applyInterp;
    const gs = $("groupSelect"); if (gs) gs.onchange = () => { state.activeGroup = int(gs.value); renderFrames(); updateFrameCount(); onActiveGroupChange(); };

    // 步骤 3 实时预览（防抖）：改尺寸/画质 → 重新生成 + 重开实时预览
    let dt = null;
    const debounced = () => { clearTimeout(dt); dt = setTimeout(() => { generateGif(); startLivePreview(); }, 350); };
    ["outW", "outH", "quality"].forEach((id) => {
      const elx = $(id);
      if (!elx) return;
      elx.addEventListener("input", debounced);
      elx.addEventListener("change", () => { generateGif(); startLivePreview(); });
    });
    // 帧间隔：数字框与滑块双向同步，拖动即时改变播放节奏（不重置播放）
    const fdNum = $("frameDelay"), fdRng = $("frameDelayRange");
    const syncDelayFromNum = () => { if (fdNum && fdRng) fdRng.value = fdNum.value; updateFrameDelayLabel(); };
    const syncDelayFromRng = () => { if (fdNum && fdRng) fdNum.value = fdRng.value; updateFrameDelayLabel(); };
    if (fdNum) { fdNum.addEventListener("input", syncDelayFromNum); fdNum.addEventListener("change", syncDelayFromNum); }
    if (fdRng) { fdRng.addEventListener("input", syncDelayFromRng); fdRng.addEventListener("change", syncDelayFromRng); }
    const gb = $("generateBtn"); if (gb) gb.onclick = () => { generateGif(); startLivePreview(); };
    const ea = $("exportAllBtn"); if (ea) ea.onclick = exportAll;

    // 对齐弹窗
    const ac = $("alignCancel"); if (ac) ac.onclick = closeAlignModal;
    const af = $("alignConfirm"); if (af) af.onclick = confirmAlign;

    // 步骤条点击回退
    document.querySelectorAll(".step").forEach((b) =>
      b.addEventListener("click", () => { if (!b.disabled) goStep(int(b.dataset.step)); }));

    renderGroups();
  }
  function toggleShow(id, show) { const e = $(id); if (e) e.classList.toggle("hidden", !show); }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind);
  else bind();
})();
