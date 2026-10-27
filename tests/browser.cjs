const { chromium, devices } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const out = path.join(__dirname, "../test-results");
fs.mkdirSync(out, { recursive: true });
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, "http://local").pathname;
  const file = path.join(
    __dirname,
    "../dist",
    pathname === "/" ? "index.html" : pathname,
  );
  if (!file.startsWith(path.resolve(__dirname, "../dist") + path.sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      {
        html: "text/html",
        js: "text/javascript",
        css: "text/css",
        png: "image/png",
        webmanifest: "application/manifest+json",
      }[file.split(".").pop()] || "application/octet-stream",
    );
    res.end(fs.readFileSync(file));
  } catch {
    res.writeHead(404).end();
  }
});

(async () => {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = "http://127.0.0.1:" + server.address().port + "/";
  const browser = await chromium.launch({
    executablePath:
      process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    headless: true,
    args: ["--no-sandbox"],
  });
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const page = await ctx.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.url().startsWith("http")) requests.push(r.url());
  });
  await page.goto(base);
  await page.waitForTimeout(500);
  assert.equal(
    await page.evaluate(() => animationId),
    null,
    "idle editor must not run RAF",
  );
  assert.equal(await page.evaluate(() => project.scenes.length), 2);
  // Sprite editor and a non-divisible PNG. No server uploads.
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1025;
    c.height = 129;
    const x = c.getContext("2d");
    for (let i = 0; i < 8; i++) {
      x.fillStyle = i % 2 ? "#638d43" : "#dded8b";
      x.fillRect(i * 128 + 16, 10, 90, 110);
    }
    return c.toDataURL().split(",")[1];
  });
  await page.setInputFiles("#asset-file", {
    name: "mi-sprite.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await page.waitForFunction(
    () => project.assets.length === 4 && mode === "sprite",
  );
  assert.equal(await page.evaluate(() => asset().cols), 8);
  await page.fill("#grid-cols", "8");
  await page.fill("#grid-rows", "1");
  await page
    .getByRole("button", { name: "Aplicar rejilla uniforme", exact: true })
    .click();
  const box = await page.locator("#sprite-canvas").boundingBox();
  const before = await page.evaluate(() => asset().xCuts[1]);
  await page.mouse.move(box.x + box.width / 8, box.y + box.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.15, box.y + box.height * 0.55);
  await page.mouse.up();
  assert.notEqual(await page.evaluate(() => asset().xCuts[1]), before);
  await page.click("#add-sprite-scene");
  assert.equal(await page.evaluate(() => scene().layers.length), 3);
  await page.selectOption("#layer-motion", "linear");
  await page.getByRole("button", { name: "Final", exact: true }).click();
  await page.fill("#position-x", "85");
  await page.locator("#position-x").dispatchEvent("change");
  assert.equal(await page.evaluate(() => layer().endX), 85);
  await page.click("#undo");
  assert.notEqual(await page.evaluate(() => scene().layers.at(-1).endX), 85);
  await page.click("#redo");
  assert.equal(await page.evaluate(() => scene().layers.at(-1).endX), 85);
  // Scene, multiple characters, text, positioning, and audio.
  await page.click("#add-scene");
  await page.locator(".asset-meta button").first().click();
  await page.click("#add-text");
  await page.fill("#layer-text", "Mi historia de prueba");
  await page.locator("#layer-text").dispatchEvent("change");
  assert.equal(
    await page.evaluate(() => layer().text),
    "Mi historia de prueba",
  );
  await page.evaluate(() => {
    project.scenes.forEach((s) => (s.duration = 0.5));
    time = 0;
    refresh();
  });
  const audio = Buffer.alloc(44 + 16000 * 2);
  audio.write("RIFF");
  audio.writeUInt32LE(audio.length - 8, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(audio.length - 44, 40);
  for (let i = 0; i < 16000; i++)
    audio.writeInt16LE(
      Math.round(Math.sin((i / 16000) * 440 * 2 * Math.PI) * 3000),
      44 + i * 2,
    );
  await page.click('[data-library="audio"]');
  await page.setInputFiles("#asset-file", {
    name: "voz.wav",
    mimeType: "audio/wav",
    buffer: audio,
  });
  await page.waitForFunction(() => !!project.audio);
  // Worker-backed file save and round trip.
  let download = page.waitForEvent("download");
  await page.click("#project-menu");
  await page.click("#save-project");
  await (await download).saveAs(path.join(out, "spritelab-roundtrip.json"));
  const saved = JSON.parse(
    fs.readFileSync(path.join(out, "spritelab-roundtrip.json"), "utf8"),
  );
  assert.equal(saved.scenes.length, 3);
  assert.equal(saved.assets.length, 5);
  await page.setInputFiles(
    "#project-file",
    path.join(out, "spritelab-roundtrip.json"),
  );
  await page.waitForSelector("#confirm-dialog[open]");
  await page.click("#confirm-ok");
  await page.waitForFunction(
    () => document.getElementById("toast").textContent === "Proyecto abierto.",
  );
  // Real video at two aspect ratios, including audio.
  await page.click("#open-export");
  await page.fill("#output-width", "320");
  await page.fill("#output-height", "180");
  await page.selectOption("#video-format", "video/mp4");
  download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("#export-video");
  await (await download).saveAs(path.join(out, "spritelab-landscape.mp4"));
  await page.waitForFunction(() => !recording);
  assert.equal(await page.evaluate(() => project.width), 320);
  await page.click("#open-export");
  await page.fill("#output-width", "180");
  await page.fill("#output-height", "320");
  await page.selectOption("#video-format", "video/webm;codecs=vp9,opus");
  download = page.waitForEvent("download", { timeout: 15000 });
  await page.click("#export-video");
  await (await download).saveAs(path.join(out, "spritelab-portrait.webm"));
  await page.waitForFunction(() => !recording);
  // Cancellation preserves the project and re-enables editing.
  await page.click("#open-export");
  await page.click("#export-video");
  await page.waitForFunction(() => recording);
  await page.click("#cancel-export");
  await page.waitForFunction(() => !recording);
  assert.equal(
    await page.locator("#studio-layout").evaluate((el) => el.inert),
    false,
  );
  await page.locator('[data-close="export-dialog"]').click();
  // The editor never calls an API or a third-party asset server.
  assert.ok(requests.every((url) => url.startsWith(base)));
  await page.evaluate(async () => {
    if (navigator.serviceWorker.controller) return;
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.waitForTimeout(300);
  assert.equal(
    await page.evaluate(() => project.assets.length),
    3,
    "reload must not restore private user projects",
  );
  await ctx.setOffline(true);
  await page.reload();
  assert.equal(await page.locator(".brand").textContent(), "SpriteLab STUDIO");
  await ctx.setOffline(false);
  await page.screenshot({
    path: path.join(out, "spritelab-desktop.png"),
    fullPage: true,
  });
  for (const width of [360, 390, 730]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      "mobile overflow " + width,
    );
    await page.click('[data-panel="library"]');
    await page.locator(".asset-card").first().click();
    await page.click("#mobile-properties");
    await page.fill("#grid-cols", "4");
    await page.fill("#grid-rows", "2");
    await page
      .getByRole("button", { name: "Aplicar rejilla uniforme", exact: true })
      .click();
    assert.equal(await page.evaluate(() => asset().rows), 2);
    await page.click('[data-panel="editor"]');
    await page.click("#add-sprite-scene");
    await page.click('[data-panel="inspector"]');
    await page.getByRole("button", { name: "Ver escena", exact: true }).click();
    const order = page.getByRole("button", {
      name: "Mover después →",
      exact: true,
    });
    if (await order.count()) await order.click();
    await page.click('[data-panel="editor"]');
    await page.screenshot({
      path: path.join(out, "spritelab-mobile-" + width + ".png"),
      fullPage: true,
    });
  }
  console.log(
    JSON.stringify({
      ok: true,
      errors,
      requests: requests.length,
      externalRequests: requests.filter((u) => !u.startsWith(base)),
    }),
  );
  assert.deepEqual(errors, []);
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
