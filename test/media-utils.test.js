import test from "node:test";
import assert from "node:assert/strict";
import { extractYouTubeVideoId, parseMediaRequest } from "../src/media-utils.js";

test("recognizes free existing-photo requests separately from generation", () => {
  assert.deepEqual(parseMediaRequest("show me a photo of Saturn"), {
    type: "show_photo",
    query: "Saturn"
  });
  assert.equal(parseMediaRequest("generate an image of Saturn"), null);
});

test("recognizes YouTube links and topic searches", () => {
  assert.equal(
    extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
    "dQw4w9WgXcQ"
  );
  assert.deepEqual(parseMediaRequest("play https://youtu.be/dQw4w9WgXcQ"), {
    type: "play_youtube",
    videoId: "dQw4w9WgXcQ",
    query: ""
  });
  assert.deepEqual(parseMediaRequest("play a Mario 3 speedrun on YouTube"), {
    type: "play_youtube",
    videoId: "",
    query: "a Mario 3 speedrun"
  });
});

test("does not mistake normal conversation for media playback", () => {
  assert.equal(parseMediaRequest("show me how this works"), null);
  assert.equal(parseMediaRequest("what do you think about YouTube"), null);
});
