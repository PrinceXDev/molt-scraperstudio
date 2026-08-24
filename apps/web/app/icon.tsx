import { ImageResponse } from 'next/og';

/**
 * The favicon, generated rather than committed.
 *
 * The workspace disables `sharp` on the grounds that this UI is text and data,
 * not images, so there was no image pipeline to add a `.ico` to. `next/og`
 * rasterises this at build time into a real PNG with no runtime cost and no
 * binary in the repository.
 *
 * The mark is the ember dot on the dark canvas — the same glyph the header and
 * the rail use, so a pinned tab matches the page it opens.
 */
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // Dark, unconditionally. A favicon cannot respond to the page theme, and
        // browser tab strips are dark far more often than not.
        background: '#0a0a0c',
        borderRadius: 7,
      }}
    >
      <div
        style={{
          width: 15,
          height: 15,
          borderRadius: '50%',
          background: '#ff4d3d',
        }}
      />
    </div>,
    size,
  );
}
