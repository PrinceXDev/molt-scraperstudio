/** A coloured pill for a health status or incident state. Meaning is colour; text is the same word used everywhere else. */
export function Badge({ value }: { value: string }) {
  return <span className={`badge badge-${value}`}>{value.replace(/_/g, ' ')}</span>;
}
