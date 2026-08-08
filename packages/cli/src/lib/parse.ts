import { CliUsageError } from "../errors.js";

export function parsePositiveInt(value: string, flagName: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw new CliUsageError(`${flagName}: expected a positive integer, got "${value}"`);
  }
  return n;
}

export function parseThreshold(value: string, flagName = "--threshold"): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n < -1 || n > 1) {
    throw new CliUsageError(`${flagName}: expected a number in [-1, 1], got "${value}"`);
  }
  return n;
}
