import test from "node:test";
import assert from "node:assert/strict";
import { inferResponseEmotion } from "../public/emotion-utils.js";

test("maps conversational meaning to varied face emotions", () => {
  assert.equal(inferResponseEmotion("I love that idea. That's genuinely exciting."), "joy");
  assert.equal(inferResponseEmotion("Wow, I did not expect that result."), "surprised");
  assert.equal(inferResponseEmotion("My take is Boston made the better move."), "confident");
  assert.equal(inferResponseEmotion("That's awful. I'm sorry you're dealing with it."), "sad");
  assert.equal(inferResponseEmotion("That is ridiculous and honestly annoying."), "angry");
  assert.equal(inferResponseEmotion("Interesting. What made you think of that?"), "curious");
});

test("keeps neutral statements calm and questions curious", () => {
  assert.equal(inferResponseEmotion("The game starts at eight tonight."), "calm");
  assert.equal(inferResponseEmotion("What happened after that?"), "curious");
});

test("uses BJ's conversational context when the reply wording is neutral", () => {
  assert.equal(
    inferResponseEmotion("Yeah, that came together nicely.", "I like how that looks now"),
    "warm"
  );
  assert.equal(
    inferResponseEmotion("You really walked into that one.", "Lmao okay you got me"),
    "joy"
  );
  assert.equal(
    inferResponseEmotion("Boston made the riskier bet.", "What's your opinion on the trade?"),
    "confident"
  );
  assert.equal(
    inferResponseEmotion("That sounds difficult.", "I've had a rough day"),
    "sad"
  );
});
