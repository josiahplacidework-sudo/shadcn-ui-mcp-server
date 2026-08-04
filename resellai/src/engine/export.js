/**
 * Inventory export.
 *
 * Produces RFC 4180 CSV so the file opens cleanly in Excel, Numbers, and Sheets — which means
 * quoting every field and doubling any embedded quotes. Item names routinely contain commas and
 * quotation marks (Nike Dunk Low "Panda"), so this is not a theoretical concern.
 */

const COLUMNS = [
  'Item',
  'Brand',
  'Category',
  'Condition',
  'Room',
  'Status',
  'Quick price',
  'Market price',
  'Patient price',
  'Sold for',
  'Best marketplace',
  'Estimated net',
  'Listed on',
  'Scanned',
];

export function escapeCsvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

/**
 * @param {Array<object>} rows  One object per inventory entry, keyed by the COLUMNS labels.
 * @returns {string} CSV text including a header row
 */
export function toCsv(rows) {
  const lines = [COLUMNS.map(escapeCsvField).join(',')];

  for (const row of rows) {
    lines.push(COLUMNS.map((column) => escapeCsvField(row[column])).join(','));
  }

  // A trailing newline keeps POSIX tools and spreadsheet importers happy.
  return `${lines.join('\r\n')}\r\n`;
}

export { COLUMNS };
