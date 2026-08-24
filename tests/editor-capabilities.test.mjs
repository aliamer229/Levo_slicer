import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const appUrl = new URL("../app/slicer-client.tsx", import.meta.url);
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
    "gizmo-move",
    "gizmo-rotate",
    "gizmo-scale",
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
    "tool-add",
    "tool-delete",
    "tool-duplicate",
    "gizmo-move",
    "gizmo-rotate",
    "gizmo-scale",
    "plate-add",
    "save-project",
  ]) {
    assert.ok(app.includes(`\"${testId}\"`), `LEVO control ${testId} is not wired`);
  }
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
  assert.match(app, /Still disabled until the Bambu package and real-printer connection are verified/);
});
