import assert from "node:assert/strict";
import { test } from "node:test";
import { isPaneId, isTabId } from "../src/ids.ts";

test("Herdr ID 支持多位字母数字工作区和窗格/Tab 编号", () => {
  for (const workspace of ["wP", "wAA", "w1", "w12", "wa", "wA1", "wa1B2"]) {
    for (const number of ["1", "12", "S", "P", "AA", "a", "A1", "A", "a1", "1A", "Az", "123", "a1B2"]) {
      assert.equal(isPaneId(`${workspace}:p${number}`), true, `${workspace}:p${number}`);
      assert.equal(isTabId(`${workspace}:t${number}`), true, `${workspace}:t${number}`);
      assert.equal(isPaneId(`${workspace}:t${number}`), false);
      assert.equal(isTabId(`${workspace}:p${number}`), false);
    }
  }
});

test("Herdr ID 拒绝参数、非法格式和控制字符", () => {
  for (const value of [undefined, null, 1, {}, "", "--current", "w:p1", "wP:p", "wP:p-1",
    "wP:p1;echo secret", "wP:p1\n", "wP:p1\r", " wP:p1", "wP:p1 ", "wP:p1\u0000",
    "w/P:p1", "wP:p1:extra", "wP:t1\n", "wP:t1;echo secret",
    "wQ:pS\n", "wQ:tP\r", "wQ:pS;echo secret", "wQ:tP;echo secret",
    "wQ:pS/1", "wQ:tP_1", "wQ:p会话", "wQ:t", "wQ:t-1",
    "wA1:A12", "wA1:123", "wA1:pA_", "wA1:pA-", "wA1:p中1", "wA1:pA1\n",
    "wA1:t", "wA1:tA_", "wA1:tA1\r", "wA1:tA1\u0000", "wA1:tA1;echo secret",
    "wA_1:pA1", "wA-1:tA1", "A1:pA1"]) {
    assert.equal(isPaneId(value), false, String(value));
    assert.equal(isTabId(value), false, String(value));
  }
});
