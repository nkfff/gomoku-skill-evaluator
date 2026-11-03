import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../src/style.css", import.meta.url), "utf8");
const themes = ["classic", "jade", "night", "cherry", "catcafe", "gold"];

function ruleBody(selector) {
  const marker = selector + "{";
  const start = css.indexOf(marker);
  if (start < 0) return "";
  const bodyStart = start + marker.length;
  const end = css.indexOf("}", bodyStart);
  return end < 0 ? "" : css.slice(bodyStart, end);
}

function themeRule(theme) {
  return ruleBody(`body[data-board-theme="${theme}"]`);
}

function token(rule, name) {
  return rule.match(new RegExp("--" + name + ":(#[0-9a-f]{6})", "i"))?.[1] ?? null;
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
  const caption = ruleBody(".board-caption");
  const status = ruleBody(".board-caption #status");
  const note = ruleBody(".caption-note");

  assert.ok(caption.includes("background:var(--surface,#faf5f1)"));
  assert.ok(caption.includes("color:var(--text,var(--v4-ink))"));
  assert.ok(caption.includes("border:1px solid var(--border,var(--v4-line))"));
  assert.ok(status.includes("color:var(--heading,var(--text,var(--v4-ink)))"));
  assert.ok(note.includes("color:var(--muted,var(--v4-muted))"));
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
