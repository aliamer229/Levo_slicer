import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const appUrl = new URL("../app/slicer-client.tsx", import.meta.url);
const cssUrl = new URL("../app/globals.css", import.meta.url);
const engineUrl = new URL("../node_modules/three-slicer/viewer/dist/Viewport.js", import.meta.url);
const archiveUrl = new URL("../app/archive-import.ts", import.meta.url);
const loadersUrl = new URL("../app/model-loaders.ts", import.meta.url);
const packingUrl = new URL("../app/plate-packing.ts", import.meta.url);

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

  assert.match(app, /dispatchEvent\(new Event\("change"/);
  assert.match(app, /className="native-file-input"/);
  assert.match(app, /data-supported-formats=\{FILE_PICKER_ACCEPT\}/);
  assert.doesNotMatch(app, /accept=\{FILE_PICKER_ACCEPT\}/);
  assert.match(app, /Object\.defineProperty\(engineInput, "files"/);
  assert.match(app, /typeof DataTransfer !== "function"/);
  assert.match(app, /new File\(\[gcode\], name, \{ type: "text\/x-gcode" \}\)/);
  assert.match(app, /downloadBlob\(file, file\.name\)/);
  assert.match(app, /const data: ShareData = \{ files: \[file\], title: file\.name \}/);
  assert.match(app, /await navigator\.share\(data\)/);
  assert.match(app, /triggerSlice\(true\)/);
  assert.match(app, /https:\/\/wiki\.bambulab\.com\/en\/software\/bambu-connect/);
  assert.match(app, /Bambu Connect or Bambu Studio/);
  assert.match(app, /devpartner@bambulab\.com/);
  assert.match(app, /undocumented private API/);
});

test("extended model loaders, streaming ZIP import, and no fixed app cap are wired", async () => {
  const [app, archive, loaders] = await Promise.all([
    readFile(appUrl, "utf8"),
    readFile(archiveUrl, "utf8"),
    readFile(loadersUrl, "utf8"),
  ]);

  for (const extension of ["step", "stp", "iges", "igs", "brep", "glb", "gltf", "fbx", "dae", "3ds", "wrl", "vrml", "off", "usdz", "kmz", "vtk", "vtp", "md2"]) {
    assert.ok(loaders.includes(`"${extension}"`), `loader extension ${extension} is missing`);
  }
  assert.match(loaders, /registerLoader\(/);
  assert.match(loaders, /occt-import-js\.wasm/);
  assert.match(archive, /new Unzip\(/);
  assert.match(archive, /file\.stream\(\)\.getReader\(\)/);
  assert.match(archive, /UnzipPassThrough/);
  assert.match(app, /LEVO sets no fixed file-size or count cap/);
  assert.doesNotMatch(app, /80 \* 1024 \* 1024|160 \* 1024 \* 1024|files\.length > 12/);
});

test("ZIP packing distributes models deterministically across plates", async () => {
  const source = await readFile(packingUrl, "utf8");
  const javascript = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const packingModule = await import(`data:text/javascript;base64,${Buffer.from(javascript).toString("base64")}`);
  const result = packingModule.packModelsAcrossPlates([
    { id: 1, width: 180, depth: 180 },
    { id: 2, width: 180, depth: 180 },
    { id: 3, width: 40, depth: 40 },
  ], 256, 256, 0, 9);
  assert.equal(result.placements.length, 3);
  assert.equal(result.platesUsed, 2);
  assert.equal(result.overflowCount, 0);
  assert.deepEqual(new Set(result.placements.map((placement) => placement.plate)), new Set([0, 1]));
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
  assert.match(app, /Direct cloud printing stays disabled until Bambu Lab provides approved-partner authorization/);
});
