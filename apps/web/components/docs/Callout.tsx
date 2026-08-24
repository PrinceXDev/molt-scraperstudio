import type { ReactNode } from 'react';

import { AlertIcon, InfoIcon } from '@/components/icons';
import { cn } from '@/lib/cn';

/**
 * The three callout tones docs prose can reach for.
 *
 * `Note` for context that is easy to miss but not risky to miss; `Warning` for
 * something that costs time or credits if skipped; `Constraint` for a hard
 * limit of the platform or the tool that is not going away — the kind of fact
 * `CLAUDE.md` calls a "verified constraint". Three tones, not more: past three
 * a docs page starts looking like a hazard label rather than prose.
 */
export type CalloutTone = 'note' | 'warning' | 'constraint';

const TONE = {
  note: {
    icon: InfoIcon,
    label: 'Note',
    classes: 'border-info/30 bg-info-soft text-info',
  },
  warning: {
    icon: AlertIcon,
    label: 'Warning',
    classes: 'border-warn/35 bg-warn-soft text-warn',
  },
  constraint: {
    icon: AlertIcon,
    label: 'Constraint',
    classes: 'border-accent/35 bg-accent-soft text-accent',
  },
} as const satisfies Record<CalloutTone, { icon: typeof InfoIcon; label: string; classes: string }>;

function CalloutBase({ tone, children }: { tone: CalloutTone; children: ReactNode }) {
  const { icon: Icon, label, classes } = TONE[tone];

  return (
    <div className={cn('my-6 flex gap-3 rounded-md border px-4 py-3.5', classes)}>
      <Icon className="mt-0.5 shrink-0" />
      <div className="grid gap-1 text-[0.8125rem] leading-relaxed text-ink [&_p]:m-0 [&_p+p]:mt-2">
        <p className="font-mono text-[0.6875rem] font-semibold uppercase tracking-wider">{label}</p>
        {children}
      </div>
    </div>
  );
}

export const Note = ({ children }: { children: ReactNode }) => (
  <CalloutBase tone="note">{children}</CalloutBase>
);
export const Warning = ({ children }: { children: ReactNode }) => (
  <CalloutBase tone="warning">{children}</CalloutBase>
);
export const Constraint = ({ children }: { children: ReactNode }) => (
  <CalloutBase tone="constraint">{children}</CalloutBase>
);
