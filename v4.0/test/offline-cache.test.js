import test from "node:test";import assert from "node:assert/strict";import {shouldPromptForUpdate} from "../src/offline-cache.js";
test("同一 Service Worker 版本只提示一次",()=>{assert.equal(shouldPromptForUpdate(true,"abc123","abc123"),false);assert.equal(shouldPromptForUpdate(true,"def456","abc123"),true);});
test("首次安装不提示刷新，缺少版本号也不提示",()=>{assert.equal(shouldPromptForUpdate(false,"abc123",""),false);assert.equal(shouldPromptForUpdate(true,"",""),false);});
