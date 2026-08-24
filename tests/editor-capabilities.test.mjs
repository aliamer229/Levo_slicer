import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/slicer-client.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const engineUrl = new URL("../node_modules/three-slicer/viewer/dist/Viewport.js", import.meta.url);

test("mobile and desktop controls target real editor actions", async () => {
  const [app, engine] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(engineUrl, "utf8"),
  ]);

  for (const id of ["add", "delete", "delete-all", "duplicate", "split", "onbed"]) {
    assert.ok(engine.includes(`id: "${id}"`), `engine action ${id} is missing`);
  }
  for (const testId of [
    "stl-input",
    "gizmo-move",
    "gizmo-rotate",
    "gizmo-scale",
    "gizmo-paint",
    "plate-add",
    "plate-del",
    "slice-current",
    "slice-all",
    "gcode-dl",
    "save-project",
    "undo",
    "redo",
    "layer-range",
  ]) {
    assert.ok(engine.includes(`data-testid\": \"${testId}`), `engine control ${testId} is missing`);
  }

  for (const testId of [
    "tool-delete",
    "tool-delete-all",
    "tool-duplicate",
    "tool-split",
    "tool-onbed",
    "gizmo-move",
    "gizmo-rotate",
    "gizmo-scale",
    "gizmo-paint",
    "plate-add",
    "save-project",
  ]) {
    assert.ok(app.includes(`\"${testId}\"`), `LEVO control ${testId} is not wired`);
  }
});

test("upload, export, sharing, and official print handoff are real actions", async () => {
  const app = await readFile(appUrl, "utf8");

  assert.match(app, /querySelector<HTMLInputElement>\('\[data-testid="stl-input"\]'\)/);
  assert.match(app, /new File\(\[gcode\], name, \{ type: "text\/x-gcode" \}\)/);
  assert.match(app, /downloadBlob\(file, file\.name\)/);
  assert.match(app, /const data: ShareData = \{ files: \[file\], title: file\.name \}/);
  assert.match(app, /await navigator\.share\(data\)/);
  assert.match(app, /triggerSlice\(true\)/);
  assert.match(app, /https:\/\/wiki\.bambulab\.com\/en\/software\/bambu-connect/);
  assert.match(app, /Bambu Connect or Bambu Studio/);
  assert.match(app, /Direct phone-to-printer networking needs an approved local Bambu bridge/);
});

test("mobile visual system uses solid surfaces and expandable controls", async () => {
  const [app, css] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(cssUrl, "utf8"),
  ]);

  assert.match(app, /className="mobile-tooltray"/);
  assert.match(app, /className="mobile-toolgrid"/);
  assert.match(app, /className="mobile-primarybar"/);
  assert.match(css, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 350px\)/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.doesNotMatch(css, /(?:linear|radial|conic)-gradient\(/i);
  assert.doesNotMatch(css, /backdrop-filter/i);
});

test("verified profiles and explicit capability boundaries stay present", async () => {
  const [app, engine] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(engineUrl, "utf8"),
  ]);

  for (const preset of [
    "Bambu Lab X2D 0.4 nozzle",
    "Bambu Lab H2D 0.4 nozzle",
    "0.12mm High Quality @BBL X2D",
    "0.20mm Standard @BBL H2D",
  ]) {
    assert.ok(app.includes(preset), `profile preset ${preset} is missing`);
  }

  for (const id of ["arrange", "orient", "cut", "boolean", "text", "measure", "varlayer"]) {
    assert.ok(engine.includes(`id: "${id}"`), `boundary tool ${id} is missing`);
  }
  assert.match(engine, /Auto arrange[^\n]+Not implemented/);
  assert.match(app, /Direct phone-to-printer networking needs an approved local Bambu bridge/);
});
