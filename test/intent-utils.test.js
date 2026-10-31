import test from "node:test";
import assert from "node:assert/strict";
import {
  getUiCommandIntent,
  getVisionIntent,
  isCloudStatusQuestion
} from "../public/intent-utils.js";

test("camera discussions do not activate camera hardware", () => {
  const examples = [
    "what are the best types of cameras",
    "what camera should we use for the robot",
    "what happens when I turn on the camera",
    "compare GoPro cameras for me"
  ];
  for (const example of examples) {
    assert.equal(getUiCommandIntent(example), null);
    assert.equal(getVisionIntent(example), null);
  }
});

test("only direct camera controls toggle the camera", () => {
  assert.equal(getUiCommandIntent("turn on the camera"), "camera_on");
  assert.equal(getUiCommandIntent("can you please turn the camera off?"), "camera_off");
});

test("explicit visual requests enter vision", () => {
  assert.equal(getVisionIntent("what am I looking at?"), "scene_glance");
  assert.equal(getVisionIntent("can you look at this?"), "scene");
  assert.equal(getVisionIntent("how many fingers am I holding up?"), "finger_count");
  assert.equal(getVisionIntent("what is this in my hand?"), "held_object");
});

test("conversational uses of look and vision remain conversation", () => {
  assert.equal(getVisionIntent("look, I think cameras are too expensive"), null);
  assert.equal(getVisionIntent("explain how computer vision works"), null);
});

test("API discussions do not become account-status replies", () => {
  assert.equal(isCloudStatusQuestion("what are the best AI API platforms"), false);
  assert.equal(isCloudStatusQuestion("explain how an API works"), false);
  assert.equal(isCloudStatusQuestion("what is my cloud usage"), true);
});
