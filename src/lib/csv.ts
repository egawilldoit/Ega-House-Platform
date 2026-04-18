function escapeCsvCell(value: string) {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
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
