import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalLabel,
  stableCounts,
  describeScene,
  getCountQuery,
  describeCount,
  mapBoxToCover,
  mirrorBoxHorizontally
} from "../public/vision-utils.js";

test("aliases map casual words onto detector labels", () => {
  assert.equal(canonicalLabel("people"), "person");
  assert.equal(canonicalLabel("sofa"), "couch");
  assert.equal(canonicalLabel("phones"), "cell phone");
  assert.equal(canonicalLabel("dog"), "dog");
});

test("stable counts ignore one flickering frame", () => {
  const frames = [
    ["person", "couch"],
    ["person", "couch", "dog"],
    ["person", "couch"],
    ["person", "couch"]
  ];
  const counts = stableCounts(frames);
  assert.equal(counts.get("person"), 1);
  assert.equal(counts.get("couch"), 1);
  assert.equal(counts.has("dog"), false);
});

test("stable counts keep consistently seen objects and median counts", () => {
  const frames = [
    ["person", "person", "cup"],
    ["person", "person", "cup"],
    ["person", "cup"]
  ];
  const counts = stableCounts(frames);
  assert.equal(counts.get("person"), 2);
  assert.equal(counts.get("cup"), 1);
});

test("scene descriptions read naturally and lead with people", () => {
  const one = new Map([["couch", 1]]);
  assert.equal(describeScene(one), "I can see one couch.");

  const two = new Map([["couch", 1], ["person", 2]]);
  assert.equal(describeScene(two), "I can see two people and one couch.");

  const three = new Map([["person", 1], ["couch", 1], ["tv", 1]]);
  assert.match(describeScene(three), /^I can see one person, .*, and .*\.$/u);
});

test("count questions extract the label being counted", () => {
  assert.equal(getCountQuery("how many people are behind me?"), "person");
  assert.equal(getCountQuery("how many dogs do you see"), "dog");
  assert.equal(getCountQuery("count the chairs"), "chair");
  assert.equal(getCountQuery("what's the weather"), null);
  assert.equal(getCountQuery("how many fingers am I holding up"), null);
});

test("count answers handle zero and one gracefully", () => {
  assert.equal(describeCount("person", 0), "I don't see any people right now.");
  assert.equal(describeCount("person", 1), "I can see one person.");
  assert.equal(describeCount("dog", 3), "I can see three dogs.");
});

test("cover mapping scales and crops like object-fit cover", () => {
  // 1280x720 video shown in a 190x119 pip: height-dominant crop.
  const box = { originX: 640, originY: 360, width: 128, height: 72 };
  const mapped = mapBoxToCover(box, 1280, 720, 190, 119);
  assert.ok(mapped);
  const scale = Math.max(190 / 1280, 119 / 720);
  assert.ok(Math.abs(mapped.width - 128 * scale) < 0.001);
  assert.ok(Math.abs(mapped.height - 72 * scale) < 0.001);
  assert.equal(mapBoxToCover(box, 0, 0, 190, 119), null);
});

test("mirrors detection boxes to match the selfie camera preview", () => {
  assert.deepEqual(
    mirrorBoxHorizontally({ x: 20, y: 10, width: 40, height: 30 }, 200),
    { x: 140, y: 10, width: 40, height: 30 }
  );
});
