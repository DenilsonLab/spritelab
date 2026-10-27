"use strict";
const $ = (id) => document.getElementById(id),
  uid = () => crypto.randomUUID(),
  clamp = (v, a, b) => Math.max(a, Math.min(b, v));
let project = {
    version: 2,
    type: "spritelab-studio",
    name: "Una pequeña aventura",
    width: 1920,
    height: 1080,
    fps: 30,
    assets: [],
    scenes: [],
    audio: null,
  },
  sceneId = null,
  layerId = null,
  assetId = null,
  libraryType = "sprite",
  mode = "scene",
  point = "start",
  time = 0,
  playing = false,
  playStarted = 0,
  zoom = 0,
  spriteZoom = 1,
  recording = false,
  cancelRecording = false,
  history = [],
  future = [],
  saveTimer,
  saveRevision = 0,
  savedRevision = 0,
  animationId = null,
  lastPlaybackFrame = 0,
  lastUIFrame = 0,
  lastVideo = null,
  drag = null,
  spriteDrag = null,
  toastTimer,
  miniFrame = 0,
  frameClock = 0,
  audioContext = null,
  playAudio = null;
let audioGeneration = 0;
const backgroundCache = new Map();
const images = new Map(),
  audioBuffers = new Map(),
  stage = $("stage"),
  stageCtx = stage.getContext("2d"),
  mini = $("mini-preview"),
  miniCtx = mini.getContext("2d"),
  spriteCanvas = $("sprite-canvas"),
  spriteCtx = spriteCanvas.getContext("2d");
function toast(message) {
  $("toast").textContent = message;
  $("toast").style.display = "block";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($("toast").style.display = "none"), 4500);
}
function scene() {
  return project.scenes.find((s) => s.id === sceneId);
}
function layer() {
  return scene()?.layers.find((l) => l.id === layerId);
}
function asset(id = assetId) {
  return project.assets.find((a) => a.id === id);
}
function duration() {
  return project.scenes.reduce((n, s) => n + s.duration, 0);
}
function startOf(id) {
  let t = 0;
  for (const s of project.scenes) {
    if (s.id === id) return t;
    t += s.duration;
  }
  return 0;
}
function atTime(t) {
  let start = 0;
  for (let i = 0; i < project.scenes.length; i++) {
    const s = project.scenes[i];
    if (t < start + s.duration || i === project.scenes.length - 1)
      return { s, local: clamp(t - start, 0, s.duration), start };
    start += s.duration;
  }
  return null;
}
function snapshot() {
  return {
    ...project,
    assets: project.assets.map((a) => ({
      ...a,
      xCuts: a.xCuts ? [...a.xCuts] : undefined,
      yCuts: a.yCuts ? [...a.yCuts] : undefined,
      frames: a.frames ? [...a.frames] : undefined,
    })),
    scenes: project.scenes.map((s) => ({
      ...s,
      layers: s.layers.map((l) => ({
        ...l,
        frames: l.frames ? [...l.frames] : undefined,
        xCuts: l.xCuts ? [...l.xCuts] : undefined,
        yCuts: l.yCuts ? [...l.yCuts] : undefined,
      })),
    })),
    audio: project.audio ? { ...project.audio } : null,
  };
}
function checkpoint() {
  history.push(snapshot());
  if (history.length > 20) history.shift();
  future = [];
  updateUndo();
}
function changed() {
  saveRevision++;
  $("save-status").textContent = "Cambios sin guardar · descarga tu proyecto";
  $("save-status").classList.add("unsaved");
  updateUndo();
  render();
  updateSummary();
}
function updateUndo() {
  $("undo").disabled = !history.length || recording;
  $("redo").disabled = !future.length || recording;
}
function restoreSnapshot(p) {
  stop();
  project = p;
  sceneId = project.scenes.some((s) => s.id === sceneId)
    ? sceneId
    : project.scenes[0]?.id;
  layerId = null;
  assetId = project.assets.some((a) => a.id === assetId)
    ? assetId
    : project.assets[0]?.id;
  time = clamp(time, 0, duration());
  refresh();
  changed();
}
$("undo").onclick = () => {
  if (recording || !history.length) return;
  future.push(snapshot());
  restoreSnapshot(history.pop());
};
$("redo").onclick = () => {
  if (recording || !future.length) return;
  history.push(snapshot());
  restoreSnapshot(future.pop());
};
function download(blob, name) {
  const url = URL.createObjectURL(blob),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
}
function cleanName() {
  return (
    (project.name || "mi-historia").replace(/[^\p{L}\p{N} _-]/gu, "").trim() ||
    "mi-historia"
  );
}
async function confirmAction(title, description) {
  $("confirm-title").textContent = title;
  $("confirm-description").textContent = description;
  $("confirm-dialog").showModal();
  return new Promise((resolve) => {
    const finish = (v) => {
      $("confirm-dialog").close();
      resolve(v);
    };
    $("confirm-ok").onclick = () => finish(true);
    $("confirm-cancel").onclick = () => finish(false);
    $("confirm-dialog").oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
  });
}
function newLayer(a) {
  return {
    id: uid(),
    kind: "sprite",
    name: a.name,
    assetId: a.id,
    frames: [...a.frames],
    xCuts: [...a.xCuts],
    yCuts: [...a.yCuts],
    cols: a.cols,
    rows: a.rows,
    fps: a.fps,
    scale: 36,
    startX: 50,
    startY: 58,
    endX: 50,
    endY: 58,
    opacity: 100,
    flip: false,
    visible: true,
  };
}
function newScene(name = "Nueva escena") {
  return {
    id: uid(),
    name,
    duration: 4,
    color: "#e9efdc",
    background: null,
    transition: "cut",
    layers: [],
  };
}
function makeImage(src) {
  if (images.has(src)) return Promise.resolve(images.get(src));
  return new Promise((resolve, reject) => {
    const im = new Image();
    im.onload = () => {
      if (
        im.width * im.height > 16777216 ||
        im.width > 16384 ||
        im.height > 16384
      ) {
        reject(
          Error(
            "Imagen demasiado grande. Usa hasta 16 megapíxeles y 16384 px por lado.",
          ),
        );
        return;
      }
      images.set(src, im);
      resolve(im);
    };
    im.onerror = () => reject(Error("No se pudo abrir la imagen."));
    im.src = src;
  });
}
function dataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(Error("No se pudo leer el archivo."));
    r.readAsDataURL(file);
  });
}
function decodeAudio(src) {
  if (audioBuffers.has(src)) return Promise.resolve(audioBuffers.get(src));
  audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
  return fetch(src)
    .then((r) => r.arrayBuffer())
    .then((b) => audioContext.decodeAudioData(b))
    .then((b) => {
      audioBuffers.set(src, b);
      return b;
    });
}
let importing = false;
async function importFiles(files, type = libraryType) {
  if (recording || importing) return;
  importing = true;
  $("import-assets").disabled = true;
  const added = [];
  for (const file of files) {
    try {
      if (project.assets.length + added.length >= 80)
        throw Error("Máximo 80 recursos por proyecto.");
      if (file.size > 20 * 1024 * 1024)
        throw Error("Cada recurso puede ocupar hasta 20 MB.");
      if (type === "audio") {
        if (!file.type.startsWith("audio/"))
          throw Error("Selecciona un archivo de audio.");
        const src = await dataURL(file),
          buffer = await decodeAudio(src);
        added.push({
          id: uid(),
          type,
          name: file.name.slice(0, 80),
          src,
          duration: buffer.duration,
        });
        continue;
      }
      if (!["image/png", "image/jpeg", "image/webp"].includes(file.type))
        throw Error("Usa imágenes PNG, JPG o WebP.");
      const src = await dataURL(file),
        im = await makeImage(src),
        a = {
          id: uid(),
          type,
          name: file.name.slice(0, 80),
          src,
          width: im.width,
          height: im.height,
        };
      if (type === "sprite") {
        const cols = im.width >= im.height * 3 ? 8 : 1;
        a.cols = Math.min(cols, im.width);
        a.rows = 1;
        a.xCuts = Array.from(
          { length: a.cols + 1 },
          (_, i) => (i * im.width) / a.cols,
        );
        a.yCuts = [0, im.height];
        a.frames = Array.from({ length: a.cols }, (_, i) => i);
        a.fps = 8;
      }
      added.push(a);
    } catch (e) {
      toast(file.name + ": " + e.message);
    }
  }
  importing = false;
  $("import-assets").disabled = false;
  if (!added.length) return;
  checkpoint();
  project.assets.push(...added);
  assetId = added[0].id;
  libraryType = type;
  stop();
  if (type === "sprite") {
    mode = "sprite";
    spriteZoom = 0;
    layerId = null;
  }
  if (type === "background" && scene()) scene().background = added[0].id;
  if (type === "audio") project.audio = { assetId: added[0].id, volume: 70 };
  refresh();
  changed();
  mobilePanel(type === "sprite" ? "editor" : "inspector");
  toast(
    type === "sprite"
      ? "PNG importado. Ajusta sus cortes y añádelo a la escena."
      : "Recurso importado.",
  );
}
function setLibrary(type) {
  libraryType = type;
  renderLibrary();
}
function renderLibrary() {
  document.querySelectorAll("[data-library]").forEach((b) => {
    b.classList.toggle("active", b.dataset.library === libraryType);
    b.setAttribute("aria-selected", b.dataset.library === libraryType);
  });
  const list = $("asset-list");
  list.replaceChildren();
  const items = project.assets.filter((a) => a.type === libraryType);
  $("asset-count").textContent = project.assets.length + " recursos";
  $("import-assets").innerHTML =
    "<span>＋</span> " +
    {
      sprite: "Importar sprites PNG",
      background: "Importar fondos",
      audio: "Importar música / narración",
    }[libraryType];
  $("asset-file").accept =
    libraryType === "audio" ? "audio/*" : "image/png,image/jpeg,image/webp";
  for (const a of items) {
    const card = document.createElement("div");
    card.className = "asset-card" + (assetId === a.id ? " selected" : "");
    card.tabIndex = 0;
    card.draggable = true;
    card.setAttribute("aria-label", a.name);
    card.ondragstart = (e) =>
      e.dataTransfer.setData("application/spritelab-asset", a.id);
    const thumb = document.createElement("div");
    thumb.className = "asset-thumbnail";
    const c = document.createElement("canvas");
    c.width = 190;
    c.height = 95;
    const x = c.getContext("2d");
    if (a.type === "sprite") {
      paintSprite(x, a, a.frames[0], a, 0, 0, 190, 95);
    } else if (a.type === "background") {
      const im = images.get(a.src);
      if (im) fitImage(x, im, 190, 95);
    } else {
      x.fillStyle = "#8da572";
      x.font = "36px sans-serif";
      x.textAlign = "center";
      x.fillText("♫", 95, 60);
    }
    thumb.append(c);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent =
      a.type === "sprite"
        ? a.frames.length + " POSES"
        : a.type === "audio"
          ? "AUDIO"
          : "FONDO";
    thumb.append(tag);
    const meta = document.createElement("div");
    meta.className = "asset-meta";
    const info = document.createElement("div"),
      name = document.createElement("strong"),
      details = document.createElement("small");
    name.textContent = a.name;
    details.textContent =
      a.type === "audio"
        ? a.duration.toFixed(1) + " s"
        : `${a.width} × ${a.height} · ${a.type === "sprite" ? a.cols + "×" + a.rows : "imagen"}`;
    info.append(name, details);
    const add = document.createElement("button");
    add.textContent = "＋";
    add.title =
      a.type === "sprite"
        ? "Añadir a la escena"
        : a.type === "background"
          ? "Usar como fondo"
          : "Usar en la película";
    add.setAttribute("aria-label", add.title + " " + a.name);
    add.onclick = (e) => {
      e.stopPropagation();
      useAsset(a.id);
    };
    meta.append(info, add);
    const footer = document.createElement("div");
    footer.className = "asset-footer";
    const edit = document.createElement("button");
    edit.textContent =
      a.type === "sprite" ? "▦ Editar cortes" : "Ver propiedades";
    edit.onclick = (e) => {
      e.stopPropagation();
      selectAsset(a.id);
    };
    const del = document.createElement("button");
    del.textContent = "Quitar";
    del.onclick = (e) => {
      e.stopPropagation();
      removeAsset(a.id);
    };
    footer.append(edit, del);
    card.append(thumb, meta, footer);
    card.onclick = () => selectAsset(a.id);
    card.onkeydown = (e) => {
      if (e.key === "Enter") selectAsset(a.id);
    };
    list.append(card);
  }
  if (!items.length) {
    const empty = document.createElement("p");
    empty.className = "empty-library";
    empty.textContent =
      libraryType === "sprite"
        ? "Importa una hoja de sprites PNG. Puedes usar imágenes creadas con tu generador de IA favorito."
        : libraryType === "background"
          ? "Añade escenarios PNG, JPG o WebP para ambientar tus escenas."
          : "Importa música o una narración. Se reproducirá desde el comienzo de la película.";
    list.append(empty);
  }
}
function selectAsset(id) {
  assetId = id;
  const a = asset();
  if (!a) return;
  libraryType = a.type;
  stop();
  if (a.type === "sprite") {
    mode = "sprite";
    spriteZoom = 0;
    layerId = null;
    refresh();
    mobilePanel("editor");
  } else {
    mode = "scene";
    renderLibrary();
    renderInspector();
    mobilePanel("inspector");
  }
}
function useAsset(id) {
  const a = asset(id);
  if (!a || recording) return;
  checkpoint();
  if (a.type === "audio") {
    project.audio = { assetId: id, volume: 70 };
    mode = "scene";
    refresh();
    changed();
    return;
  }
  if (!scene()) {
    const s = newScene();
    project.scenes.push(s);
    sceneId = s.id;
  }
  if (a.type === "sprite") {
    if (scene().layers.length >= 80)
      return toast("Máximo 80 capas por escena.");
    const l = newLayer(a);
    scene().layers.push(l);
    layerId = l.id;
  } else {
    scene().background = id;
    layerId = null;
  }
  assetId = id;
  mode = "scene";
  stop();
  time = startOf(sceneId);
  point = "start";
  refresh();
  changed();
  mobilePanel("editor");
}
async function removeAsset(id) {
  const a = asset(id);
  if (!a) return;
  const used =
    project.scenes.some(
      (s) => s.background === id || s.layers.some((l) => l.assetId === id),
    ) || project.audio?.assetId === id;
  if (
    used &&
    !(await confirmAction(
      "¿Quitar este recurso?",
      "También se quitará de las escenas o del audio donde se utiliza.",
    ))
  )
    return;
  checkpoint();
  project.assets = project.assets.filter((a) => a.id !== id);
  project.scenes.forEach((s) => {
    s.layers = s.layers.filter((l) => l.assetId !== id);
    if (s.background === id) s.background = null;
  });
  if (project.audio?.assetId === id) project.audio = null;
  if (assetId === id)
    assetId = project.assets.find((a) => a.type === libraryType)?.id || null;
  layerId = null;
  refresh();
  changed();
}
function fitImage(ctx, im, w, h) {
  const z = Math.max(w / im.width, h / im.height);
  ctx.drawImage(
    im,
    (w - im.width * z) / 2,
    (h - im.height * z) / 2,
    im.width * z,
    im.height * z,
  );
}
function paintSprite(ctx, a, id, cuts, x, y, w, h) {
  const im = images.get(a.src);
  if (!im || id === undefined) return;
  const col = id % cuts.cols,
    row = Math.floor(id / cuts.cols),
    sx = cuts.xCuts[col],
    sy = cuts.yCuts[row],
    sw = cuts.xCuts[col + 1] - sx,
    sh = cuts.yCuts[row + 1] - sy;
  if (sw <= 0 || sh <= 0) return;
  const scale = Math.min(w / sw, h / sh);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(
    im,
    sx,
    sy,
    sw,
    sh,
    x + (w - sw * scale) / 2,
    y + (h - sh * scale) / 2,
    sw * scale,
    sh * scale,
  );
}
function textLines(ctx, l, font) {
  const lines = [];
  for (const para of l.text.split("\n")) {
    let line = "";
    for (const word of para.split(" ")) {
      const next = line ? line + " " + word : word;
      if (ctx.measureText(next).width > project.width * 0.9 && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    lines.push(line);
  }
  return lines;
}
function layerBox(ctx, l, s, local) {
  const f = clamp(local / s.duration, 0, 1),
    x = ((l.startX + (l.endX - l.startX) * f) / 100) * project.width,
    y = ((l.startY + (l.endY - l.startY) * f) / 100) * project.height;
  let h = (project.height * l.scale) / 100,
    w = h;
  if (l.kind === "sprite") {
    const a = asset(l.assetId);
    if (!a) return null;
    const id = l.frames[Math.floor(local * l.fps) % l.frames.length],
      col = id % l.cols,
      row = Math.floor(id / l.cols);
    w =
      (h * (l.xCuts[col + 1] - l.xCuts[col])) /
      (l.yCuts[row + 1] - l.yCuts[row]);
  } else {
    ctx.font = `${l.bold ? "600" : "400"} ${h}px sans-serif`;
    const lines = textLines(ctx, l, h);
    w = Math.max(...lines.map((v) => ctx.measureText(v).width), h);
    h *= Math.max(1, lines.length) * 1.25;
  }
  return { x: x - w / 2, y: y - h / 2, w, h, cx: x, cy: y };
}
function drawScene(ctx, s, local, w, h, withSelection = false) {
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.scale(w / project.width, h / project.height);
  ctx.fillStyle = s?.color || "#edf2e4";
  ctx.fillRect(0, 0, project.width, project.height);
  if (s) {
    const background = asset(s.background),
      im = background && images.get(background.src);
    if (im) {
      const key = background.id + ":" + w + "x" + h;
      let cached = backgroundCache.get(key);
      if (!cached) {
        cached =
          typeof OffscreenCanvas !== "undefined"
            ? new OffscreenCanvas(w, h)
            : document.createElement("canvas");
        cached.width = w;
        cached.height = h;
        fitImage(cached.getContext("2d"), im, w, h);
        backgroundCache.set(key, cached);
        while (backgroundCache.size > 6)
          backgroundCache.delete(backgroundCache.keys().next().value);
      }
      ctx.drawImage(cached, 0, 0, project.width, project.height);
    }
    for (const l of s.layers) {
      if (!l.visible) continue;
      const b = layerBox(ctx, l, s, local);
      if (!b) continue;
      ctx.save();
      ctx.globalAlpha = l.opacity / 100;
      if (l.kind === "sprite") {
        const a = asset(l.assetId),
          id = l.frames[Math.floor(local * l.fps) % l.frames.length];
        if (l.flip) {
          ctx.translate(b.cx, 0);
          ctx.scale(-1, 1);
          paintSprite(ctx, a, id, l, -b.w / 2, b.y, b.w, b.h);
        } else paintSprite(ctx, a, id, l, b.x, b.y, b.w, b.h);
      } else {
        const font = (project.height * l.scale) / 100;
        ctx.font = `${l.bold ? "600" : "400"} ${font}px sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = l.color;
        const lines = textLines(ctx, l, font);
        if (l.shadow) {
          ctx.shadowColor = "#0008";
          ctx.shadowBlur = font * 0.15;
          ctx.shadowOffsetY = font * 0.04;
        }
        lines.forEach((line, i) =>
          ctx.fillText(
            line,
            b.cx,
            b.cy + (i - (lines.length - 1) / 2) * font * 1.25,
          ),
        );
      }
      ctx.restore();
    }
    if (s.transition === "fade") {
      const alpha = Math.min(1, local / 0.35, (s.duration - local) / 0.35);
      ctx.globalAlpha = clamp(1 - alpha, 0, 1);
      ctx.fillStyle = "#111710";
      ctx.fillRect(0, 0, project.width, project.height);
    }
  }
  ctx.restore();
}
function render() {
  const at = atTime(time);
  const box = $("stage-box"),
    dpr = Math.min(devicePixelRatio || 1, 1.5),
    fit = Math.min(
      1280 / project.width,
      1280 / project.height,
      Math.max(320, box.clientWidth * dpr) / project.width,
    ),
    previewWidth = Math.max(1, Math.round(project.width * fit)),
    previewHeight = Math.max(1, Math.round(project.height * fit));
  if (stage.width !== previewWidth || stage.height !== previewHeight) {
    stage.width = previewWidth;
    stage.height = previewHeight;
  }
  drawScene(stageCtx, at?.s, at?.local || 0, stage.width, stage.height);
  const mscale = Math.min(320 / project.width, 180 / project.height),
    mw = Math.round(project.width * mscale),
    mh = Math.round(project.height * mscale);
  if (mini.width !== mw || mini.height !== mh) {
    mini.width = mw;
    mini.height = mh;
  }
  if (innerWidth > 730)
    drawScene(miniCtx, at?.s, at?.local || 0, mini.width, mini.height);
  $("stage-empty").hidden = !!project.scenes.length;
  $("active-scene-name").textContent = at?.s.name || "Sin escenas";
  $("timecode").innerHTML =
    clock(time) + " <em>/ " + clock(duration()) + "</em>";
  $("playhead").style.left = trackLabelWidth() + xForTime(time) + "px";
  $("preview-aspect").textContent = aspectLabel();
  $("preview-fps").textContent = project.fps + " FPS";
  $("canvas-size").textContent = project.width + " × " + project.height;
  $("aspect-button").innerHTML = aspectRatio() + " <span>⌄</span>";
  $("scene-count").textContent = project.scenes.length + " escenas";
  selectionOverlay();
  if (mode === "sprite") drawSpritePreview();
}
function clock(t) {
  const minutes = Math.floor(t / 60),
    seconds = (t % 60).toFixed(2).padStart(5, "0");
  return String(minutes).padStart(2, "0") + ":" + seconds;
}
function aspectRatio() {
  const gcd = (a, b) => (b ? gcd(b, a % b) : a),
    g = gcd(project.width, project.height);
  return project.width / g + ":" + project.height / g;
}
function aspectLabel() {
  return (
    (project.height > project.width
      ? "Vertical"
      : project.width > project.height
        ? "Horizontal"
        : "Cuadrado") +
    " · " +
    aspectRatio()
  );
}
function fitStage() {
  const view = $("stage-viewport");
  const aw = Math.max(120, view.clientWidth - 64),
    ah = Math.max(100, view.clientHeight - 50),
    base = Math.min(aw / project.width, ah / project.height),
    scale = zoom || base;
  $("stage-box").style.width = project.width * scale + "px";
  $("stage-box").style.height = project.height * scale + "px";
  $("stage-viewport").style.justifyContent =
    project.width * scale > aw + 40 ? "flex-start" : "center";
  $("stage-viewport").style.alignItems =
    project.height * scale > ah + 40 ? "flex-start" : "center";
  $("zoom-value").textContent = zoom
    ? Math.round(scale * 100) + "%"
    : "Ajustar";
  selectionOverlay();
}
function selectionOverlay() {
  const at = atTime(time),
    s = scene(),
    l = layer();
  const el = $("selection-box");
  if (
    mode !== "scene" ||
    playing ||
    recording ||
    !s ||
    !l ||
    at?.s.id !== s.id ||
    !l.visible
  ) {
    el.hidden = true;
    return;
  }
  const b = layerBox(stageCtx, l, s, at.local);
  if (!b) {
    el.hidden = true;
    return;
  }
  const box = $("stage-box");
  el.hidden = false;
  el.style.left = (b.x / project.width) * 100 + "%";
  el.style.top = (b.y / project.height) * 100 + "%";
  el.style.width = (b.w / project.width) * 100 + "%";
  el.style.height = (b.h / project.height) * 100 + "%";
  $("selection-label").textContent = l.name;
}
function seek(t, select = true) {
  stop();
  time = clamp(t, 0, duration());
  const at = atTime(time);
  if (select && at && sceneId !== at.s.id) {
    sceneId = at.s.id;
    layerId = null;
    renderInspector();
    renderTimeline();
  }
  render();
}
function stop() {
  audioGeneration++;
  playing = false;
  $("play").textContent = "▶";
  $("play").setAttribute("aria-label", "Reproducir");
  if (playAudio) {
    try {
      playAudio.stop();
    } catch {}
    playAudio = null;
  }
}
async function togglePlay() {
  if (recording || !project.scenes.length) return;
  if (playing) {
    stop();
    render();
    return;
  }
  if (time >= duration()) time = 0;
  playing = true;
  playStarted = performance.now() - time * 1000;
  $("play").textContent = "Ⅱ";
  $("play").setAttribute("aria-label", "Pausar");
  scheduleAnimation();
  startPlaybackAudio(time).catch(() =>
    toast("No se pudo reproducir el audio."),
  );
  selectionOverlay();
}
async function startPlaybackAudio(offset) {
  const generation = audioGeneration,
    track = project.audio,
    a = track && asset(track.assetId);
  if (!a) return;
  const b = await decodeAudio(a.src);
  await audioContext.resume();
  if (!playing || generation !== audioGeneration || offset >= b.duration)
    return;
  const node = audioContext.createBufferSource(),
    gain = audioContext.createGain();
  node.buffer = b;
  gain.gain.value = track.volume / 100;
  node.connect(gain).connect(audioContext.destination);
  node.start(0, offset);
  playAudio = node;
}
function scheduleAnimation() {
  if (
    animationId === null &&
    !document.hidden &&
    (playing || mode === "sprite")
  )
    animationId = requestAnimationFrame(animationFrame);
}
function animationFrame(now) {
  animationId = null;
  if (document.hidden) return;
  if (playing && now - lastPlaybackFrame >= 1000 / project.fps - 1) {
    lastPlaybackFrame = now;
    time = (now - playStarted) / 1000;
    if (time >= duration()) {
      if ($("loop").checked) {
        time = 0;
        playStarted = now;
        if (playAudio) {
          try {
            playAudio.stop();
          } catch {}
        }
        startPlaybackAudio(0).catch(() => {});
      } else {
        time = duration();
        stop();
      }
    }
    const at = atTime(time);
    if (at && at.s.id !== sceneId) {
      sceneId = at.s.id;
      layerId = null;
      renderInspector();
      renderTimeline();
    }
    render();
  }
  if (mode === "sprite" && now - frameClock > 1000 / (asset()?.fps || 8)) {
    frameClock = now;
    miniFrame++;
    drawSpritePreview();
  }
  scheduleAnimation();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    if (playing) {
      stop();
      render();
    }
    if (animationId !== null) {
      cancelAnimationFrame(animationId);
      animationId = null;
    }
  } else scheduleAnimation();
});
function el(tag, cls, text) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
}
function group(title) {
  const g = el("section", "property-group");
  if (title) g.append(el("div", "subheading", title));
  return g;
}
function button(text, action, cls) {
  const b = el("button", cls, text);
  b.onclick = action;
  return b;
}
function field(parent, label, value, options, handler) {
  let previous = value;
  const wrap = el("label", "field", label);
  let input;
  if (options?.type === "select") {
    input = el("select");
    for (const [v, t] of options.items) {
      const o = el("option", null, t);
      o.value = v;
      input.append(o);
    }
  } else if (options?.type === "textarea") {
    input = el("textarea");
    input.rows = 2;
    input.maxLength = 500;
  } else {
    input = el("input");
    input.type = options?.type || "text";
    if (input.type === "text") input.maxLength = 80;
    for (const key of ["min", "max", "step"])
      if (options?.[key] !== undefined) input[key] = options[key];
  }
  input.value = value;
  input.setAttribute("aria-label", label);
  if (options?.id) input.id = options.id;
  input.onchange = () => {
    let v = input.value;
    if (["number", "range"].includes(input.type)) {
      v = Number(v);
      if (!Number.isFinite(v)) return;
      v = clamp(v, options.min ?? -Infinity, options.max ?? Infinity);
    }
    if (recording || v === previous) return;
    previous = v;
    stop();
    checkpoint();
    handler(v);
    changed();
    refresh();
  };
  wrap.append(input);
  parent.append(wrap);
  return input;
}
function selectScene(id) {
  if (recording) return;
  stop();
  sceneId = id;
  layerId = null;
  point = "start";
  time = startOf(id);
  mode = "scene";
  refresh();
  mobilePanel("editor");
}
function renderInspector() {
  const root = $("inspector-content");
  root.replaceChildren();
  const a = asset();
  if (mode === "sprite" && a?.type === "sprite") {
    renderSpriteInspector(root, a);
    return;
  }
  const s = scene(),
    l = layer();
  $("inspector-type").textContent = l
    ? l.kind === "text"
      ? "TEXTO"
      : "PERSONAJE"
    : "ESCENA";
  if (!s) {
    const empty = el(
      "p",
      "property-hint",
      "Crea una escena o importa un PNG para empezar tu historia.",
    );
    root.append(empty);
    root.append(button("＋ Crear escena", addScene, "accent"));
    return;
  }
  if (l) {
    const g = group(l.kind === "text" ? "TU TEXTO" : "TU PERSONAJE");
    field(g, "Nombre", l.name, { id: "layer-name" }, (v) => (l.name = v));
    if (l.kind === "text") {
      field(
        g,
        "Texto",
        l.text,
        { type: "textarea", id: "layer-text" },
        (v) => (l.text = v),
      );
      field(g, "Color", l.color, { type: "color" }, (v) => (l.color = v));
      const checks = el("div", "property-actions");
      checks.append(
        button(l.bold ? "✓ Negrita" : "Negrita", () => {
          checkpoint();
          l.bold = !l.bold;
          refresh();
          changed();
        }),
        button(l.shadow ? "✓ Sombra" : "Sombra", () => {
          checkpoint();
          l.shadow = !l.shadow;
          refresh();
          changed();
        }),
      );
      g.append(checks);
    } else {
      field(
        g,
        "Velocidad · FPS",
        l.fps,
        { type: "number", min: 1, max: 60, step: 1, id: "layer-fps" },
        (v) => (l.fps = v),
      );
      g.append(
        button(
          "▦ Editar la hoja de sprites",
          () => selectAsset(l.assetId),
          "quiet",
        ),
      );
    }
    root.append(g);
    const movement = group("POSICIÓN Y MOVIMIENTO");
    const tabs = el("div", "point-tabs");
    for (const [key, name] of [
      ["start", "Inicio"],
      ["end", "Final"],
    ])
      tabs.append(
        button(
          name,
          () => {
            stop();
            point = key;
            time = startOf(s.id) + (key === "end" ? s.duration - 0.0001 : 0);
            refresh();
          },
          point === key ? "active" : "",
        ),
      );
    movement.append(tabs);
    const pos = el("div", "form-grid");
    field(
      pos,
      "X · %",
      l[point + "X"],
      { type: "number", min: -100, max: 200, step: 1, id: "position-x" },
      (v) => {
        l[point + "X"] = v;
        if (!l.motion) {
          l[(point === "start" ? "end" : "start") + "X"] = v;
        }
      },
    );
    field(
      pos,
      "Y · %",
      l[point + "Y"],
      { type: "number", min: -100, max: 200, step: 1, id: "position-y" },
      (v) => {
        l[point + "Y"] = v;
        if (!l.motion) l[(point === "start" ? "end" : "start") + "Y"] = v;
      },
    );
    movement.append(pos);
    field(
      movement,
      "Movimiento",
      l.motion ? "linear" : "still",
      {
        type: "select",
        id: "layer-motion",
        items: [
          ["still", "Fijo · misma posición"],
          ["linear", "Animar de inicio a final"],
        ],
      },
      (v) => {
        l.motion = v === "linear";
        if (!l.motion) {
          l.endX = l.startX;
          l.endY = l.startY;
        }
      },
    );
    field(
      movement,
      l.kind === "text" ? "Tamaño del texto · %" : "Altura del personaje · %",
      l.scale,
      {
        type: "range",
        min: l.kind === "text" ? 1 : 5,
        max: l.kind === "text" ? 25 : 150,
        step: 1,
        id: "layer-scale",
      },
      (v) => (l.scale = v),
    );
    field(
      movement,
      "Opacidad · %",
      l.opacity,
      { type: "range", min: 0, max: 100, step: 1 },
      (v) => (l.opacity = v),
    );
    if (l.kind === "sprite")
      movement.append(
        button(
          l.flip ? "✓ Volteado horizontal" : "⇄ Voltear horizontal",
          () => {
            checkpoint();
            l.flip = !l.flip;
            refresh();
            changed();
          },
          "quiet",
        ),
      );
    movement.append(
      el(
        "p",
        "property-hint",
        "Arrastra en el escenario. Con movimiento activado, coloca al personaje en Inicio y luego en Final.",
      ),
    );
    root.append(movement);
    const actions = el("div", "property-actions");
    actions.append(
      button("Duplicar", duplicateLayer),
      button("Quitar", deleteLayer, "danger"),
    );
    root.append(actions);
  } else {
    const g = group("TU ESCENA");
    field(g, "Nombre", s.name, { id: "scene-name" }, (v) => (s.name = v));
    field(
      g,
      "Duración · segundos",
      s.duration,
      { type: "number", min: 0.5, max: 600, step: 0.1, id: "scene-duration" },
      (v) => {
        s.duration = Math.round(v * 10) / 10;
        time = clamp(time, 0, duration());
      },
    );
    field(
      g,
      "Entrada / salida",
      s.transition,
      {
        type: "select",
        items: [
          ["cut", "Corte directo"],
          ["fade", "Fundido a negro"],
        ],
      },
      (v) => (s.transition = v),
    );
    root.append(g);
    const background = group("FONDO");
    field(
      background,
      "Color del escenario",
      s.color,
      { type: "color", id: "scene-color" },
      (v) => (s.color = v),
    );
    field(
      background,
      "Imagen de fondo",
      s.background || "",
      {
        type: "select",
        id: "scene-background",
        items: [
          ["", "Solo color"],
          ...project.assets
            .filter((a) => a.type === "background")
            .map((a) => [a.id, a.name]),
        ],
      },
      (v) => (s.background = v || null),
    );
    background.append(
      button(
        "＋ Importar fondo",
        () => {
          libraryType = "background";
          renderLibrary();
          $("asset-file").click();
        },
        "quiet",
      ),
    );
    root.append(background);
    const actions = el("div", "property-actions");
    actions.append(
      button("Duplicar escena", duplicateScene),
      button("Eliminar escena", deleteScene, "danger"),
    );
    const order = el("div", "touch-scene-actions");
    order.append(
      button("← Mover antes", () => reorderScene(-1)),
      button("Mover después →", () => reorderScene(1)),
    );
    root.append(actions, order);
  }
  const layers = group("CAPAS DE LA ESCENA");
  const stack = el("div", "layers");
  for (const item of [...s.layers].reverse()) {
    const row = el(
      "div",
      "layer-item" + (item.id === layerId ? " active" : ""),
    );
    const select = el("button", "layer-select");
    select.append(
      el("span", null, item.kind === "text" ? "T" : "▧"),
      el("span", null, item.name),
    );
    select.onclick = () => {
      layerId = item.id;
      point = "start";
      time = startOf(s.id);
      stop();
      refresh();
    };
    const visible = button(item.visible ? "◉" : "○", () => {
      checkpoint();
      item.visible = !item.visible;
      refresh();
      changed();
    });
    visible.setAttribute(
      "aria-label",
      item.visible ? "Ocultar " + item.name : "Mostrar " + item.name,
    );
    row.append(select, visible);
    stack.append(row);
  }
  if (!s.layers.length)
    stack.append(
      el(
        "p",
        "property-hint",
        "Pulsa ＋ en un sprite de la biblioteca o añade texto.",
      ),
    );
  layers.append(stack);
  const layerActions = el("div", "layer-options");
  if (l) {
    layerActions.append(
      button("↑ Subir", () => moveLayer(1)),
      button("↓ Bajar", () => moveLayer(-1)),
    );
  }
  if (l)
    layerActions.append(
      button("Ver escena", () => {
        layerId = null;
        refresh();
      }),
    );
  layers.append(layerActions);
  root.append(layers);
  if (project.audio) {
    const audio = group("AUDIO DE LA PELÍCULA");
    const a = asset(project.audio.assetId);
    audio.append(el("p", "property-hint", a?.name || "Audio"));
    field(
      audio,
      "Volumen · %",
      project.audio.volume,
      { type: "range", min: 0, max: 100, step: 1, id: "audio-volume" },
      (v) => (project.audio.volume = v),
    );
    audio.append(
      button(
        "Quitar audio",
        () => {
          checkpoint();
          project.audio = null;
          refresh();
          changed();
        },
        "quiet",
      ),
    );
    root.append(audio);
  }
}
function syncAsset(a) {
  for (const s of project.scenes)
    for (const l of s.layers)
      if (l.kind === "sprite" && l.assetId === a.id) {
        l.frames = [...a.frames];
        l.xCuts = [...a.xCuts];
        l.yCuts = [...a.yCuts];
        l.cols = a.cols;
        l.rows = a.rows;
      }
}
function renderSpriteInspector(root, a) {
  $("inspector-type").textContent = "SPRITESHEET";
  const g = group("HOJA DE SPRITES");
  field(
    g,
    "Nombre del recurso",
    a.name,
    { id: "sprite-name" },
    (v) => (a.name = v),
  );
  const grid = el("div", "form-grid");
  const cols = el("label", null, "Columnas"),
    rows = el("label", null, "Filas"),
    ci = el("input"),
    ri = el("input");
  ci.type = ri.type = "number";
  ci.min = ri.min = 1;
  ci.max = ri.max = 64;
  ci.value = a.cols;
  ri.value = a.rows;
  ci.id = "grid-cols";
  ri.id = "grid-rows";
  cols.append(ci);
  rows.append(ri);
  grid.append(cols, rows);
  g.append(grid);
  g.append(
    button(
      "Aplicar rejilla uniforme",
      () => {
        const c = +ci.value,
          r = +ri.value;
        if (
          !Number.isInteger(c) ||
          !Number.isInteger(r) ||
          c < 1 ||
          r < 1 ||
          c > 64 ||
          r > 64 ||
          c * r > 256 ||
          c > a.width ||
          r > a.height
        )
          return toast(
            "Usa una rejilla de 1 a 256 poses, con un máximo de 64 filas o columnas.",
          );
        checkpoint();
        a.cols = c;
        a.rows = r;
        a.xCuts = Array.from({ length: c + 1 }, (_, i) => (i * a.width) / c);
        a.yCuts = Array.from({ length: r + 1 }, (_, i) => (i * a.height) / r);
        a.frames = Array.from({ length: c * r }, (_, i) => i);
        syncAsset(a);
        refresh();
        changed();
      },
      "accent",
    ),
  );
  g.append(
    el(
      "p",
      "property-hint",
      "Las líneas exteriores recortan los márgenes. Las interiores separan las poses. Sus cambios se aplican a todas las escenas que usan este sprite.",
    ),
  );
  root.append(g);
  const timing = group("ANIMACIÓN");
  field(
    timing,
    "Velocidad de la vista previa · FPS",
    a.fps,
    { type: "number", min: 1, max: 60, step: 1, id: "sprite-fps" },
    (v) => (a.fps = v),
  );
  const pills = el("div", "frame-pills");
  for (let i = 0; i < a.cols * a.rows; i++) {
    const b = button(
      String(i + 1).padStart(2, "0"),
      () => toggleFrame(a, i),
      a.frames.includes(i) ? "" : "off",
    );
    b.title = a.frames.includes(i)
      ? "Excluir pose " + (i + 1)
      : "Incluir pose " + (i + 1);
    b.setAttribute("aria-label", b.title);
    pills.append(b);
  }
  timing.append(pills);
  timing.append(
    el(
      "p",
      "property-hint",
      a.frames.length +
        " poses incluidas · orden de lectura de izquierda a derecha.",
    ),
  );
  root.append(timing);
  const cuts = group("CORTES PRECISOS · PX");
  const controls = el("div", "cut-controls");
  for (const [key, label, limit] of [
    ["xCuts", "X", a.width],
    ["yCuts", "Y", a.height],
  ])
    for (let i = 0; i < a[key].length; i++) {
      const wrap = el("label", null, label + i),
        input = el("input");
      input.type = "number";
      input.min = i ? a[key][i - 1] + 1 : 0;
      input.max = i < a[key].length - 1 ? a[key][i + 1] - 1 : limit;
      input.step = 1;
      input.value = Math.round(a[key][i]);
      input.setAttribute("aria-label", "Corte " + label + i);
      input.onchange = () => {
        if (!Number.isFinite(+input.value)) return;
        checkpoint();
        a[key][i] = clamp(+input.value, +input.min, +input.max);
        syncAsset(a);
        refresh();
        changed();
      };
      wrap.append(input);
      controls.append(wrap);
    }
  cuts.append(controls);
  root.append(cuts);
}
function toggleFrame(a, id) {
  if (a.frames.includes(id) && a.frames.length === 1)
    return toast("Conserva al menos una pose.");
  checkpoint();
  a.frames = a.frames.includes(id)
    ? a.frames.filter((n) => n !== id)
    : [...a.frames, id].sort((x, y) => x - y);
  syncAsset(a);
  refresh();
  changed();
}
function addScene() {
  if (recording) return;
  if (project.scenes.length >= 100)
    return toast("Máximo 100 escenas por proyecto.");
  checkpoint();
  const s = newScene(
    "Escena " + String(project.scenes.length + 1).padStart(2, "0"),
  );
  project.scenes.push(s);
  sceneId = s.id;
  layerId = null;
  point = "start";
  mode = "scene";
  time = startOf(s.id);
  stop();
  refresh();
  changed();
  mobilePanel("editor");
}
function reorderScene(delta) {
  const s = scene(),
    index = project.scenes.indexOf(s),
    to = index + delta;
  if (index < 0 || to < 0 || to >= project.scenes.length || recording) return;
  checkpoint();
  project.scenes.splice(index, 1);
  project.scenes.splice(to, 0, s);
  time = startOf(s.id);
  stop();
  refresh();
  changed();
}
function duplicateScene() {
  const s = scene();
  if (!s || recording) return;
  if (project.scenes.length >= 100) return toast("Máximo 100 escenas.");
  checkpoint();
  const copy = {
    ...s,
    id: uid(),
    name: (s.name + " · copia").slice(0, 80),
    layers: s.layers.map((l) => ({
      ...l,
      id: uid(),
      frames: l.frames ? [...l.frames] : undefined,
      xCuts: l.xCuts ? [...l.xCuts] : undefined,
      yCuts: l.yCuts ? [...l.yCuts] : undefined,
    })),
  };
  project.scenes.splice(project.scenes.indexOf(s) + 1, 0, copy);
  sceneId = copy.id;
  layerId = null;
  time = startOf(copy.id);
  stop();
  refresh();
  changed();
}
async function deleteScene() {
  const s = scene();
  if (!s || recording) return;
  if (
    !(await confirmAction(
      "¿Eliminar esta escena?",
      "Se quitarán sus capas del montaje. Puedes deshacer esta acción.",
    ))
  )
    return;
  checkpoint();
  project.scenes = project.scenes.filter((v) => v.id !== s.id);
  sceneId = project.scenes[0]?.id;
  layerId = null;
  time = 0;
  stop();
  refresh();
  changed();
}
function addText() {
  if (recording) return;
  if (scene()?.layers.length >= 80) return toast("Máximo 80 capas por escena.");
  checkpoint();
  if (!scene()) {
    const s = newScene();
    project.scenes.push(s);
    sceneId = s.id;
  }
  const l = {
    id: uid(),
    kind: "text",
    name: "Texto",
    text: "Tu historia empieza aquí",
    color: "#ffffff",
    bold: true,
    shadow: true,
    scale: 6,
    startX: 50,
    startY: 80,
    endX: 50,
    endY: 80,
    opacity: 100,
    visible: true,
    motion: false,
  };
  scene().layers.push(l);
  layerId = l.id;
  time = startOf(sceneId);
  mode = "scene";
  stop();
  refresh();
  changed();
  mobilePanel("inspector");
}
function duplicateLayer() {
  const s = scene(),
    l = layer();
  if (!s || !l || recording) return;
  if (s.layers.length >= 80) return toast("Máximo 80 capas por escena.");
  checkpoint();
  const n = {
    ...l,
    id: uid(),
    name: (l.name + " · copia").slice(0, 80),
    startX: l.startX + 4,
    endX: l.endX + 4,
  };
  s.layers.push(n);
  layerId = n.id;
  refresh();
  changed();
}
function deleteLayer() {
  const s = scene(),
    l = layer();
  if (!s || !l || recording) return;
  checkpoint();
  s.layers = s.layers.filter((v) => v.id !== l.id);
  layerId = null;
  refresh();
  changed();
}
function moveLayer(delta) {
  const s = scene(),
    i = s?.layers.findIndex((l) => l.id === layerId),
    to = i + delta;
  if (i < 0 || to < 0 || to >= s.layers.length) return;
  checkpoint();
  const [l] = s.layers.splice(i, 1);
  s.layers.splice(to, 0, l);
  refresh();
  changed();
}
function spriteFit() {
  const a = asset();
  if (!a || a.type !== "sprite") return;
  const viewport = $("sprite-viewport"),
    fit = Math.min(
      (viewport.clientWidth - 60) / a.width,
      (viewport.clientHeight - 50) / a.height,
    );
  if (!spriteZoom) spriteZoom = Math.max(0.02, fit);
  spriteCanvas.width = a.width;
  spriteCanvas.height = a.height;
  spriteCanvas.style.width = a.width * spriteZoom + "px";
  spriteCanvas.style.height = a.height * spriteZoom + "px";
  viewport.style.justifyContent =
    a.width * spriteZoom > viewport.clientWidth - 50 ? "flex-start" : "center";
  viewport.style.alignItems =
    a.height * spriteZoom > viewport.clientHeight - 40
      ? "flex-start"
      : "center";
  $("sprite-zoom-value").textContent = Math.round(spriteZoom * 100) + "%";
  drawGrid();
}
function drawGrid() {
  const a = asset();
  spriteCanvas.hidden = !a || a.type !== "sprite";
  $("sprite-empty").hidden = !!a && a.type === "sprite";
  $("add-sprite-scene").disabled = !a || a.type !== "sprite";
  if (!a || a.type !== "sprite") return;
  const im = images.get(a.src);
  spriteCtx.clearRect(0, 0, a.width, a.height);
  if (im) spriteCtx.drawImage(im, 0, 0);
  const x = spriteCtx;
  for (let row = 0; row < a.rows; row++)
    for (let col = 0; col < a.cols; col++) {
      const id = row * a.cols + col,
        sx = a.xCuts[col],
        sy = a.yCuts[row],
        w = a.xCuts[col + 1] - sx,
        h = a.yCuts[row + 1] - sy;
      if (!a.frames.includes(id)) {
        x.fillStyle = "#1c2c2288";
        x.fillRect(sx, sy, w, h);
      }
      const font = clamp(10 / spriteZoom, 3, 100);
      x.fillStyle = a.frames.includes(id) ? "#d4f582" : "#e2e5db";
      x.fillRect(
        sx + 3 / spriteZoom,
        sy + 3 / spriteZoom,
        font * 2.1,
        font * 1.5,
      );
      x.fillStyle = "#43562e";
      x.font = `${font}px monospace`;
      x.fillText(
        String(id + 1).padStart(2, "0"),
        sx + 5 / spriteZoom,
        sy + font * 1.35,
      );
    }
  x.lineWidth = 1.5 / spriteZoom;
  for (const [axis, arr] of [
    ["x", a.xCuts],
    ["y", a.yCuts],
  ])
    for (let i = 0; i < arr.length; i++) {
      x.strokeStyle =
        spriteDrag?.axis === axis && spriteDrag.i === i ? "#ffffff" : "#84ac4d";
      x.beginPath();
      if (axis === "x") {
        x.moveTo(arr[i], 0);
        x.lineTo(arr[i], a.height);
      } else {
        x.moveTo(0, arr[i]);
        x.lineTo(a.width, arr[i]);
      }
      x.stroke();
    }
  $("sprite-editor-name").textContent = a.name;
  $("sprite-frame-count").textContent =
    a.frames.length + " poses · " + a.cols + " × " + a.rows;
  drawSpritePreview();
}
function drawSpritePreview() {
  const a = asset();
  if (!a || a.type !== "sprite") return;
  const c = $("sprite-preview"),
    x = c.getContext("2d");
  x.clearRect(0, 0, c.width, c.height);
  paintSprite(
    x,
    a,
    a.frames[miniFrame % a.frames.length],
    a,
    0,
    0,
    c.width,
    c.height,
  );
  $("sprite-preview-info").textContent = a.fps + " FPS";
}
function spriteCoords(e) {
  const r = spriteCanvas.getBoundingClientRect(),
    a = asset();
  return {
    x: ((e.clientX - r.left) / r.width) * a.width,
    y: ((e.clientY - r.top) / r.height) * a.height,
  };
}
spriteCanvas.onpointerdown = (e) => {
  if (recording) return;
  const a = asset();
  if (!a || a.type !== "sprite") return;
  const p = spriteCoords(e);
  let nearest = null,
    distance = 10;
  for (const [axis, cuts, v] of [
    ["x", a.xCuts, p.x],
    ["y", a.yCuts, p.y],
  ])
    for (let i = 0; i < cuts.length; i++) {
      const d = Math.abs(cuts[i] - v) * spriteZoom;
      if (d < distance) {
        distance = d;
        nearest = { axis, i };
      }
    }
  spriteDrag = { ...nearest, start: p, moved: false, cut: !!nearest };
  if (nearest) checkpoint();
  spriteCanvas.setPointerCapture(e.pointerId);
};
spriteCanvas.onpointermove = (e) => {
  const a = asset();
  if (!a || a.type !== "sprite") return;
  if (!spriteDrag) {
    const p = spriteCoords(e);
    let near = null;
    for (const [axis, cuts, v] of [
      ["x", a.xCuts, p.x],
      ["y", a.yCuts, p.y],
    ])
      if (cuts.some((c) => Math.abs(c - v) * spriteZoom < 8)) near = axis;
    spriteCanvas.style.cursor =
      near === "x" ? "ew-resize" : near === "y" ? "ns-resize" : "crosshair";
    return;
  }
  if (!spriteDrag.cut) return;
  const p = spriteCoords(e),
    key = spriteDrag.axis === "x" ? "xCuts" : "yCuts",
    arr = a[key],
    i = spriteDrag.i,
    limit = key === "xCuts" ? a.width : a.height;
  arr[i] = clamp(
    Math.round(p[spriteDrag.axis]),
    i ? arr[i - 1] + 1 : 0,
    i < arr.length - 1 ? arr[i + 1] - 1 : limit,
  );
  spriteDrag.moved = true;
  syncAsset(a);
  drawGrid();
  render();
};
function endSprite(e, cancel = false) {
  if (!spriteDrag) return;
  const a = asset(),
    d = spriteDrag;
  spriteDrag = null;
  if (d.cut) {
    renderInspector();
    changed();
    drawGrid();
  } else if (!cancel) {
    const p = spriteCoords(e),
      col = a.xCuts.findIndex(
        (v, i) => i < a.cols && p.x >= v && p.x < a.xCuts[i + 1],
      ),
      row = a.yCuts.findIndex(
        (v, i) => i < a.rows && p.y >= v && p.y < a.yCuts[i + 1],
      );
    if (col >= 0 && row >= 0) toggleFrame(a, row * a.cols + col);
  }
}
spriteCanvas.onpointerup = (e) => endSprite(e);
spriteCanvas.onpointercancel = (e) => endSprite(e, true);
function stageCoords(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * project.width,
    y: ((e.clientY - r.top) / r.height) * project.height,
  };
}
stage.onpointerdown = (e) => {
  if (recording) return;
  stop();
  const at = atTime(time);
  if (!at) return;
  sceneId = at.s.id;
  const pos = stageCoords(e);
  let hit = null;
  for (const l of [...at.s.layers].reverse()) {
    if (!l.visible) continue;
    const b = layerBox(stageCtx, l, at.s, at.local);
    if (
      b &&
      pos.x >= b.x &&
      pos.x <= b.x + b.w &&
      pos.y >= b.y &&
      pos.y <= b.y + b.h
    ) {
      hit = l;
      break;
    }
  }
  layerId = hit?.id || null;
  if (hit) {
    checkpoint();
    const targetTime = point === "end" ? at.s.duration - 0.0001 : 0;
    time = startOf(sceneId) + targetTime;
    drag = {
      x: pos.x,
      y: pos.y,
      startX: hit[point + "X"],
      startY: hit[point + "Y"],
    };
    stage.setPointerCapture(e.pointerId);
    stage.style.cursor = "grabbing";
  }
  renderInspector();
  renderTimeline();
  render();
};
stage.onpointermove = (e) => {
  if (!drag || recording) return;
  const l = layer();
  if (!l) return;
  const p = stageCoords(e);
  l[point + "X"] = clamp(
    drag.startX + ((p.x - drag.x) / project.width) * 100,
    -100,
    200,
  );
  l[point + "Y"] = clamp(
    drag.startY + ((p.y - drag.y) / project.height) * 100,
    -100,
    200,
  );
  if (!l.motion) {
    l[(point === "start" ? "end" : "start") + "X"] = l[point + "X"];
    l[(point === "start" ? "end" : "start") + "Y"] = l[point + "Y"];
  }
  render();
};
function endStage() {
  if (!drag) return;
  drag = null;
  stage.style.cursor = "default";
  renderInspector();
  renderTimeline();
  changed();
}
stage.onpointerup = endStage;
stage.onpointercancel = endStage;
function trackLabelWidth() {
  return innerWidth <= 730 ? 78 : 105;
}
function clipWidth(s) {
  return Math.max(65, s.duration * 40);
}
function visualDuration() {
  return project.scenes.reduce((n, s) => n + clipWidth(s), 0);
}
function xForTime(t) {
  let x = 0,
    start = 0;
  for (const s of project.scenes) {
    if (t <= start + s.duration)
      return x + clamp((t - start) / s.duration, 0, 1) * clipWidth(s);
    x += clipWidth(s);
    start += s.duration;
  }
  return x;
}
function timeForX(x) {
  let start = 0,
    offset = 0;
  for (const s of project.scenes) {
    if (x <= offset + clipWidth(s))
      return start + clamp((x - offset) / clipWidth(s), 0, 1) * s.duration;
    offset += clipWidth(s);
    start += s.duration;
  }
  return duration();
}
function renderTimeline() {
  const root = $("scene-clips");
  root.replaceChildren();
  for (const s of project.scenes) {
    const card = el("div", "scene-clip" + (s.id === sceneId ? " active" : ""));
    card.dataset.scene = s.id;
    card.style.width = clipWidth(s) - 3 + "px";
    card.tabIndex = 0;
    card.draggable = !recording;
    const thumb = el("canvas");
    thumb.width = 120;
    thumb.height = Math.round((120 * project.height) / project.width);
    drawScene(
      thumb.getContext("2d"),
      s,
      Math.min(0.4, s.duration / 2),
      thumb.width,
      thumb.height,
    );
    const info = el("div", "scene-clip-info");
    info.append(
      el("strong", null, s.name),
      el("small", null, s.duration.toFixed(1) + " s"),
    );
    card.append(thumb, info);
    card.onclick = () => selectScene(s.id);
    card.onkeydown = (e) => {
      if (e.key === "Enter") selectScene(s.id);
    };
    card.ondragstart = (e) =>
      e.dataTransfer.setData("application/spritelab-scene", s.id);
    card.ondragover = (e) => e.preventDefault();
    card.ondrop = (e) => {
      e.preventDefault();
      const fromId = e.dataTransfer.getData("application/spritelab-scene");
      if (!fromId) {
        const aid = e.dataTransfer.getData("application/spritelab-asset");
        if (aid) {
          sceneId = s.id;
          useAsset(aid);
        }
        return;
      }
      if (fromId === s.id || recording) return;
      const i = project.scenes.findIndex((v) => v.id === fromId),
        target = project.scenes.indexOf(s);
      if (i < 0) return;
      checkpoint();
      const [moved] = project.scenes.splice(i, 1);
      project.scenes.splice(target, 0, moved);
      sceneId = moved.id;
      time = startOf(moved.id);
      stop();
      refresh();
      changed();
    };
    const handle = el("span", "clip-resize", "⋮");
    handle.title = "Arrastra para cambiar duración";
    handle.onclick = (e) => e.stopPropagation();
    handle.ondragstart = (e) => {
      e.preventDefault();
      e.stopPropagation();
    };
    handle.onpointerdown = (e) => {
      if (recording) return;
      e.stopPropagation();
      e.preventDefault();
      stop();
      checkpoint();
      handle.setPointerCapture(e.pointerId);
      const x = e.clientX,
        original = s.duration;
      handle.onpointermove = (ev) => {
        s.duration = clamp(
          Math.round((original + (ev.clientX - x) / 40) * 10) / 10,
          0.5,
          600,
        );
        card.style.width = clipWidth(s) - 3 + "px";
        info.lastChild.textContent = s.duration.toFixed(1) + " s";
        time = clamp(time, 0, duration());
        render();
      };
      const end = () => {
        handle.onpointermove = null;
        refresh();
        changed();
      };
      handle.onpointerup = end;
      handle.onpointercancel = end;
    };
    card.append(handle);
    root.append(card);
  }
  const w = Math.max(
    visualDuration() + 40,
    $("timeline-scroll").clientWidth - trackLabelWidth(),
  );
  $("timeline-content").style.width = w + trackLabelWidth() + "px";
  const ruler = $("time-ruler");
  ruler.replaceChildren();
  const step = Math.max(1, Math.ceil(duration() / 65));
  for (let t = 0; t <= duration(); t += step) {
    const mark = el(
      "span",
      "ruler-mark",
      String(Math.floor(t / 60)).padStart(2, "0") +
        ":" +
        String(t % 60).padStart(2, "0"),
    );
    mark.style.left = xForTime(t) + "px";
    ruler.append(mark);
  }
  const audio = $("audio-clip");
  audio.replaceChildren();
  if (project.audio) {
    const a = asset(project.audio.assetId);
    if (a) {
      const block = el("div", "audio-block");
      block.style.width =
        Math.max(180, xForTime(Math.min(a.duration, duration()))) + "px";
      block.append(el("span", null, "♫ " + a.name));
      block.append(
        button("×", () => {
          checkpoint();
          project.audio = null;
          refresh();
          changed();
        }),
      );
      audio.append(block);
    }
  } else
    audio.append(
      button("＋ Añade música o narración", () => {
        libraryType = "audio";
        renderLibrary();
        $("asset-file").click();
      }),
    );
  $("timeline-info").textContent =
    project.scenes.length +
    " escenas · " +
    duration().toFixed(1) +
    " s · " +
    project.width +
    " × " +
    project.height;
  render();
}
$("time-ruler").onpointerdown = (e) => {
  if (recording) return;
  const r = $("time-ruler").getBoundingClientRect();
  seek(timeForX(e.clientX - r.left));
  const ruler = $("time-ruler");
  ruler.setPointerCapture(e.pointerId);
  ruler.onpointermove = (ev) => seek(timeForX(ev.clientX - r.left));
  ruler.onpointerup = () => (ruler.onpointermove = null);
  ruler.onpointercancel = ruler.onpointerup;
};
function refresh() {
  scheduleAnimation();
  $("project-name").value = project.name;
  $("scene-workspace").hidden = mode !== "scene";
  $("sprite-workspace").hidden = mode !== "sprite";
  $("scene-tab").classList.toggle("active", mode === "scene");
  $("sprite-tab").classList.toggle("active", mode === "sprite");
  renderLibrary();
  renderInspector();
  renderTimeline();
  render();
  requestAnimationFrame(() => {
    fitStage();
    if (mode === "sprite") spriteFit();
  });
  updateUndo();
}
function mobilePanel(name) {
  $("studio-layout").dataset.mobile = name;
  document
    .querySelectorAll("[data-panel]")
    .forEach((b) => b.classList.toggle("active", b.dataset.panel === name));
}
const videoTypes = [
  {
    name: "MP4 · compatible con redes sociales",
    mime: "video/mp4;codecs=avc1.42001E,mp4a.40.2",
    ext: "mp4",
  },
  {
    name: "MP4 · códec elegido por el navegador",
    mime: "video/mp4",
    ext: "mp4",
  },
  {
    name: "WebM · vídeo de alta calidad",
    mime: "video/webm;codecs=vp9,opus",
    ext: "webm",
  },
  {
    name: "WebM · compatible con este navegador",
    mime: "video/webm;codecs=vp8,opus",
    ext: "webm",
  },
  { name: "WebM", mime: "video/webm", ext: "webm" },
];
function availableVideo() {
  if (!window.MediaRecorder) return [];
  const seen = new Set();
  return videoTypes.filter((v) => {
    if (seen.has(v.ext) || !MediaRecorder.isTypeSupported(v.mime)) return false;
    seen.add(v.ext);
    return true;
  });
}
function resolutionFromForm() {
  const w = +$("output-width").value,
    h = +$("output-height").value,
    fps = +$("output-fps").value;
  if (
    !Number.isInteger(w) ||
    !Number.isInteger(h) ||
    w < 64 ||
    h < 64 ||
    w > 4096 ||
    h > 4096 ||
    w * h > 8388608 ||
    w % 2 ||
    h % 2
  )
    throw Error("Usa medidas pares de 64 a 4096 px, hasta 8,3 megapíxeles.");
  if (![24, 30, 60].includes(fps)) throw Error("Selecciona 24, 30 o 60 FPS.");
  return { w, h, fps };
}
function updateSummary() {
  if (!$("export-dialog").open) return;
  const w = +$("output-width").value,
    h = +$("output-height").value;
  $("export-summary").textContent =
    project.scenes.length +
    " escenas · " +
    duration().toFixed(1) +
    " s · " +
    w +
    " × " +
    h;
  $("export-video").disabled =
    recording || !project.scenes.length || !availableVideo().length;
}
function openExport() {
  if (recording) return;
  stop();
  $("quality-preset").value = "original";
  $("output-width").value = project.width;
  $("output-height").value = project.height;
  $("output-fps").value = project.fps;
  const select = $("video-format");
  select.replaceChildren();
  for (const type of availableVideo()) {
    const o = el("option", null, type.name);
    o.value = type.mime;
    o.dataset.ext = type.ext;
    select.append(o);
  }
  if (!select.options.length) {
    const o = el("option", null, "Vídeo no disponible en este navegador");
    select.append(o);
  }
  selectPreset();
  $("export-dialog").showModal();
  updateSummary();
}
function selectPreset() {
  const w = +$("output-width").value,
    h = +$("output-height").value;
  const preset =
    w === 1080 && h === 1920
      ? "vertical"
      : w === 1920 && h === 1080
        ? "horizontal"
        : w === 1080 && h === 1080
          ? "square"
          : "custom";
  document
    .querySelectorAll("[data-preset]")
    .forEach((b) =>
      b.classList.toggle("selected", b.dataset.preset === preset),
    );
}
function applyResolution() {
  const { w, h, fps } = resolutionFromForm();
  if (project.width !== w || project.height !== h || project.fps !== fps) {
    checkpoint();
    project.width = w;
    project.height = h;
    project.fps = fps;
    zoom = 0;
    refresh();
    changed();
  }
}
async function exportVideo() {
  if (recording || !project.scenes.length) return;
  let mime, ext;
  try {
    applyResolution();
    mime = $("video-format").value;
    ext = $("video-format").selectedOptions[0].dataset.ext;
    if (!MediaRecorder.isTypeSupported(mime))
      throw Error("Este formato no está disponible. Prueba otro navegador.");
  } catch (e) {
    toast(e.message);
    return;
  }
  stop();
  recording = true;
  cancelRecording = false;
  let stream,
    rec,
    source,
    gain,
    timer,
    abortReason = "";
  lastVideo = null;
  $("share-video").hidden = true;
  let wakeLock = null;
  const out = el("canvas");
  out.width = project.width;
  out.height = project.height;
  const x = out.getContext("2d");
  const controls = [
    ...$("export-dialog").querySelectorAll("button,input,select"),
  ].filter((e) => e.id !== "cancel-export");
  controls.forEach((e) => (e.disabled = true));
  $("cancel-export").hidden = false;
  $("export-progress").hidden = false;
  $("export-meter").value = 0;
  $("export-status").textContent = "Preparando…";
  $("studio-layout").inert = true;
  document.querySelector(".timeline").inert = true;
  document.querySelector(".app-header").inert = true;
  try {
    if (navigator.wakeLock)
      try {
        wakeLock = await navigator.wakeLock.request("screen");
      } catch {}
    const first = atTime(0);
    drawScene(x, first.s, 0, out.width, out.height);
    stream = out.captureStream(project.fps);
    const track = project.audio,
      a = track && asset(track.assetId);
    if (a) {
      const buffer = await decodeAudio(a.src);
      await audioContext.resume();
      source = audioContext.createBufferSource();
      source.buffer = buffer;
      gain = audioContext.createGain();
      gain.gain.value = track.volume / 100;
      const destination = audioContext.createMediaStreamDestination();
      source.connect(gain).connect(destination);
      destination.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
    }
    rec = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: Math.min(
        24000000,
        Math.max(2000000, project.width * project.height * project.fps * 0.12),
      ),
      audioBitsPerSecond: 128000,
    });
    const chunks = [],
      total = duration();
    const blob = await new Promise((resolve, reject) => {
      rec.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      rec.onerror = () =>
        reject(
          Error(
            "El navegador no pudo codificar este vídeo. Prueba WebM o una resolución menor.",
          ),
        );
      rec.onstop = () =>
        resolve(new Blob(chunks, { type: mime.split(";")[0] }));
      rec.start(1000);
      if (source) source.start();
      const started = performance.now();
      function step() {
        if (cancelRecording) {
          rec.stop();
          return;
        }
        if (document.hidden) {
          cancelRecording = true;
          abortReason =
            "La exportación se detuvo al ocultar la pestaña. Vuelve a exportar manteniéndola visible.";
          rec.stop();
          return;
        }
        const t = Math.min(total, (performance.now() - started) / 1000),
          at = atTime(t);
        drawScene(x, at.s, at.local, out.width, out.height);
        time = t;
        if (performance.now() - lastUIFrame > 200) {
          lastUIFrame = performance.now();
          render();
        }
        const pct = Math.min(100, Math.round((t / total) * 100));
        $("export-meter").value = pct;
        $("export-status").textContent =
          pct + "% · " + t.toFixed(1) + " / " + total.toFixed(1) + " s";
        if (t >= total) rec.stop();
        else timer = setTimeout(step, 1000 / project.fps);
      }
      step();
    });
    if (!cancelRecording) {
      lastVideo = { blob, name: cleanName() + "." + ext };
      $("share-video").hidden = false;
      download(blob, lastVideo.name);
      toast(
        "Película exportada en " +
          ext.toUpperCase() +
          ". Lista para compartir.",
      );
      $("export-dialog").close();
    } else
      toast(abortReason || "Exportación cancelada. Tu proyecto sigue intacto.");
  } catch (e) {
    toast(e.message);
  } finally {
    if (wakeLock) wakeLock.release().catch(() => {});
    clearTimeout(timer);
    if (rec && rec.state !== "inactive") rec.stop();
    if (source) {
      try {
        source.stop();
      } catch {}
      source.disconnect();
    }
    if (gain) gain.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    recording = false;
    $("studio-layout").inert = false;
    document.querySelector(".timeline").inert = false;
    document.querySelector(".app-header").inert = false;
    controls.forEach((e) => (e.disabled = false));
    $("cancel-export").hidden = true;
    $("export-progress").hidden = true;
    render();
    updateSummary();
    updateUndo();
  }
}
async function saveProject() {
  try {
    const revision = saveRevision;
    const blob = await projectIO("serialize", snapshot());
    download(blob, cleanName() + ".spritelab.json");
    savedRevision = revision;
    if (savedRevision === saveRevision) {
      $("save-status").textContent = "Proyecto descargado";
      $("save-status").classList.remove("unsaved");
    }
    toast("Proyecto descargado. Guárdalo para continuar en otro momento.");
  } catch (e) {
    toast(e.message);
  }
}
function validCuts(cuts, count, limit) {
  return (
    Array.isArray(cuts) &&
    cuts.length === count + 1 &&
    cuts.every(
      (v, i) =>
        Number.isFinite(v) &&
        v >= 0 &&
        v <= limit &&
        (!i || v - cuts[i - 1] >= 1),
    )
  );
}
function num(v, min, max) {
  return Number.isFinite(v) && v >= min && v <= max;
}
function text(v, max) {
  return typeof v === "string" && v.length <= max;
}
function color(v) {
  return typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v);
}
async function migrateLegacy(data) {
  const p = {
    version: 2,
    type: "spritelab-studio",
    name: "Mi película",
    width: 960,
    height: 540,
    fps: 30,
    assets: [],
    scenes: [],
    audio: null,
  };
  for (const old of data.scenes) {
    let a = p.assets.find((a) => a.src === old.source);
    if (!a) {
      const im = await makeImage(old.source);
      a = {
        id: uid(),
        type: "sprite",
        name: old.name || "Sprite",
        src: old.source,
        width: im.width,
        height: im.height,
        cols: old.cols,
        rows: old.rows,
        xCuts: old.xCuts,
        yCuts: old.yCuts,
        frames: old.frames,
        fps: old.fps,
      };
      p.assets.push(a);
    }
    const s = newScene(old.name);
    s.duration = old.duration;
    s.color = old.color;
    const l = newLayer(a);
    Object.assign(l, {
      scale: old.scale,
      startX: old.startX,
      startY: old.startY,
      endX: old.endX,
      endY: old.endY,
      motion: old.startX !== old.endX || old.startY !== old.endY,
    });
    s.layers.push(l);
    if (old.background) {
      let b = p.assets.find((a) => a.src === old.background);
      if (!b) {
        const im = await makeImage(old.background);
        b = {
          id: uid(),
          type: "background",
          name: "Fondo",
          src: old.background,
          width: im.width,
          height: im.height,
        };
        p.assets.push(b);
      }
      s.background = b.id;
    }
    p.scenes.push(s);
  }
  return p;
}
async function validateProject(data) {
  if (
    data.type === "spritelab-movie" &&
    data.version === 1 &&
    Array.isArray(data.scenes) &&
    data.scenes.length <= 100
  )
    data = await migrateLegacy(data);
  if (
    data.type !== "spritelab-studio" ||
    data.version !== 2 ||
    !text(data.name, 80) ||
    !Number.isInteger(data.width) ||
    !Number.isInteger(data.height) ||
    !num(data.width, 64, 4096) ||
    !num(data.height, 64, 4096) ||
    data.width * data.height > 8388608 ||
    data.width % 2 ||
    data.height % 2 ||
    ![24, 30, 60].includes(data.fps) ||
    !Array.isArray(data.assets) ||
    data.assets.length > 80 ||
    !Array.isArray(data.scenes) ||
    data.scenes.length > 100
  )
    throw Error("Proyecto no compatible o dimensiones no válidas.");
  const ids = new Set();
  let totalPixels = 0;
  for (const a of data.assets) {
    if (
      !text(a.id, 100) ||
      ids.has(a.id) ||
      !text(a.name, 80) ||
      typeof a.src !== "string" ||
      a.src.length > 30000000
    )
      throw Error("Recurso de proyecto no válido.");
    ids.add(a.id);
    if (a.type === "audio") {
      if (
        !/^data:audio\/[a-z0-9.+-]+(;[^,]*)?;base64,/i.test(a.src) ||
        !num(a.duration, 0, 86400)
      )
        throw Error("Audio no válido.");
    } else if (["sprite", "background"].includes(a.type)) {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(a.src))
        throw Error("Imagen no válida.");
      const im = await makeImage(a.src);
      if (im.width !== a.width || im.height !== a.height)
        throw Error("Dimensiones de recurso no válidas.");
      totalPixels += im.width * im.height;
      if (totalPixels > 134217728)
        throw Error("El proyecto supera 128 megapíxeles de recursos.");
      if (
        a.type === "sprite" &&
        (!Number.isInteger(a.cols) ||
          !Number.isInteger(a.rows) ||
          a.cols < 1 ||
          a.rows < 1 ||
          a.cols > 64 ||
          a.rows > 64 ||
          a.cols * a.rows > 256 ||
          !validCuts(a.xCuts, a.cols, a.width) ||
          !validCuts(a.yCuts, a.rows, a.height) ||
          !Array.isArray(a.frames) ||
          !a.frames.length ||
          a.frames.length > 256 ||
          !a.frames.every(
            (i) => Number.isInteger(i) && i >= 0 && i < a.cols * a.rows,
          ) ||
          !num(a.fps, 1, 60))
      )
        throw Error("Rejilla no válida.");
    } else throw Error("Tipo de recurso desconocido.");
  }
  const sceneIds = new Set(),
    layerIds = new Set();
  for (const s of data.scenes) {
    if (
      !text(s.id, 100) ||
      sceneIds.has(s.id) ||
      !text(s.name, 80) ||
      !num(s.duration, 0.5, 600) ||
      !color(s.color) ||
      !["cut", "fade"].includes(s.transition) ||
      !Array.isArray(s.layers) ||
      s.layers.length > 80 ||
      (s.background &&
        !data.assets.some(
          (a) => a.id === s.background && a.type === "background",
        ))
    )
      throw Error("Escena no válida.");
    sceneIds.add(s.id);
    for (const l of s.layers) {
      if (
        !text(l.id, 100) ||
        layerIds.has(l.id) ||
        !text(l.name, 80) ||
        !num(l.scale, 1, 150) ||
        !num(l.opacity, 0, 100) ||
        !["startX", "startY", "endX", "endY"].every((k) =>
          num(l[k], -100, 200),
        ) ||
        !["sprite", "text"].includes(l.kind)
      )
        throw Error("Capa no válida.");
      layerIds.add(l.id);
      if (l.kind === "text") {
        if (!text(l.text, 500) || !color(l.color))
          throw Error("Texto no válido.");
      } else {
        const a = data.assets.find(
          (a) => a.id === l.assetId && a.type === "sprite",
        );
        if (
          !a ||
          !Number.isInteger(l.cols) ||
          !Number.isInteger(l.rows) ||
          l.cols < 1 ||
          l.rows < 1 ||
          l.cols * l.rows > 256 ||
          !validCuts(l.xCuts, l.cols, a.width) ||
          !validCuts(l.yCuts, l.rows, a.height) ||
          !num(l.fps, 1, 60) ||
          !Array.isArray(l.frames) ||
          !l.frames.length ||
          l.frames.length > 256 ||
          !l.frames.every(
            (i) => Number.isInteger(i) && i >= 0 && i < l.cols * l.rows,
          )
        )
          throw Error("Sprite de escena no válido.");
      }
    }
  }
  if (
    data.audio &&
    (!data.assets.some(
      (a) => a.id === data.audio.assetId && a.type === "audio",
    ) ||
      !num(data.audio.volume, 0, 100))
  )
    throw Error("Pista de audio no válida.");
  return data;
}
async function openProject(file) {
  if (!file || recording) return;
  try {
    if (file.size > 100 * 1024 * 1024) throw Error("El archivo supera 100 MB.");
    const data = await validateProject(await projectIO("parse", file));
    if (
      !(await confirmAction(
        "¿Abrir este proyecto?",
        "Se reemplazará el montaje actual. Puedes descargarlo antes o deshacer después.",
      ))
    )
      return;
    checkpoint();
    project = data;
    sceneId = project.scenes[0]?.id;
    layerId = null;
    assetId = project.assets.find((a) => a.type === "sprite")?.id;
    libraryType = "sprite";
    mode = "scene";
    time = 0;
    zoom = 0;
    stop();
    refresh();
    changed();
    toast("Proyecto abierto.");
  } catch (e) {
    toast(e.message || "No se pudo abrir el proyecto.");
  }
}
function buildDemo() {
  function canvas(w, h) {
    const c = el("canvas");
    c.width = w;
    c.height = h;
    return c;
  }
  const sheet = canvas(384, 48),
    x = sheet.getContext("2d");
  for (let i = 0; i < 8; i++) {
    const ox = i * 48,
      b = Math.round(Math.sin((i * Math.PI) / 4) * 2),
      r = (a, y, w, h, color) => {
        x.fillStyle = color;
        x.fillRect(ox + a, y + b, w, h);
      };
    r(15, 8, 18, 5, "#3e5530");
    r(12, 13, 24, 23, "#3e5530");
    r(9, 18, 30, 13, "#3e5530");
    r(15, 11, 18, 23, "#b7d884");
    r(12, 18, 24, 13, "#b7d884");
    r(16, 16, 16, 18, "#dcebb3");
    r(15, 5, 5, 9, "#3e5530");
    r(28, 5, 5, 9, "#3e5530");
    r(16, 7, 3, 6, "#b7d884");
    r(29, 7, 3, 6, "#b7d884");
    r(17, 20, 3, i === 6 ? 1 : 4, "#354b29");
    r(28, 20, 3, i === 6 ? 1 : 4, "#354b29");
    r(23, 25, 3, 2, "#718552");
    r(14, 25, 3, 2, "#e8bda0");
    r(32, 25, 3, 2, "#e8bda0");
    r(16, 35, 6, 4, "#3e5530");
    r(27, 35 + (i % 2), 6, 4, "#3e5530");
    r(8, 25 + (i % 3), 5, 5, "#3e5530");
    r(35, 25 - (i % 3), 5, 5, "#3e5530");
  }
  const heroSrc = sheet.toDataURL();
  images.set(heroSrc, sheet);
  const hero = {
    id: uid(),
    type: "sprite",
    name: "Mochi · Explorador",
    src: heroSrc,
    width: 384,
    height: 48,
    cols: 8,
    rows: 1,
    xCuts: Array.from({ length: 9 }, (_, i) => i * 48),
    yCuts: [0, 48],
    frames: Array.from({ length: 8 }, (_, i) => i),
    fps: 8,
  };
  project.assets.push(hero);
  function landscape(night) {
    const c = canvas(1600, 900),
      g = c.getContext("2d"),
      sky = g.createLinearGradient(0, 0, 0, 900);
    sky.addColorStop(0, night ? "#d8c6a4" : "#dce9c5");
    sky.addColorStop(1, night ? "#f1ddbc" : "#f0f1d5");
    g.fillStyle = sky;
    g.fillRect(0, 0, 1600, 900);
    g.fillStyle = night ? "#f9e5b2" : "#f6f4d6";
    g.beginPath();
    g.arc(
      night ? 1180 : 1210,
      night ? 300 : 185,
      night ? 110 : 84,
      0,
      Math.PI * 2,
    );
    g.fill();
    for (const [base, amp, col] of [
      [520, 85, night ? "#b6bb94" : "#b6cb91"],
      [640, 65, night ? "#8eaa83" : "#97b57a"],
      [770, 35, night ? "#73916a" : "#7e9e65"],
    ]) {
      g.beginPath();
      g.moveTo(0, 900);
      for (let x = 0; x <= 1600; x += 10)
        g.lineTo(x, base + Math.sin(x / 220 + base) * amp);
      g.lineTo(1600, 900);
      g.closePath();
      g.fillStyle = col;
      g.fill();
    }
    for (let i = 0; i < 14; i++) {
      const xx = i * 130 + 30,
        yy = 750 + Math.sin(i) * 45;
      g.fillStyle = night ? "#a6bb86" : "#b4cc8c";
      g.fillRect(xx, yy, 4, 15);
      g.fillRect(xx - 5, yy + 5, 14, 3);
    }
    const src = c.toDataURL();
    images.set(src, c);
    return {
      id: uid(),
      type: "background",
      name: night ? "Las colinas al atardecer" : "Un claro en el bosque",
      src,
      width: 1600,
      height: 900,
    };
  }
  const bg1 = landscape(false),
    bg2 = landscape(true);
  project.assets.push(bg1, bg2);
  const a = newScene("01 · El comienzo");
  a.background = bg1.id;
  const hero1 = newLayer(hero);
  Object.assign(hero1, {
    scale: 36,
    startX: 27,
    endX: 68,
    startY: 64,
    endY: 64,
    motion: true,
  });
  a.layers.push(hero1);
  const caption = {
    id: uid(),
    kind: "text",
    name: "El comienzo",
    text: "Toda gran historia…",
    color: "#4a6139",
    bold: true,
    shadow: false,
    scale: 5,
    startX: 50,
    startY: 19,
    endX: 50,
    endY: 19,
    opacity: 100,
    visible: true,
    motion: false,
  };
  a.layers.push(caption);
  const b = newScene("02 · La aventura");
  b.background = bg2.id;
  b.transition = "fade";
  const hero2 = newLayer(hero);
  Object.assign(hero2, {
    scale: 36,
    startX: 25,
    endX: 70,
    startY: 64,
    endY: 64,
    motion: true,
  });
  b.layers.push(hero2, {
    ...caption,
    id: uid(),
    name: "La aventura",
    text: "empieza con un pequeño paso.",
  });
  project.scenes.push(a, b);
  sceneId = a.id;
  assetId = hero.id;
}
function generatePrompt() {
  const count = +$("prompt-frames").value;
  $("prompt-output").value =
    `Crea una hoja de sprites PNG con fondo transparente real de ${$("prompt-character").value || "un personaje original"}. Animación: ${$("prompt-action").value || "caminar"}. Estilo: ${$("prompt-style").value}.\n\nDistribuye ${count} poses consecutivas en ${count} columnas y una sola fila, con celdas de 128 × 128 px (imagen total ${count * 128} × 128 px). Mantén idéntico personaje, proporciones, colores y escala. Alinea los pies a la misma altura y centra cada pose en su celda. Cada fotograma debe mostrar un pequeño avance del movimiento y formar un bucle fluido con el siguiente.\n\nNo añadas texto, números, rejillas, bordes ni márgenes entre celdas. No recortes ni superpongas las poses. Fondo alfa transparente, sin patrón de cuadros dibujado ni sombra exterior. Entrega la hoja completa como una sola imagen PNG.`;
}
$("project-name").onchange = () => {
  checkpoint();
  project.name = $("project-name").value.slice(0, 80) || "Mi historia";
  changed();
};
$("project-menu").onclick = () =>
  ($("project-popover").hidden = !$("project-popover").hidden);
document.addEventListener("pointerdown", (e) => {
  if (
    !$("project-popover").contains(e.target) &&
    e.target !== $("project-menu") &&
    !$("project-menu").contains(e.target)
  )
    $("project-popover").hidden = true;
});
$("save-project").onclick = () => {
  saveProject();
  $("project-popover").hidden = true;
};
$("load-project").onclick = () => {
  $("project-file").click();
  $("project-popover").hidden = true;
};
$("project-file").onchange = (e) => {
  openProject(e.target.files[0]);
  e.target.value = "";
};
$("new-project").onclick = async () => {
  if (
    !(await confirmAction(
      "¿Crear un proyecto vacío?",
      "Descarga tu proyecto actual para conservarlo. También podrás volver con Deshacer.",
    ))
  )
    return;
  checkpoint();
  stop();
  project = {
    version: 2,
    type: "spritelab-studio",
    name: "Mi nueva historia",
    width: 1920,
    height: 1080,
    fps: 30,
    assets: [],
    scenes: [],
    audio: null,
  };
  sceneId = layerId = assetId = null;
  time = 0;
  mode = "scene";
  libraryType = "sprite";
  zoom = 0;
  refresh();
  changed();
  $("project-popover").hidden = true;
};
$("help").onclick = () => {
  $("project-popover").hidden = true;
  $("help-dialog").showModal();
};
document.querySelectorAll("[data-close]").forEach(
  (b) =>
    (b.onclick = () => {
      if (!recording) $(b.dataset.close).close();
    }),
);
$("export-dialog").oncancel = (e) => {
  if (recording) e.preventDefault();
};
$("open-export").onclick = openExport;
$("aspect-button").onclick = openExport;
$("apply-resolution").onclick = () => {
  try {
    applyResolution();
    $("export-dialog").close();
    toast("Formato aplicado al proyecto.");
  } catch (e) {
    toast(e.message);
  }
};
$("export-video").onclick = exportVideo;
$("cancel-export").onclick = () => {
  cancelRecording = true;
};
document.querySelectorAll("[data-preset]").forEach(
  (b) =>
    (b.onclick = () => {
      const dims = {
        vertical: [1080, 1920],
        horizontal: [1920, 1080],
        square: [1080, 1080],
      }[b.dataset.preset];
      if (dims) {
        $("output-width").value = dims[0];
        $("output-height").value = dims[1];
      }
      document
        .querySelectorAll("[data-preset]")
        .forEach((v) => v.classList.toggle("selected", v === b));
      updateSummary();
    }),
);
for (const id of ["output-width", "output-height", "output-fps"])
  $(id).oninput = () => {
    selectPreset();
    updateSummary();
  };
$("ai-prompt").onclick = () => {
  generatePrompt();
  $("prompt-dialog").showModal();
};
for (const id of [
  "prompt-character",
  "prompt-action",
  "prompt-style",
  "prompt-frames",
])
  $(id).oninput = generatePrompt;
$("copy-prompt").onclick = async () => {
  try {
    await navigator.clipboard.writeText($("prompt-output").value);
    toast("Prompt copiado. Úsalo en ChatGPT o tu generador de imágenes.");
  } catch {
    $("prompt-output").select();
    toast("Selecciona y copia el prompt con Ctrl/⌘ C.");
  }
};
$("import-assets").onclick = () => $("asset-file").click();
$("asset-file").onchange = (e) => {
  const files = [...e.target.files];
  e.target.value = "";
  importFiles(files);
};
document
  .querySelectorAll("[data-library]")
  .forEach((b) => (b.onclick = () => setLibrary(b.dataset.library)));
$("library-panel").ondragover = (e) => {
  e.preventDefault();
  $("library-panel").classList.add("drop-active");
};
$("library-panel").ondragleave = (e) => {
  if (!$("library-panel").contains(e.relatedTarget))
    $("library-panel").classList.remove("drop-active");
};
$("library-panel").ondrop = (e) => {
  e.preventDefault();
  $("library-panel").classList.remove("drop-active");
  if (e.dataTransfer.files.length) importFiles([...e.dataTransfer.files]);
};
$("stage-viewport").ondragover = (e) => {
  e.preventDefault();
  $("stage-viewport").classList.add("drop-active");
};
$("stage-viewport").ondragleave = (e) => {
  if (!$("stage-viewport").contains(e.relatedTarget))
    $("stage-viewport").classList.remove("drop-active");
};
$("stage-viewport").ondrop = (e) => {
  e.preventDefault();
  $("stage-viewport").classList.remove("drop-active");
  const id = e.dataTransfer.getData("application/spritelab-asset");
  if (id) useAsset(id);
  else if (e.dataTransfer.files.length)
    importFiles([...e.dataTransfer.files], "sprite");
};
$("mobile-properties").onclick = () => mobilePanel("inspector");
$("quality-preset").onchange = () => {
  const short = +$("quality-preset").value;
  if (!short) return;
  const w = +$("output-width").value,
    h = +$("output-height").value,
    r = w / h;
  if (w > h) {
    $("output-height").value = short;
    $("output-width").value = Math.round((short * r) / 2) * 2;
  } else {
    $("output-width").value = short;
    $("output-height").value = Math.round(short / r / 2) * 2;
  }
  selectPreset();
  updateSummary();
};
$("scene-tab").onclick = () => {
  mode = "scene";
  refresh();
};
$("sprite-tab").onclick = () => {
  if (asset()?.type !== "sprite")
    assetId = project.assets.find((a) => a.type === "sprite")?.id;
  mode = "sprite";
  spriteZoom = 0;
  refresh();
};
$("add-sprite-scene").onclick = () => useAsset(assetId);
$("expand-editor").onclick = () => {
  document.body.classList.toggle("expanded");
  $("expand-editor").title = document.body.classList.contains("expanded")
    ? "Restaurar espacio de trabajo"
    : "Ampliar espacio de trabajo";
  requestAnimationFrame(() => {
    fitStage();
    if (mode === "sprite") {
      spriteZoom = 0;
      spriteFit();
    }
  });
};
$("zoom-in").onclick = () => {
  const current = zoom || $("stage-box").clientWidth / project.width;
  zoom = clamp(current * 1.25, 0.02, 4);
  fitStage();
};
$("zoom-out").onclick = () => {
  const current = zoom || $("stage-box").clientWidth / project.width;
  zoom = clamp(current / 1.25, 0.02, 4);
  fitStage();
};
$("fit-stage").onclick = () => {
  zoom = 0;
  fitStage();
};
$("sprite-zoom-in").onclick = () => {
  spriteZoom = clamp(spriteZoom * 1.4, 0.02, 16);
  spriteFit();
};
$("sprite-zoom-out").onclick = () => {
  spriteZoom = clamp(spriteZoom / 1.4, 0.02, 16);
  spriteFit();
};
$("sprite-fit").onclick = () => {
  spriteZoom = 0;
  spriteFit();
};
$("play").onclick = togglePlay;
$("go-start").onclick = () => seek(0);
$("step-frame").onclick = () => seek(time + 1 / project.fps);
$("add-text").onclick = addText;
$("add-scene").onclick = addScene;
$("empty-add-scene").onclick = addScene;
document.querySelectorAll("[data-panel]").forEach(
  (b) =>
    (b.onclick = () => {
      mobilePanel(b.dataset.panel);
      requestAnimationFrame(() => {
        fitStage();
        if (mode === "sprite") spriteFit();
      });
    }),
);
window.addEventListener("keydown", (e) => {
  const input = ["INPUT", "SELECT", "TEXTAREA"].includes(
      document.activeElement.tagName,
    ),
    dialog = document.querySelector("dialog[open]");
  if (recording || dialog) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
    e.preventDefault();
    saveProject();
    return;
  }
  if (!input && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    $(e.shiftKey ? "redo" : "undo").click();
    return;
  }
  if (input) return;
  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
  }
  if ((e.key === "Delete" || e.key === "Backspace") && layer()) {
    e.preventDefault();
    deleteLayer();
  }
  if (e.key === "Escape" && document.body.classList.contains("expanded"))
    $("expand-editor").click();
});
new ResizeObserver(() => {
  if (mode === "scene") fitStage();
}).observe($("stage-viewport"));
window.addEventListener("beforeunload", (e) => {
  if (recording || saveRevision !== savedRevision) {
    e.preventDefault();
    e.returnValue = "";
  }
});
let ioWorker = null,
  ioCounter = 0;
const ioJobs = new Map();
function projectIO(task, payload) {
  return new Promise((resolve, reject) => {
    try {
      if (!ioWorker) {
        ioWorker = new Worker("./project-worker.js");
        ioWorker.onmessage = ({ data }) => {
          const job = ioJobs.get(data.id);
          if (!job) return;
          ioJobs.delete(data.id);
          clearTimeout(job.timer);
          data.error ? job.reject(Error(data.error)) : job.resolve(data.result);
        };
        ioWorker.onerror = () => {
          for (const job of ioJobs.values()) {
            clearTimeout(job.timer);
            job.reject(Error("No se pudo procesar el proyecto."));
          }
          ioJobs.clear();
          ioWorker.terminate();
          ioWorker = null;
        };
      }
      const id = ++ioCounter,
        timer = setTimeout(() => {
          ioJobs.delete(id);
          reject(Error("El proyecto tardó demasiado en procesarse."));
        }, 60000);
      ioJobs.set(id, { resolve, reject, timer });
      ioWorker.postMessage({ id, task, payload });
    } catch {
      if (task === "serialize")
        resolve(
          new Blob([JSON.stringify(payload)], { type: "application/json" }),
        );
      else payload.text().then(JSON.parse).then(resolve, reject);
    }
  });
}
function init() {
  buildDemo();
  refresh();
  scheduleAnimation();
  $("save-status").innerHTML = "<i></i> Solo en tu navegador";
  if ("serviceWorker" in navigator && location.protocol !== "file:")
    window.addEventListener("load", () =>
      navigator.serviceWorker.register("./sw.js").catch(() => {}),
    );
}
$("share-video").onclick = async () => {
  if (!lastVideo) return;
  const file = new File([lastVideo.blob], lastVideo.name, {
    type: lastVideo.blob.type,
  });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], title: project.name });
    } else {
      download(lastVideo.blob, lastVideo.name);
      toast("Vídeo descargado. Ya puedes compartirlo desde tus archivos.");
    }
  } catch (e) {
    if (e.name !== "AbortError")
      toast("No se pudo compartir. Descarga el vídeo para compartirlo.");
  }
};
init();
