/** Fixed-width plain-text table, columns padded to their widest cell (header included). */
export function formatTable(headers: string[], rows: string[][]): string {
  const widths = headers.map((header, i) =>
    Math.max(header.length, ...rows.map((row) => (row[i] ?? "").length)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((cell, i) => cell.padEnd(widths[i] ?? cell.length)).join("  ");
  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}
