import assert from "node:assert/strict";
import test from "node:test";
import { renderSlides, splitSlides } from "./markdown.js";

test("splits Markdown on horizontal-rule lines", () => {
  assert.deepEqual(splitSlides("# One\n\n---\n\n# Two\n\n----\nThree"), [
    "# One",
    "# Two",
    "Three",
  ]);
});

test("does not split dashes inside content", () => {
  assert.deepEqual(splitSlides("hello --- world\n\n- item"), ["hello --- world\n\n- item"]);
});

test("renders one HTML section worth of content per slide", () => {
  const slides = renderSlides("# One\n\n---\n\n**Two**");
  assert.equal(slides.length, 2);
  assert.match(slides[0].html, /<h1>One<\/h1>/);
  assert.match(slides[1].html, /<strong>Two<\/strong>/);
});
