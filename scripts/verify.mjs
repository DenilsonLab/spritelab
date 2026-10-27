import { readFileSync, existsSync } from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";
const root = new URL("../", import.meta.url);
for (const name of ["app.js", "sw.js", "project-worker.js"]) {
  const code = readFileSync(new URL("dist/" + name, root), "utf8");
  new vm.Script(code, { filename: name });
  assert.ok(
    !/indexedDB|localStorage|sessionStorage|supabase|firebase/i.test(code),
    name + " must not persist user projects in a database",
  );
}
const html = readFileSync(new URL("dist/index.html", root), "utf8");
const css = readFileSync(new URL("dist/style.css", root), "utf8");
assert.ok(
  !/https?:\/\//.test(html + css),
  "production assets must be self-contained",
);
for (const match of html.matchAll(/(?:src|href)="(\.\/)?([^"#]+)"/g)) {
  const path = match[2];
  if (path === ".") continue;
  assert.ok(existsSync(new URL("dist/" + path, root)), "missing " + path);
}
const manifest = JSON.parse(
  readFileSync(new URL("dist/manifest.webmanifest", root)),
);
assert.equal(manifest.start_url, "./");
assert.equal(manifest.scope, "./");
for (const icon of manifest.icons)
  assert.ok(existsSync(new URL("dist/" + icon.src, root)));
assert.ok(html.includes('id="mobile-properties"'));
assert.ok(html.includes('id="share-video"'));
console.log(
  "PASS: JavaScript, static assets, offline manifest and no project database / external dependencies.",
);
