'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

import { approveIncident, rejectIncident } from '@/app/(fleet)/fleet/i/[id]/review/actions';

/**
 * The two buttons that matter.
 *
 * Approving does not just call `bdata scraper approve` — it then re-runs the
 * collector and waits for verification, because approval is not success (see
 * `docs/DECISIONS.md`, "Verification caught a bug in Molt's own approve call").
 * That is why this can take longer than a click normally would, and why the
 * pending state says so rather than just spinning.
 *
 * The engine deliberately *throws* rather than transitioning the incident when
 * the underlying `bdata` call itself fails to run (as opposed to running and
 * proposing a bad fix) — see `Engine.decide`. An earlier version of this
 * component had no try/catch around that call, so the one time this fired for
 * real (a bundler-mangled CLI path — see `resolveCliEntry`), the click
 * produced no visible effect at all: the promise rejected, React discarded it,
 * and the incident was left stuck with nothing on screen to explain why.
 */
export function DecisionButtons({ incidentId }: { incidentId: string }) {
  const [pending, startTransition] = useTransition();
  const [action, setAction] = useState<'approve' | 'reject' | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const router = useRouter();

  function onApprove() {
    setAction('approve');
    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await approveIncident(incidentId);
        setResult(
          outcome.resolved
            ? { ok: true, message: 'Resolved — fill rates recovered. Collector ID unchanged.' }
            : {
                ok: false,
                message: `Approved, but verification found state "${outcome.state}" — not resolved.`,
              },
        );
      } catch (error) {
        setResult({
          ok: false,
          message: `Approve failed: ${error instanceof Error ? error.message : String(error)}. The incident is unchanged — safe to retry.`,
        });
      }
      router.refresh();
    });
  }

  function onReject() {
    setAction('reject');
    setResult(null);
    startTransition(async () => {
      try {
        const outcome = await rejectIncident(incidentId);
        setResult({
          ok: true,
          message: `Rejected. Incident is now "${outcome.state}" — run molt watch to try again.`,
        });
      } catch (error) {
        setResult({
          ok: false,
          message: `Reject failed: ${error instanceof Error ? error.message : String(error)}. The incident is unchanged — safe to retry.`,
        });
      }
      router.refresh();
    });
  }

  return (
    <div>
      <div className="flex gap-2.5">
        <button
          type="button"
          className="button button-primary"
          onClick={onApprove}
          disabled={pending}
        >
          {pending && action === 'approve' ? 'Approving & verifying…' : 'Approve fix'}
        </button>
        <button
          type="button"
          className="button button-danger"
          onClick={onReject}
          disabled={pending}
        >
          {pending && action === 'reject' ? 'Rejecting…' : 'Reject'}
        </button>
      </div>

      {pending && action === 'approve' && (
        <p className="faint mt-2.5 text-xs">
          Running <code className="pill">bdata scraper approve --auto-save</code>, then re-running
          the collector to verify the data actually recovered. This calls the real CLI and can take
          a little while.
        </p>
      )}

      {result && (
        <p
          className={`mt-3 text-[13px] ${result.ok ? 'text-[var(--good)]' : 'text-[var(--warn)]'}`}
        >
          {result.message}
        </p>
      )}
    </div>
  );
}
