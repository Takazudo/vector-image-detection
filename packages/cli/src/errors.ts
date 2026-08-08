/**
 * A CLI invocation problem the user can fix by changing their command line
 * (bad flag, missing/invalid file, refused confirmation gate, ...). Maps to
 * exit code 1. Any other thrown error is treated as a runtime failure and
 * maps to exit code 2 — see `run.ts`.
 */
export class CliUsageError extends Error {}
