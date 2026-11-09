/**
 * Neutralize spreadsheet formula injection (PO-15, issue #360). A cell whose
 * text starts with =, +, -, @ or a control character would be interpreted as
 * a formula by Sheets/Excel, so it is prefixed with a single quote that
 * forces text display. The underlying value is otherwise untouched.
 */
export function sanitizeCsvFormulaCell(value: string) {
  const trimmed = value.replace(/^[\t\r\n ]+/, "");
  if (/^[=+\-@|%]/.test(trimmed) || /[\u0000-\u0008\u000E-\u001F]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

function escapeCsvCell(value: string) {
  const safe = sanitizeCsvFormulaCell(value);
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }

  return safe;
}

export function toCsvRow(values: Array<string | number | null | undefined>) {
  return values
    .map((value) => {
      if (value === null || value === undefined) {
        return "";
      }

      return escapeCsvCell(String(value));
    })
    .join(",");
}

export function toCsvDocument(
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) {
  return [toCsvRow(headers), ...rows.map((row) => toCsvRow(row))].join("\n");
}
