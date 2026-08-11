// `test-support` compiles under the Node tsconfig, which carries no Cloudflare
// globals, so the binding type is imported rather than taken from `Env`.
import type { D1Database } from "@cloudflare/workers-types";
import { expect } from "vitest";

/**
 * Applies a migration file to a workerd test D1 instance.
 *
 * D1's `exec` takes one statement at a time, so the source is split on `;` —
 * except inside `CREATE TRIGGER … END;`, whose body legitimately contains
 * semicolons and would otherwise be cut into fragments that do not parse.
 */
export async function applyMigration(database: D1Database, source: string): Promise<void> {
  let statement = "";
  let inTrigger = false;
  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("CREATE TRIGGER ")) inTrigger = true;
    statement += `${line}\n`;
    if (!trimmed.endsWith(";") || (inTrigger && trimmed !== "END;")) continue;
    await database.exec(statement.replace(/\s+/g, " "));
    statement = "";
    inTrigger = false;
  }
  expect(statement.trim()).toBe("");
}
