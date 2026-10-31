import test from "node:test";
import assert from "node:assert/strict";
import {
  getReplyWordLimit,
  getReplyTokenLimit,
  limitConversationalReply,
  sanitizeAssistantText,
  toSpeechText
} from "../src/response-utils.js";

test("removes markdown URLs while preserving their labels", () => {
  const text = "Boston made the move. ([boston.com](https://www.boston.com/sports/story?utm_source=openai))";
  assert.equal(sanitizeAssistantText(text), "Boston made the move.");
});

test("removes bare domains and leaked citation markers", () => {
  const text = "It happened yesterday.(bostonsportsjournal.com) That is my take.citeturn0search";
  const cleaned = sanitizeAssistantText(text);
  assert.equal(cleaned, "It happened yesterday. That is my take.");
  assert.doesNotMatch(cleaned, /(?:\.com|cite|turn0search)/i);
});

test("builds plain speech without headings or list markers", () => {
  const text = "### My take\n\n- Boston took the bigger risk.\n- Philly got the better player.";
  assert.equal(
    toSpeechText(text),
    "My take Boston took the bigger risk. Philly got the better player."
  );
});

test("keeps a conversational reply complete and within its word budget", () => {
  const text = [
    "Boston traded Brown for George and several picks.",
    "I understand wanting flexibility, but Boston gave up the younger and more dependable star.",
    "Philly won the immediate value, and Boston now needs those picks to become real players.",
    "This dangling thought never finished because the model ran out"
  ].join(" ");
  const limited = limitConversationalReply(text, 35);
  assert.equal(
    limited,
    "Boston traded Brown for George and several picks. I understand wanting flexibility, but Boston gave up the younger and more dependable star."
  );
  assert.match(limited, /[.!?…]$/u);
});

test("defaults normal conversation to 55 words", () => {
  assert.equal(getReplyWordLimit("when does the game start?"), 55);
});

test("allows longer detailed, procedural, and safety-sensitive answers", () => {
  assert.equal(getReplyWordLimit("give me a full breakdown"), 300);
  assert.equal(getReplyWordLimit("how do I configure the camera?"), 300);
  assert.equal(getReplyWordLimit("this is a medical emergency"), 300);
});

test("gives opinions enough room to reason and conclude naturally", () => {
  assert.equal(getReplyWordLimit("what do you think about that trade?"), 120);
  assert.equal(getReplyWordLimit("who won the deal in your opinion?"), 120);
  assert.equal(getReplyWordLimit("is it worth buying?"), 120);
});

test("gives complete lists and multi-part explanations expanded room", () => {
  const marioQuestion = "how many whistles are in Mario 3 and tell me where they are";
  assert.equal(getReplyWordLimit(marioQuestion), 300);
  assert.equal(getReplyTokenLimit(marioQuestion), 700);
  assert.equal(getReplyWordLimit("list every location and explain how to reach each one"), 300);
});

test("scales generation tokens with the expected answer shape", () => {
  assert.equal(getReplyTokenLimit("when does the game start?"), 180);
  assert.equal(getReplyTokenLimit("what do you think about the trade?"), 360);
  assert.equal(getReplyTokenLimit("explain all the steps"), 700);
});

test("keeps normal replies to three complete sentences within 55 words", () => {
  const text = [
    "Boston made a risky bet by trading the younger star.",
    "George can still help, but availability is the concern.",
    "The picks decide whether the move ages well.",
    "I would rather have Brown right now."
  ].join(" ");
  const limited = limitConversationalReply(text);
  assert.equal(
    limited,
    "Boston made a risky bet by trading the younger star. George can still help, but availability is the concern. The picks decide whether the move ages well."
  );
  assert.ok(limited.split(/\s+/u).length <= 55);
});

test("preserves a complete oversized sentence instead of cutting the thought", () => {
  const text = `${Array.from({ length: 60 }, (_, index) => `word${index + 1}`).join(" ")}.`;
  const limited = limitConversationalReply(text);
  assert.equal(limited.split(/\s+/u).length, 60);
  assert.match(limited, /\.$/u);
});
