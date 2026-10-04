// Herdr workspace tokens may contain letters (wP, wAA) or legacy digits (w1).
// Match the entire value: RegExp's $ alone also accepts a trailing newline.
function matchesId(value: unknown, pattern: RegExp): value is string {
  return typeof value === "string" && value.match(pattern)?.[0] === value;
}

export function isPaneId(value: unknown): value is string {
  return matchesId(value, /^w[A-Za-z0-9]+:p[0-9]+$/);
}

export function isTabId(value: unknown): value is string {
  return matchesId(value, /^w[A-Za-z0-9]+:t[0-9]+$/);
}
