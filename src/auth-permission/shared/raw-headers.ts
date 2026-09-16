/**
 * Counts occurrences of `headerName` in Node's `rawHeaders` (a flattened
 * name/value array), case-insensitively. Node folds a repeated header into a
 * single comma-joined value in `request.headers`, indistinguishable from one
 * legitimate value that happens to contain a comma — `rawHeaders` keeps each
 * occurrence separate so a genuinely repeated header can be rejected instead
 * of silently accepted as one value.
 */
export function countRawHeader(
  rawHeaders: readonly string[] | undefined,
  headerName: string,
): number {
  const headers = rawHeaders ?? [];
  let count = 0;
  for (let index = 0; index + 1 < headers.length; index += 2) {
    if (headers[index].toLowerCase() === headerName) {
      count += 1;
    }
  }
  return count;
}
