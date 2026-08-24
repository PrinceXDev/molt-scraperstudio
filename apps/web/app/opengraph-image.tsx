import { ImageResponse } from 'next/og';

import { SITE } from '@/lib/site';

/**
 * The social card.
 *
 * Composed here rather than designed in a file, for the same reason as the icon:
 * there is no image pipeline in this workspace and adding one for a single static
 * asset would be the definition of an unnecessary dependency.
 *
 * It states the claim and shows the failure — a strip of healthy cells with two
 * red ones at the end. Someone who only ever sees the card in a chat client still
 * learns what the product is about.
 *
 * No custom font is loaded. `next/og` would need the font as an ArrayBuffer at
 * render time, which means either a network fetch or a committed binary; the
 * system sans it falls back to is perfectly legible at this size, and the card is
 * not the place to spend either of those costs.
 */
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export const alt = `${SITE.name} — ${SITE.tagline}`;

export default function OpengraphImage() {
  // Ten healthy runs then two zeroed ones: the same shape as the hero grid.
  const cells = Array.from({ length: 12 }, (_, i) => ({
    key: `run-${String(i + 1).padStart(2, '0')}`,
    bad: i >= 10,
  }));

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#0a0a0c',
        padding: 72,
        color: '#ecedf1',
        fontFamily: 'sans-serif',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 14, height: 14, borderRadius: '50%', background: '#ff4d3d' }} />
        <div style={{ fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{SITE.name}</div>
        <div style={{ fontSize: 22, color: '#7c7d88', marginLeft: 6 }}>{SITE.tagline}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2.5, color: '#9b9ca8' }}>
          Your scraper didn&rsquo;t stop.
        </div>
        <div style={{ fontSize: 76, fontWeight: 600, letterSpacing: -2.5 }}>It started lying.</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <div style={{ display: 'flex', gap: 8 }}>
          {cells.map((cell) => (
            <div
              key={cell.key}
              style={{
                width: 76,
                height: 34,
                borderRadius: 4,
                background: cell.bad ? '#ff5a52' : 'rgba(62, 207, 106, 0.55)',
              }}
            />
          ))}
        </div>
        <div style={{ fontSize: 24, color: '#7c7d88' }}>
          comment_count · fill rate 100% · typical value 0 · ZEROED
        </div>
      </div>
    </div>,
    size,
  );
}
