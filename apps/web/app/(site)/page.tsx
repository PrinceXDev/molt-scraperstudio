import type { Metadata } from 'next';
import Link from 'next/link';

import { DriftGrid } from '@/components/site/DriftGrid';
import { Lede, Section } from '@/components/site/Section';
import { ArrowRightIcon, CheckIcon, CloseIcon, ExternalLinkIcon } from '@/components/icons';
import { buttonClasses } from '@/components/ui/Button';
import { CommandLine } from '@/components/ui/CodeBlock';
import { Reveal } from '@/components/ui/Reveal';
import { cn } from '@/lib/cn';
import { LANDING_SECTIONS, SITE } from '@/lib/site';

export const metadata: Metadata = {
  // The root layout's template would make this "Molt — Molt", so the landing
  // page opts out with an absolute title.
  title: { absolute: `${SITE.name} — ${SITE.tagline}` },
};

const TOTAL = LANDING_SECTIONS.length;

export default function LandingPage() {
  return (
    <>
      <Hero />
      <TheLie />
      <TheMissingMemory />
      <TheLoop />
      <TheHumanGate />
      <ThePlatform />
      <HonestLimits />
      <Closing />
    </>
  );
}

/* ------------------------------------------------------------------ hero */

function Hero() {
  return (
    <section className="relative overflow-hidden">
      {/*
       * The backdrop: a hairline grid faded out towards the bottom with a mask,
       * so it reads as graph paper the content sits on rather than as a texture
       * pasted behind it. Two CSS gradients and a mask -- no image, no canvas,
       * nothing to download.
       */}
      <div
        aria-hidden="true"
        className="bg-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:radial-gradient(ellipse_75%_60%_at_50%_0%,black,transparent)]"
      />

      <div className="relative mx-auto grid max-w-[1180px] gap-14 px-5 pt-16 pb-20 sm:px-6 sm:pt-24 sm:pb-28 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:gap-16">
        <div>
          <Reveal>
            <p className="inline-flex items-center gap-2.5 rounded-full border border-line bg-surface/70 px-3 py-1.5 font-mono text-eyebrow font-semibold uppercase text-muted backdrop-blur">
              <span className="size-1.5 rounded-full bg-accent" />
              {SITE.tagline} for {SITE.platform}
            </p>
          </Reveal>

          <Reveal delay={0.05}>
            <h1 className="mt-7 text-display-md font-semibold sm:text-display-lg">
              <span className="block text-muted">Your scraper didn&rsquo;t stop.</span>
              <span className="block text-ink">It started lying.</span>
            </h1>
          </Reveal>

          <Reveal delay={0.1}>
            <p className="prose-measure mt-6 text-[1rem] leading-relaxed text-muted">
              When a scraper breaks loudly, you find out. When a numeric field quietly starts
              returning <span className="font-mono text-ink">0</span> instead of its real value, it
              fills on every row, passes every null and schema check you own, and poisons everything
              downstream. Molt baselines what healthy looked like, catches the drift against it,
              writes the heal prompt from the measured evidence — and refuses to ship the fix until
              a human has seen the diff.
            </p>
          </Reveal>

          <Reveal delay={0.15}>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/fleet" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
                Open the cockpit
                <ArrowRightIcon />
              </Link>
              <Link href="/#how" className={buttonClasses({ variant: 'secondary', size: 'lg' })}>
                How it works
              </Link>
              <a
                href={SITE.repository}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: 'ghost', size: 'lg' })}
              >
                Read the code
                <ExternalLinkIcon />
              </a>
            </div>
          </Reveal>

          <Reveal delay={0.2}>
            <dl className="mt-12 flex flex-wrap gap-x-8 gap-y-4 border-t border-line-soft pt-6 font-mono text-[0.71875rem]">
              {[
                { value: '7', label: 'drift verdicts per field' },
                { value: '12', label: 'states in the incident machine' },
                { value: '0', label: 'fixes shipped without a human' },
              ].map((stat) => (
                <div key={stat.label} className="flex items-baseline gap-2">
                  <dt className="sr-only">{stat.label}</dt>
                  <dd className="text-[1.125rem] font-semibold text-ink">{stat.value}</dd>
                  <dd className="uppercase tracking-wider text-faint">{stat.label}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
        </div>

        <Reveal delay={0.1}>
          <DriftGrid />
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ 01 */

const CHECKS = [
  { name: 'null check', asks: 'did a value come back?', verdict: true },
  { name: 'schema validator', asks: 'is it the right type?', verdict: true },
  { name: 'uptime monitor', asks: 'did the page load?', verdict: true },
  { name: 'row-count alert', asks: 'did we get enough rows?', verdict: true },
  { name: 'heal preview', asks: 'did the fix return data?', verdict: true },
] as const;

function TheLie() {
  return (
    <Section
      id="lie"
      eyebrow="The failure nobody gates"
      index={1}
      total={TOTAL}
      kicker="silent breakage"
      leadIn="A field that returns zero is still a field."
      claim="Every check you own says it is fine."
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
        <Lede>
          On the chaos target Molt watches,{' '}
          <code className="font-mono text-ink">comment_count</code> went from a typical value of{' '}
          <span className="font-mono text-ink">60.5</span> to a typical value of{' '}
          <span className="font-mono text-ink">0</span>. Its fill rate never moved: it stayed at{' '}
          <span className="font-mono text-ink">100%</span>, because zero is a value. Nothing in an
          ordinary pipeline is looking at the number itself, so nothing objected — and this is the
          bug the project found in its own UI first, which is why the grid above refuses to print a
          percentage for a zeroed field.
        </Lede>

        <Reveal>
          <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
            {CHECKS.map((check) => (
              <div
                key={check.name}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line-soft px-4 py-3 last:border-b-0"
              >
                <span className="font-mono text-[0.75rem] text-ink">{check.name}</span>
                <span className="text-[0.78125rem] text-muted">{check.asks}</span>
                <span className="inline-flex w-full items-center justify-end gap-1.5 font-mono text-[0.71875rem] text-good sm:w-auto">
                  passed
                  <CheckIcon />
                </span>
              </div>
            ))}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-bad-soft px-4 py-3.5">
              <span className="font-mono text-[0.75rem] font-semibold text-ink">
                is the value still true?
              </span>
              <span className="text-[0.78125rem] text-muted">nobody asked</span>
              <span className="inline-flex w-full items-center justify-end gap-1.5 font-mono text-[0.71875rem] font-semibold text-bad sm:w-auto">
                no
                <CloseIcon />
              </span>
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 02 */

function TheMissingMemory() {
  return (
    <Section
      id="memory"
      eyebrow="The missing memory"
      index={2}
      total={TOTAL}
      kicker="baseline"
      leadIn="Your monitoring knows what just happened."
      claim="It does not know what normal was."
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_1fr] lg:gap-14">
        <Lede>
          You cannot detect drift without a memory to drift from. Every run Molt makes becomes a{' '}
          <strong className="font-semibold text-ink">snapshot</strong> — per field, its fill rate,
          its value shape and its typical magnitude. One snapshot is pinned as the{' '}
          <strong className="font-semibold text-ink">baseline</strong>, and every later run is
          classified against it field by field. That comparison is a pure function: the same two
          snapshots always produce the same verdict, which is why the detection rules are pinned by
          fixtures instead of tested against a live website.
        </Lede>

        <Reveal>
          <div className="grid gap-3">
            <StatRow
              field="comment_count"
              measure="typical value"
              before="60.5"
              after="0"
              verdict="zeroed"
              bad
            />
            <StatRow
              field="comment_count"
              measure="fill rate"
              before="100%"
              after="100%"
              verdict="unchanged"
            />
            <StatRow
              field="title"
              measure="fill rate"
              before="100%"
              after="100%"
              verdict="healthy"
              good
            />
            <p className="mt-1 font-mono text-[0.6875rem] leading-relaxed text-faint">
              Two rows describe the same field in the same run. Only the first one is a fault, and
              only a baseline makes it visible.
            </p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

function StatRow({
  field,
  measure,
  before,
  after,
  verdict,
  bad = false,
  good = false,
}: {
  field: string;
  measure: string;
  before: string;
  after: string;
  verdict: string;
  bad?: boolean;
  good?: boolean;
}) {
  return (
    <div
      className={cn(
        'grid grid-cols-[1fr_auto] items-center gap-x-4 gap-y-2 rounded-sm border px-4 py-3 sm:grid-cols-[1fr_auto_auto_auto]',
        bad ? 'border-bad/30 bg-bad-soft' : 'border-line bg-surface',
      )}
    >
      <div className="min-w-0">
        <p className="truncate font-mono text-[0.75rem] text-ink">{field}</p>
        <p className="text-[0.6875rem] text-faint">{measure}</p>
      </div>
      <span className="font-mono text-[0.8125rem] text-faint">{before}</span>
      <span aria-hidden="true" className="font-mono text-[0.8125rem] text-faint">
        →
      </span>
      <span
        className={cn(
          'font-mono text-[0.8125rem]',
          bad ? 'font-bold text-bad' : good ? 'text-good' : 'text-muted',
        )}
      >
        {after}
        <span className="ml-2 text-[0.6875rem] uppercase tracking-wider opacity-80">{verdict}</span>
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ 03 */

const LOOP = [
  {
    beat: 'Run',
    command: 'molt check chaos',
    body: 'Runs the collector through the Bright Data CLI, projects the rows, and snapshots every field.',
  },
  {
    beat: 'Detect',
    command: null,
    body: 'Classifies each field against the baseline: healthy, degraded, distorted, flatlined, collapsed, vanished, appeared. A fault opens an incident.',
  },
  {
    beat: 'Diagnose',
    command: null,
    body: 'Turns measured drift into a heal prompt — naming the dead fields, their before-and-after numbers, and crucially the fields still working, so the healer knows what not to touch.',
  },
  {
    beat: 'Heal',
    command: 'bdata scraper heal <id> "<prompt>"',
    body: 'Heals the same collector in place. Same Collector ID before and after — not a regenerate.',
  },
  {
    beat: 'Review',
    command: 'molt review',
    body: 'Stops. The incident sits at awaiting_approval until a human reads the baseline-versus-preview diff.',
  },
  {
    beat: 'Verify',
    command: 'molt approve',
    body: 'Commits the fix, then runs the collector again and proves recovery is the negation of the fault, at the same threshold. Only then does the incident close.',
  },
] as const;

function TheLoop() {
  return (
    <Section
      id="how"
      eyebrow="How it works"
      index={3}
      total={TOTAL}
      kicker="the loop"
      leadIn="Six steps, one collector ID."
      claim="Detect, diagnose, heal, verify."
    >
      <ol className="grid gap-0">
        {LOOP.map((step, i) => (
          <Reveal key={step.beat} delay={Math.min(i * 0.04, 0.16)}>
            <li className="grid gap-x-6 gap-y-3 border-t border-line-soft py-7 sm:grid-cols-[3.5rem_1fr] lg:grid-cols-[3.5rem_11rem_1fr]">
              <span className="font-mono text-[0.75rem] text-accent">
                {String(i + 1).padStart(2, '0')}
              </span>
              <h3 className="text-[1.0625rem] font-semibold text-ink">{step.beat}</h3>
              <div className="grid gap-3 sm:col-start-2 lg:col-start-3">
                <p className="prose-measure text-[0.875rem] leading-relaxed text-muted">
                  {step.body}
                </p>
                {step.command !== null && <CommandLine command={step.command} />}
              </div>
            </li>
          </Reveal>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ 04 */

const DIFF = [
  { field: 'comment_count', baseline: '60.5', broken: '0', preview: '18.5', recovered: true },
  { field: 'download_count', baseline: '20,251.5', broken: '0', preview: '6,192', recovered: true },
  { field: 'title', baseline: '100%', broken: '100%', preview: '100%', recovered: null },
  { field: 'tags', baseline: '100%', broken: '100%', preview: '100%', recovered: null },
] as const;

function TheHumanGate() {
  return (
    <Section
      id="gate"
      eyebrow="The human gate"
      index={4}
      total={TOTAL}
      kicker="awaiting_approval"
      leadIn="A fix that returns data is not a fix."
      claim="Molt stops and shows you the diff."
    >
      <div className="grid gap-10 lg:grid-cols-[1fr_1.2fr] lg:gap-14">
        <div className="grid gap-6">
          <Lede>
            An AI heal confirms one thing: the field came back non-null. It cannot tell you the
            value is right. So the incident state machine has a state it will not leave on its own —{' '}
            <code className="font-mono text-ink">awaiting_approval</code> — and the only ways out
            are a person approving or rejecting it.
          </Lede>
          <Lede>
            Approving in the browser spawns the identical{' '}
            <code className="font-mono text-ink">bdata</code> command{' '}
            <code className="font-mono text-ink">molt approve</code> would. The button is a window
            onto the terminal, not a second implementation of it.
          </Lede>
          <div>
            <Link href="/fleet" className={buttonClasses({ variant: 'secondary' })}>
              See it on real incidents
              <ArrowRightIcon />
            </Link>
          </div>
        </div>

        <Reveal>
          <div className="overflow-hidden rounded-md border border-line bg-surface shadow-sm">
            <div className="flex items-center justify-between gap-3 border-b border-line-soft bg-surface-2/60 px-4 py-2">
              <span className="font-mono text-[0.6875rem] uppercase tracking-wider text-faint">
                heal review · 2 preview rows
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-info-soft px-2 py-0.5 font-mono text-[0.625rem] uppercase tracking-wider text-info">
                awaiting approval
              </span>
            </div>

            <div className="scrollable-x">
              <table className="w-full border-collapse text-[0.78125rem]">
                <thead>
                  <tr className="border-b border-line">
                    {['field', 'baseline', 'broken', 'preview', ''].map((h) => (
                      <th
                        key={h}
                        className={cn(
                          'px-4 py-2 font-mono text-[0.625rem] font-semibold uppercase tracking-wider text-faint',
                          h === 'field' ? 'text-left' : 'text-right',
                        )}
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {DIFF.map((row) => (
                    <tr
                      key={row.field}
                      className={cn(
                        'border-b border-line-soft last:border-b-0',
                        row.recovered === null && 'opacity-50',
                      )}
                    >
                      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-ink">
                        {row.field}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono text-faint">
                        {row.baseline}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2.5 text-right font-mono',
                          row.recovered === null ? 'text-faint' : 'text-bad',
                        )}
                      >
                        {row.broken}
                      </td>
                      <td
                        className={cn(
                          'px-4 py-2.5 text-right font-mono',
                          row.recovered === null ? 'text-faint' : 'text-good',
                        )}
                      >
                        {row.preview}
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        {row.recovered === null ? (
                          <span className="text-faint">·</span>
                        ) : (
                          <CheckIcon className="inline text-good" />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="border-t border-line-soft px-4 py-3 text-[0.78125rem] text-muted">
              Typical values come from 2 preview rows against 60 at baseline, so expect them to
              differ in size even when correct. What matters is that a zeroed field is no longer
              zero.
            </div>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 05 */

const PLATFORM = [
  {
    step: 'Generate the collector',
    command: 'bdata scraper create <url> "<description>"',
    note: 'Scraper Studio builds it from plain language. Description caps at 500 characters.',
  },
  {
    step: 'Run it and take structured output',
    command: 'bdata scraper run <id> <url>',
    note: 'Rows in, snapshot out. This is the only step that happens on every check.',
  },
  {
    step: 'Heal the same collector',
    command: 'bdata scraper heal <id> "<prompt>"',
    note: 'In place, reusing the collector. Prompt caps at 1000 characters.',
  },
  {
    step: 'Approve, then verify',
    command: 'bdata scraper approve <id>',
    note: 'Molt runs the collector again afterwards and checks the fault is actually gone.',
  },
] as const;

function ThePlatform() {
  return (
    <Section
      id="platform"
      eyebrow={`Built on ${SITE.platform}`}
      index={5}
      total={TOTAL}
      kicker="four commands"
      leadIn="Molt does not replace Scraper Studio."
      claim="It heals the collector you already have."
    >
      <div className="grid gap-3">
        {PLATFORM.map((item, i) => (
          <Reveal key={item.step} delay={Math.min(i * 0.05, 0.15)}>
            <div className="grid gap-3 rounded-md border border-line bg-surface p-5 shadow-sm sm:grid-cols-[1fr_1.1fr] sm:items-center sm:gap-6">
              <div>
                <h3 className="text-[0.9375rem] font-semibold text-ink">{item.step}</h3>
                <p className="mt-1 text-[0.8125rem] leading-relaxed text-muted">{item.note}</p>
              </div>
              <CommandLine command={item.command} />
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ 06 */

const LIMITS = [
  {
    title: 'Credit figures are estimates',
    body: 'Bright Data publishes no per-operation price list, so Molt weights commands by kind and says so everywhere a number appears. It is a relative signal, not a bill.',
  },
  {
    title: 'Healing is slow and rate-limited',
    body: 'Heal and create are AI-Flow jobs: five to twenty-five minutes each, behind a concurrent-job cap that returns 429. Molt serialises them through a single slot rather than pretending otherwise.',
  },
  {
    title: 'Targets must stay small',
    body: 'The intent analyser fails outright on large documents — a 1.63 MB page killed two collector builds and left two orphans that cannot be deleted programmatically. Molt measures Content-Length before it will onboard a target, and refuses above roughly 200 KB.',
  },
  {
    title: 'Bright Data cannot reach your laptop',
    body: 'Collectors run in Bright Data’s cloud. A target on localhost is not a target, which is why the chaos site used for demonstrations is deployed publicly.',
  },
  {
    title: 'A small preview cannot prove a magnitude',
    body: 'When a heal returns two rows against a sixty-row baseline, Molt says the sample is too small to compare sizes and tells you what it can still prove: a zeroed field is no longer zero.',
  },
] as const;

function HonestLimits() {
  return (
    <Section
      id="limits"
      eyebrow="Honest limits"
      index={6}
      total={TOTAL}
      kicker="stated, not hidden"
      leadIn="A reliability tool that hides its own limits"
      claim="is not a reliability tool."
    >
      <div className="grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {LIMITS.map((limit, i) => (
          <Reveal key={limit.title} delay={Math.min(i * 0.04, 0.12)}>
            <div className="border-t border-line-soft pt-5">
              <h3 className="text-[0.9375rem] font-semibold text-ink">{limit.title}</h3>
              <p className="mt-2 text-[0.8125rem] leading-relaxed text-muted">{limit.body}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ close */

function Closing() {
  return (
    <section className="border-t border-line-soft">
      <div className="mx-auto max-w-[1180px] px-5 py-20 sm:px-6 sm:py-28">
        <Reveal>
          <div className="flex flex-col items-start gap-8">
            <h2 className="max-w-2xl text-display-sm font-semibold sm:text-display-md">
              <span className="block text-muted">The fleet is live.</span>
              <span className="block text-ink">Go and look at a real incident.</span>
            </h2>
            <div className="flex flex-wrap items-center gap-3">
              <Link href="/fleet" className={buttonClasses({ variant: 'primary', size: 'lg' })}>
                Open the cockpit
                <ArrowRightIcon />
              </Link>
              <a
                href={SITE.repository}
                target="_blank"
                rel="noreferrer"
                className={buttonClasses({ variant: 'secondary', size: 'lg' })}
              >
                Read the code
                <ExternalLinkIcon />
              </a>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}
