// Herdr workspace, pane and tab tokens may contain letters or digits (wQ:pS, wAA:tAB, w1:p1).
// Match the entire value: RegExp's $ alone also accepts a trailing newline.
function matchesId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.match(pattern)?.[0] === value;
}

export function isPaneId(value: unknown): value is string {
  return matchesId(value, /^w[A-Za-z0-9]+:p[A-Za-z0-9]+$/);
}

export function isTabId(value: unknown): value is string {
  return matchesId(value, /^w[A-Za-z0-9]+:t[A-Za-z0-9]+$/);
}
