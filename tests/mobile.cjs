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
  const desktop = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  });
  const errors = [];
  desktop.on("pageerror", (e) => errors.push(e.message));
  await desktop.goto(base);
  const original = await desktop.evaluate(() => ({
    other: JSON.stringify(project.scenes[1]),
    asset: project.assets[0].id,
    hero: project.assets[0].name,
    first: project.scenes[0].id,
  }));
  // This is the regression: removing a shared sprite must affect only one scene.
  await desktop
    .getByRole("button", {
      name: "Quitar de esta escena " + original.hero,
      exact: true,
    })
    .click();
  assert.equal(
    await desktop.evaluate(
      () => project.scenes[0].layers.filter((l) => l.kind === "sprite").length,
    ),
    0,
  );
  assert.equal(
    await desktop.evaluate(() => JSON.stringify(project.scenes[1])),
    original.other,
  );
  assert.equal(await desktop.evaluate(() => project.assets.length), 3);
  await desktop
    .getByRole("button", {
      name: "Añadir a la escena " + original.hero,
      exact: true,
    })
    .click();
  assert.equal(
    await desktop.evaluate(
      () => project.scenes[0].layers.filter((l) => l.kind === "sprite").length,
    ),
    1,
  );
  assert.equal(
    await desktop.evaluate(() => JSON.stringify(project.scenes[1])),
    original.other,
  );
  await desktop.getByRole("button", { name: "Duplicar", exact: true }).click();
  await desktop
    .getByRole("button", { name: "Quitar de la escena", exact: true })
    .click();
  assert.equal(
    await desktop.evaluate(
      () => project.scenes[0].layers.filter((l) => l.kind === "sprite").length,
    ),
    1,
  );
  assert.equal(
    await desktop.evaluate(() => JSON.stringify(project.scenes[1])),
    original.other,
  );
  // An in-use library resource is protected from deleting instances in other scenes.
  await desktop.locator(".asset-options summary").first().click();
  await desktop
    .getByRole("button", {
      name: "Eliminar de la biblioteca " + original.hero,
      exact: true,
    })
    .click();
  assert.equal(await desktop.evaluate(() => project.assets.length), 3);
  assert.equal(
    await desktop.evaluate(() => JSON.stringify(project.scenes[1])),
    original.other,
  );
  // Pixel assertions prove that z-order changes actually change what is rendered.
  for (const [name, color] of [
    ["rojo.png", "#ff0000"],
    ["azul.png", "#0000ff"],
  ]) {
    const data = await desktop.evaluate((color) => {
      const c = document.createElement("canvas");
      c.width = c.height = 32;
      const x = c.getContext("2d");
      x.fillStyle = color;
      x.fillRect(0, 0, 32, 32);
      return c.toDataURL().split(",")[1];
    }, color);
    await desktop.setInputFiles("#asset-file", {
      name,
      mimeType: "image/png",
      buffer: Buffer.from(data, "base64"),
    });
    await desktop.waitForFunction((name) => asset()?.name === name, name);
    await desktop.click("#add-sprite-scene");
  }
  const pixel = () =>
    desktop.evaluate(() =>
      Array.from(
        stageCtx.getImageData(
          Math.floor(stage.width * 0.5),
          Math.floor(stage.height * 0.58),
          1,
          1,
        ).data,
      ).slice(0, 3),
    );
  assert.deepEqual(await pixel(), [0, 0, 255]);
  await desktop
    .getByRole("button", { name: "Enviar atrás", exact: true })
    .first()
    .click();
  assert.deepEqual(await pixel(), [255, 0, 0]);
  await desktop
    .getByRole("button", { name: "Traer adelante", exact: true })
    .first()
    .click();
  assert.deepEqual(await pixel(), [0, 0, 255]);
  await desktop.getByRole("button", { name: "Al fondo", exact: true }).click();
  assert.deepEqual(await pixel(), [255, 0, 0]);
  await desktop.getByRole("button", { name: "Al frente", exact: true }).click();
  assert.deepEqual(await pixel(), [0, 0, 255]);
  assert.equal(
    await desktop.evaluate(() => JSON.stringify(project.scenes[1])),
    original.other,
  );
  await desktop.click("#undo");
  assert.deepEqual(await pixel(), [255, 0, 0]);
  await desktop.click("#redo");
  assert.deepEqual(await pixel(), [0, 0, 255]);
  for (const viewport of [
    { width: 360, height: 800 },
    { width: 390, height: 844 },
    { width: 844, height: 390 },
  ]) {
    const ctx = await browser.newContext({
      viewport,
      isMobile: true,
      hasTouch: true,
      acceptDownloads: true,
    });
    const p = await ctx.newPage();
    p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base);
    await p.waitForFunction(() => !!scene());
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await p.locator("#play").tap();
    await p.waitForFunction(() => playing);
    await p.locator('[data-panel="library"]').tap();
    assert.equal(
      await p.evaluate(() => playing),
      false,
      "switching tasks must pause playback",
    );
    await p.locator('[data-panel="editor"]').tap();
    const initial = await p.evaluate(() => ({
      revision: saveRevision,
      other: JSON.stringify(project.scenes[1]),
    }));
    // Navigation, editing and deleting must work with touch, not just drag/drop.
    await p.locator("#mobile-layers").tap();
    await p
      .getByRole("button", { name: "▧ · Mochi · Explorador", exact: true })
      .tap();
    await p.waitForFunction(() => !!layer());
    assert.equal(
      await p.evaluate(() => saveRevision),
      initial.revision,
      "selecting must not dirty the project",
    );
    await p.locator("#mobile-delete-layer").tap();
    assert.equal(
      await p.evaluate(
        () => scene().layers.filter((l) => l.kind === "sprite").length,
      ),
      0,
    );
    assert.equal(
      await p.evaluate(() => JSON.stringify(project.scenes[1])),
      initial.other,
    );
    await p.locator("#project-menu").tap();
    await p.locator("#mobile-undo").tap();
    await p.locator("#project-menu").tap();
    assert.equal(
      await p.evaluate(
        () => scene().layers.filter((l) => l.kind === "sprite").length,
      ),
      1,
    );
    await p.locator('[data-panel="library"]').tap();
    await p.locator(".asset-footer button").first().tap();
    await p.locator("#mobile-grid-cols").fill("4");
    await p.locator("#mobile-grid-rows").fill("2");
    await p.locator("#mobile-grid-form button[type=submit]").tap();
    assert.equal(await p.evaluate(() => asset().rows), 2);
    await p.locator("#mobile-grid-cols").fill("0");
    await p.locator("#mobile-grid-form button[type=submit]").tap();
    assert.equal(
      await p.evaluate(() => asset().cols),
      4,
      "invalid grid must not replace cuts",
    );
    await p.locator("#mobile-grid-cols").fill("8");
    await p.locator("#mobile-grid-rows").fill("1");
    await p.locator("#mobile-grid-form button[type=submit]").tap();
    await p.locator("#add-sprite-scene").tap();
    await p.locator("#mobile-order-layer").tap();
    await p.getByRole("button", { name: "Enviar atrás", exact: true }).click();
    assert.equal(
      await p.evaluate(() => scene().layers[0].id === layerId),
      false,
    );
    await p.locator("#close-layers-dialog").tap();
    await p.locator('[data-panel="timeline"]').tap();
    const first = await p.evaluate(() => project.scenes[0].id);
    await p
      .getByRole("button", {
        name: "Mover después 01 · El comienzo",
        exact: true,
      })
      .tap();
    assert.equal(await p.evaluate(() => project.scenes[1].id), first);
    const durationInput = p.getByRole("spinbutton", {
      name: "Duración de 01 · El comienzo",
      exact: true,
    });
    await durationInput.fill("2.5");
    await durationInput.press("Tab");
    assert.equal(
      await p.evaluate(
        () =>
          project.scenes.find((s) => s.name === "01 · El comienzo").duration,
      ),
      2.5,
    );
    await p.locator(".mobile-scene-open").first().tap();
    await p.locator("#open-export").tap();
    await p.locator('[data-preset="vertical"]').tap();
    await p.locator("#quality-preset").selectOption("480");
    await p.locator("#apply-resolution").tap();
    assert.equal(await p.evaluate(() => project.width), 480);
    assert.equal(await p.evaluate(() => project.height), 854);
    await p.screenshot({
      path: path.join(out, "mobile-new-" + viewport.width + ".png"),
      fullPage: true,
    });
    assert.equal(
      await p.evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    await ctx.close();
  }
  assert.deepEqual(errors, []);
  console.log(
    "PASS: shared sprite removal isolation, library protection, real pixel stacking, undo/redo and touch mobile flows (360/390/844).",
  );
  await browser.close();
  server.close();
})().catch((e) => {
  console.error(e);
  server.close();
  process.exit(1);
});
