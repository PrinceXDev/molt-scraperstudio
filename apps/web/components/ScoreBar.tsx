/** A 0-100 health score as a horizontal bar, coloured by band. Same bands as the CLI's scoreBar. */
export function ScoreBar({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const colorClass =
    clamped >= 90
      ? 'text-[var(--good)]'
      : clamped >= 60
        ? 'text-[var(--warn)]'
        : 'text-[var(--bad)]';
  const barColorClass =
    clamped >= 90 ? 'bg-[var(--good)]' : clamped >= 60 ? 'bg-[var(--warn)]' : 'bg-[var(--bad)]';

  return (
    <div className="flex items-center gap-2.5">
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--line)]">
        <div className={`h-full rounded-full ${barColorClass}`} style={{ width: `${clamped}%` }} />
      </div>
      <span className={`mono min-w-7 text-right text-[13px] ${colorClass}`}>{clamped}</span>
    </div>
  );
}
