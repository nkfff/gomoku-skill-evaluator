import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./src/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./src/style.css", import.meta.url), "utf8");

const boardThemes = ["classic", "jade", "night", "cherry", "catcafe", "gold"];
const pieceThemes = ["classic", "crystal", "ink", "neon", "pearl", "cat"];

test("every board skin has its own global page palette", () => {
  for (const id of boardThemes) {
    assert.match(css, new RegExp('body\\[data-board-theme="' + id + '"\\]'));
  }
});

test("every piece skin has a global accent palette and page ambience", () => {
  for (const id of pieceThemes) {
    const rule = css.match(new RegExp('body\\[data-piece-theme="' + id + '"\\]\\{([^}]*)\\}'));
    assert.ok(rule, "missing piece theme rule: " + id);
    assert.match(rule[1], /--accent:/);
    assert.match(rule[1], /--piece-glow:/);
  }
  assert.match(css, /var\\(--piece-glow\\)/);
});

test("equipped board and piece skins drive the page theme", () => {
  assert.match(app, /document\.body\.dataset\.boardTheme\s*=\s*skin\.id/);
  assert.match(app, /document\.body\.dataset\.pieceTheme\s*=\s*piece\.id/);
  assert.match(css, /body\[data-board-theme\] \.panel/);
  assert.match(css, /body\[data-board-theme\] button\.primary/);
});

test("skin previews keep their own swatch border colors", () => {
  assert.match(app, /style='background:/);
  assert.doesNotMatch(css, /\.skin \.swatch\{border-color:var\(--accent\)!important/);
});
