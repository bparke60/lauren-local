import test from "node:test";
import assert from "node:assert/strict";
import {
  isLikelySpeechEcho,
  splitSpeechChunks,
  stripWakePhrase
} from "../public/speech-utils.js";

test("merges a tiny opener into the next sentence", () => {
  const chunks = splitSpeechChunks(
    "Yeah. Boston took a real gamble moving its best two-way player for an older star and future picks."
  );
  assert.deepEqual(chunks, [
    "Yeah. Boston took a real gamble moving its best two-way player for an older star and future picks."
  ]);
});

test("keeps a substantial first sentence fast and groups the rest", () => {
  const chunks = splitSpeechChunks(
    "Boston made a huge bet by moving Brown for an older, less dependable George and a stack of future picks. I get the flexibility angle, but Boston gave up the better player today. Philly won the immediate part of this unless those picks become something serious."
  );
  assert.equal(chunks.length, 2);
  assert.match(chunks[0], /^Boston made a huge bet/);
  assert.match(chunks[1], /^I get the flexibility angle/);
});

test("accepts normal speech without requiring a wake phrase", () => {
  assert.equal(stripWakePhrase("what happened with the trade?"), "what happened with the trade?");
});

test("treats a wake phrase as an optional prefix in the same utterance", () => {
  assert.equal(stripWakePhrase("Hey Lauren, what happened with the trade?"), "what happened with the trade?");
  assert.equal(stripWakePhrase("Lauren"), "");
});

test("recognizes Lauren hearing her own spoken sentence", () => {
  assert.equal(
    isLikelySpeechEcho(
      "Boston gave up the younger star",
      "My read is that Boston gave up the younger star and bet heavily on those picks."
    ),
    true
  );
});

test("does not mistake a user interruption for Lauren's echo", () => {
  assert.equal(
    isLikelySpeechEcho(
      "stop, what about the salary cap",
      "Boston gave up the younger star and bet heavily on future picks."
    ),
    false
  );
  assert.equal(isLikelySpeechEcho("stop talking", "Stop talking is a valid command."), false);
});
