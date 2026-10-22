/**
 * Rows as a plain-text table for a terminal or an agent's context (jh sql). Cells are one line
 * (newlines shown as ⏎) and cut to `width` characters unless `width` is 0.
 */
export function table(rows: Record<string, unknown>[], width = 60): string {
  if (!rows.length) return "(0 rows)";
  const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))];
  const cell = (v: unknown) => {
    const text = v === null || v === undefined ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    const line = text.replace(/\r?\n/g, "⏎");
    return width && line.length > width ? `${line.slice(0, width - 1)}…` : line;
  };
  const grid = rows.map((r) => columns.map((c) => cell(r[c])));
  const widths = columns.map((c, i) => Math.max(c.length, ...grid.map((g) => g[i]!.length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i]!)).join(" | ").trimEnd();
  return [line(columns), widths.map((w) => "-".repeat(w)).join("-+-"), ...grid.map(line), `(${rows.length} row${rows.length === 1 ? "" : "s"})`].join("\n");
}
