import test from "node:test";
import assert from "node:assert/strict";
import {
  resolvedForm,
  cartoonPose,
  faceFrame,
  atlasCrop,
  headCrop,
  displayCaption,
} from "../public/presence-utils.js";

test("automatic presence closes up for conversation and rests quietly, while manual form wins", () => {
  assert.equal(resolvedForm("auto", "idle", 1000), "body");
  assert.equal(resolvedForm("auto", "listening"), "eyes");
  assert.equal(resolvedForm("auto", "idle", 100000), "eyes");
  assert.equal(resolvedForm("body", "speaking", 100000), "body");
});
test("working, sleeping and interacting have distinct readable cartoon poses", () => {
  assert.equal(cartoonPose({ state: "thinking" }), 10);
  assert.equal(cartoonPose({ state: "idle", quietFor: 70000 }), 2);
  assert.equal(cartoonPose({ state: "idle", reaction: "pet" }), 5);
  assert.equal(cartoonPose({ state: "idle", dragging: true }), 11);
  assert.notEqual(faceFrame("speaking", 0, 0.5), faceFrame("speaking", 0, 0));
});
test("all selected animation crops stay within the source atlas", () => {
  for (let i = 0; i < 12; i++) {
    const r = atlasCrop(i);
    assert.ok(r.x >= 0 && r.y >= 0 && r.w > 0 && r.h > 0);
    assert.ok(r.x + r.w <= 1448 && r.y + r.h <= 1086);
  }
  for (let i = 0; i < 4; i++) {
    const r = headCrop(i);
    assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.w <= 1254 && r.y + r.h <= 1254);
  }
  assert.throws(() => atlasCrop(12));
  assert.equal(displayCaption("Hello [[bye]]"), "Hello");
});
