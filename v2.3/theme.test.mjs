import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("./src/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("./src/style.css", import.meta.url), "utf8");
const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");

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
  assert.match(css, /var\(--piece-glow\)/);
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

const catBlack = readFileSync(new URL("./assets/cat-black.webp", import.meta.url));
const catWhite = readFileSync(new URL("./assets/cat-white.webp", import.meta.url));

test("cat pieces use real transparent image assets", () => {
  for (const image of [catBlack, catWhite]) {
    assert.equal(image.toString("ascii", 0, 4), "RIFF");
    assert.equal(image.toString("ascii", 8, 12), "WEBP");
  }
  assert.match(app, /new URL\("\.\.\/assets\/cat-black\.webp\?v="\+CAT_IMAGE_VERSION,\s*import\.meta\.url\)/);
  assert.match(app, /new URL\("\.\.\/assets\/cat-white\.webp\?v="\+CAT_IMAGE_VERSION,\s*import\.meta\.url\)/);
  assert.match(app, /image\.onload=/);
  assert.match(app, /image\.onerror=/);
  assert.match(app, /image\.dataset\.catLoaded==="true"/);
  assert.match(app, /ctx\.drawImage\(image,\s*x-19,\s*y-19,\s*38,\s*38\)/);
  assert.match(html, /src="\.\/src\/app\.js\?v=20261028-cat-image-fix"/);
  assert.match(html, /cat-black\.webp\?v=20261028-cat-image-fix/);
  assert.match(html, /cat-white\.webp\?v=20261028-cat-image-fix/);
});
