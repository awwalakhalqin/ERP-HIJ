// Newest record first, everywhere.
//
// Rows are keyed by whichever creation stamp a table happens to carry, then by
// id as a tiebreaker, so a record created a moment ago is always the first row
// a user sees without having to sort anything.

type Recordish = {
  timestamp?: string;
  createdAt?: string;
  date?: string;
  tanggalMasuk?: string;
  id?: string;
};

function createdAtValue(row: Recordish): number {
  const stamp = row.timestamp || row.createdAt || row.date || row.tanggalMasuk;
  if (stamp) {
    const time = new Date(stamp).getTime();
    if (!isNaN(time)) return time;
  }
  return 0;
}

/** Sorts a copy of the list so the most recently created record leads. */
export function newestFirst<T extends Recordish>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const diff = createdAtValue(b) - createdAtValue(a);
    if (diff !== 0) return diff;
    // Same stamp (or none at all): fall back to the identifier, descending.
    return String(b.id || '').localeCompare(String(a.id || ''), 'id', { numeric: true });
  });
}
