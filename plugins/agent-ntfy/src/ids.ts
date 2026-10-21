// Herdr IDs use w/p/t prefixes with one or more alphanumeric characters.
// Keep legacy short IDs (w1:p1) and mixed tokens (wA1B2:pA1) valid.
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
