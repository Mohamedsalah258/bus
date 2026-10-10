/**
 * RFC 4180 CSV for Excel: UTF-8 BOM so Arabic opens correctly, CRLF lines,
 * quoted cells. Cells that start with = + - @ (or tab/CR) are prefixed with
 * an apostrophe so a spreadsheet never runs them as formulas (CSV injection).
 */
export function toCsv(headers: string[], rows: Array<Array<unknown>>) {
  const cell = (value: unknown) => {
    let text = value === null || value === undefined ? "" : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  };
  return (
    "\uFEFF" +
    [headers, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") +
    "\r\n"
  );
}
