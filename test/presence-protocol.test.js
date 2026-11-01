import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePresenceReply,
  normalizePresence,
  glitchAmount,
} from "../public/presence-protocol.js";
import { resolvedForm, cartoonPose } from "../public/presence-utils.js";

test("model appearance metadata is separated from the spoken answer", () => {
  const result = parsePresenceReply(
    "That’s interesting. [[presence:curious:face]]",
  );
  assert.equal(result.text, "That’s interesting.");
  assert.deepEqual(result.presence, { emotion: "curious", form: "face" });
});
test("unknown model appearance cannot become a native command", () => {
  const result = parsePresenceReply("Hi [[presence:happy:open_terminal]]");
  assert.equal(result.text, "Hi");
  assert.equal(result.presence, null);
  assert.deepEqual(normalizePresence({ emotion: "run_code", form: "shell" }), {
    emotion: "calm",
    form: "auto",
  });
});
test("model form choices influence automatic mode while manual choices remain authoritative", () => {
  assert.equal(resolvedForm("auto", "idle", 0, "eyes"), "eyes");
  assert.equal(resolvedForm("body", "idle", 0, "eyes"), "body");
  assert.notEqual(
    cartoonPose({ state: "idle", emotion: "happy" }),
    cartoonPose({ state: "idle", emotion: "focused" }),
  );
});
test("instant thinking cues do not wait for model inference and reduced motion disables glitches", () => {
  assert.equal(resolvedForm("auto", "thinking", 0, "auto", 200), "eyes");
  assert.equal(resolvedForm("auto", "thinking", 0, "auto", 3000), "body");
  assert.ok(glitchAmount(1000, 950, -1000) > 0);
  assert.equal(glitchAmount(1000, 950, -1000, true), 0);
});
