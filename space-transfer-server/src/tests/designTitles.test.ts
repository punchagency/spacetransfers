import { test } from "node:test";
import assert from "node:assert/strict";
import { freeTitle, normalizeTitle, titleKey } from "../utils/designTitles.js";

const taken = (...names: string[]) => new Set(names.map(titleKey));

test("a free name is kept as typed (tidied)", () => {
  assert.equal(freeTitle("  Summer   shirts ", taken("Other")), "Summer shirts");
});

test("names compare ignoring case and spacing", () => {
  assert.equal(freeTitle("sheet ONE", taken("Sheet  one")), "sheet ONE (2)");
});

test("a named sheet takes the next free number", () => {
  assert.equal(freeTitle("sheet one", taken("sheet one", "sheet one (2)")), "sheet one (3)");
});

test("a numbered name counts from its root", () => {
  assert.equal(freeTitle("sheet one (2)", taken("sheet one", "sheet one (2)")), "sheet one (3)");
});

test("untitled sheets are numbered without brackets", () => {
  assert.equal(freeTitle("", taken("Untitled gang sheet")), "Untitled gang sheet 2");
  assert.equal(freeTitle("Untitled gang sheet 2", taken("Untitled gang sheet", "untitled gang sheet 2")), "Untitled gang sheet 3");
});

test("normalizeTitle collapses whitespace and caps length", () => {
  assert.equal(normalizeTitle(" a \n b "), "a b");
  assert.equal(normalizeTitle("x".repeat(200)).length, 120);
});
