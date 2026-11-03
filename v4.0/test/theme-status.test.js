import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const themes = ["classic", "jade", "night", "cherry", "catcafe", "gold"];

function themeRule(theme) {
  return css.match(new RegExp(`body\\[data-board-theme="${theme}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
}

function token(rule, name) {
  return rule.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})`, "i"))?.[1] ?? null;
}

function luminance(hex) {
  const channels = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  const linear = channels.map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("棋盘状态栏的背景、胜利文字和辅助文字跟随当前主题", () => {
  const caption = css.match(/\.board-caption\\s*\\{([^}]*)\\}/)?.[1] ?? "";
  const status = css.match(/\.board-caption\\s+#status\\s*\\{([^}]*)\\}/)?.[1] ?? "";
  const note = css.match(/\.caption-note\\s*\\{([^}]*)\\}/)?.[1] ?? "";

  assert.match(caption, /background:var\\(--surface,#faf5f1\\)/);
  assert.match(caption, /color:var\\(--text,var\\(--v4-ink\\)\\)/);
  assert.match(caption, /border:1px solid var\\(--border,var\\(--v4-line\\)\\)/);
  assert.match(status, /color:var\\(--heading,var\\(--text,var\\(--v4-ink\\)\\)\\)/);
  assert.match(note, /color:var\\(--muted,var\\(--v4-muted\\)\\)/);
});

test("六种棋盘主题的状态文字与状态栏背景达到 WCAG AA 对比度", () => {
  for (const theme of themes) {
    const rule = themeRule(theme);
    const surface = token(rule, "surface");
    const heading = token(rule, "heading");
    assert.ok(surface && heading, `${theme} 缺少状态栏主题色变量`);
    const ratio = contrastRatio(heading, surface);
    assert.ok(ratio >= 4.5, `${theme} 状态文字对比度不足：${ratio.toFixed(2)}:1`);
  }
});
