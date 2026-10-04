import assert from "node:assert/strict";
import { test } from "node:test";
import { isPaneId, isTabId } from "../src/ids.ts";

test("Herdr ID 支持字母、多字母及旧数字工作区，拒绝参数和控制字符", () => {
  for (const workspace of ["wP", "wAA", "w1", "w12", "wa", "wA1"]) {
    assert.equal(isPaneId(`${workspace}:p1`), true);
    assert.equal(isTabId(`${workspace}:t12`), true);
    assert.equal(isPaneId(`${workspace}:t1`), false);
    assert.equal(isTabId(`${workspace}:p1`), false);
  }
  for (const value of [undefined, null, 1, {}, "", "--current", "w:p1", "wP:p", "wP:p-1",
    "wP:p1;echo secret", "wP:p1\n", "wP:p1\r", " wP:p1", "wP:p1 ", "wP:p1\u0000",
    "w/P:p1", "wP:p1:extra", "wP:t1\n", "wP:t1;echo secret"]) {
    assert.equal(isPaneId(value), false, String(value));
    assert.equal(isTabId(value), false, String(value));
  }
});
