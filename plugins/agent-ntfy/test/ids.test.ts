import assert from "node:assert/strict";
import { test } from "node:test";
import { isPaneId, isTabId } from "../src/ids.ts";

test("Herdr 工作区、窗格和 Tab ID 支持字母数字，拒绝参数和控制字符", () => {
  for (const workspace of ["wP", "wAA", "w1", "w12", "wa", "wA1"]) {
    for (const token of ["1", "12", "S", "P", "AA", "a", "A1"]) {
      assert.equal(isPaneId(`${workspace}:p${token}`), true);
      assert.equal(isTabId(`${workspace}:t${token}`), true);
      assert.equal(isPaneId(`${workspace}:t${token}`), false);
      assert.equal(isTabId(`${workspace}:p${token}`), false);
    }
  }
  for (const value of [undefined, null, 1, {}, "", "--current", "w:p1", "wP:p", "wP:p-1",
    "wP:p1;echo secret", "wP:p1\n", "wP:p1\r", " wP:p1", "wP:p1 ", "wP:p1\u0000",
    "w/P:p1", "wP:p1:extra", "wP:t1\n", "wP:t1;echo secret",
    "wQ:pS\n", "wQ:tP\r", "wQ:pS;echo secret", "wQ:tP;echo secret",
    "wQ:pS/1", "wQ:tP_1", "wQ:p会话", "wQ:t", "wQ:t-1"]) {
    assert.equal(isPaneId(value), false, String(value));
    assert.equal(isTabId(value), false, String(value));
  }
});
