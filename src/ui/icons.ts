/** Small inline SVG icon set (currentColor). */
const svg = (body: string) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
const stroke = (d: string, w = 3) =>
  `<path d="${d}" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const gearTeeth = Array.from(
  { length: 8 },
  (_, i) => `<rect x="10.1" y="1.4" width="3.8" height="5.2" rx="1" transform="rotate(${i * 45} 12 12)"/>`,
).join('');

export const ICONS = {
  heart: svg(
    '<path fill="currentColor" d="M12 21.2S3.6 16.3 2.2 10.9C1.2 7 3.6 3.9 7 3.9c2.2 0 3.9 1.2 5 2.9 1.1-1.7 2.8-2.9 5-2.9 3.4 0 5.8 3.1 4.8 7C20.4 16.3 12 21.2 12 21.2z"/>',
  ),
  sword: svg(
    '<g fill="currentColor"><path d="M21.3 2.7l-1.1 5.6-9 9-3.5-3.5 9-9z"/><path d="M4.9 12.2l6.9 6.9-1.7 1.7-6.9-6.9z"/><path d="M6.8 15.8l1.4 1.4-3.9 3.9a1 1 0 01-1.4-1.4z"/></g>',
  ),
  gear: svg(`<g fill="currentColor">${gearTeeth}</g><circle cx="12" cy="12" r="5.2" fill="none" stroke="currentColor" stroke-width="4.2"/>`),
  back: svg('<path d="M16.5 4.5L6.5 12l10 7.5z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>'),
  play: svg('<path d="M7.5 4.5L18.5 12l-11 7.5z" fill="currentColor" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>'),
  speaker: svg(
    `<path d="M3 9.2h3.8L12 5v14l-5.2-4.2H3z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>${stroke('M15.6 8.8a4.6 4.6 0 010 6.4M18.3 6.2a8.3 8.3 0 010 11.6', 2.3)}`,
  ),
  mute: svg(
    `<path d="M3 9.2h3.8L12 5v14l-5.2-4.2H3z" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>${stroke('M15.5 9.2l5.4 5.6M20.9 9.2l-5.4 5.6', 2.6)}`,
  ),
  check: svg(stroke('M4.8 12.6l4.6 4.6 9.8-10.4', 3.6)),
  plus: svg(stroke('M12 5v14M5 12h14', 3.6)),
  minus: svg(stroke('M5 12h14', 3.6)),
  close: svg(stroke('M6 6l12 12M18 6L6 18', 3.4)),
  clock: svg(`<circle cx="12" cy="12" r="8.6" fill="none" stroke="currentColor" stroke-width="2.6"/>${stroke('M12 7.4V12l3.2 2.2', 2.6)}`),
  bolt: svg('<path fill="currentColor" d="M13.6 1.8L4.2 13.6h6.1l-1.6 8.6 11-12.4h-6.3z"/>'),
  wrench: svg(
    '<path fill="currentColor" d="M21.2 6.4a5.6 5.6 0 01-7.3 5.6l-7.6 7.7a2.1 2.1 0 01-3-3l7.7-7.6A5.6 5.6 0 0117.6 2l-3.4 3.4.6 3 3 .6z"/>',
  ),
  globe: svg(
    `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.4"/>${stroke('M3.5 9h17M3.5 15h17M12 3c-3.2 3.6-3.2 14.4 0 18M12 3c3.2 3.6 3.2 14.4 0 18', 2)}`,
  ),
  users: svg(
    '<g fill="currentColor"><circle cx="8.2" cy="8" r="3.4"/><path d="M1.8 19.6c0-3.7 2.9-6.3 6.4-6.3s6.4 2.6 6.4 6.3z"/><circle cx="16.6" cy="8.6" r="2.9" opacity=".85"/><path d="M15.6 19.6c0-2.3-.8-4.3-2.2-5.6.9-.5 2-.8 3.2-.8 3 0 5.4 2.3 5.4 5.6v.8z" opacity=".85"/></g>',
  ),
  copy: svg(
    `<rect x="8.5" y="8.5" width="11" height="11" rx="2.4" fill="none" stroke="currentColor" stroke-width="2.4"/>${stroke('M15.5 5.5v-.6a2.4 2.4 0 00-2.4-2.4H6.9a2.4 2.4 0 00-2.4 2.4v6.2a2.4 2.4 0 002.4 2.4h.6', 2.4)}`,
  ),
  skip: svg('<path fill="currentColor" d="M3.5 5.2l8.2 6.8-8.2 6.8zM11.6 5.2l8.2 6.8-8.2 6.8z"/><rect x="19.2" y="5" width="2.6" height="14" rx="1" fill="currentColor"/>'),
  crown: svg('<path fill="currentColor" d="M2.8 7.6l4.8 3.9L12 4.4l4.4 7.1 4.8-3.9-1.9 10.6H4.7zM4.8 19.6h14.4v2H4.8z"/>'),
  up: svg(stroke('M12 20V5M5.5 11.2L12 4.6l6.5 6.6', 3.4)),
  star: svg('<path fill="currentColor" d="M12 2.6l2.9 6 6.5.8-4.8 4.5 1.3 6.5L12 17.2l-5.9 3.2 1.3-6.5L2.6 9.4l6.5-.8z"/>'),
  pencil: svg('<path fill="currentColor" d="M15.8 3.6l4.6 4.6L9 19.6l-5.6 1 1-5.6zM14.2 5.2l4.6 4.6"/>'),
  paw: svg(
    '<g fill="currentColor"><ellipse cx="6.2" cy="9.6" rx="2.2" ry="2.8"/><ellipse cx="10" cy="5.6" rx="2.2" ry="2.9"/><ellipse cx="14.4" cy="5.6" rx="2.2" ry="2.9"/><ellipse cx="18" cy="9.8" rx="2.2" ry="2.8"/><path d="M12.2 11c3 0 6 3.6 6 6.3 0 2.2-1.9 3-3.4 3-1.2 0-1.8-.6-2.6-.6s-1.4.6-2.6.6c-1.6 0-3.4-.8-3.4-3 0-2.7 3-6.3 6-6.3z"/></g>',
  ),
  swap: svg(stroke('M4 8h14l-3.5-3.5M20 16H6l3.5 3.5', 2.8)),
  eye: svg(
    `<path d="M1.8 12S5.6 5.2 12 5.2 22.2 12 22.2 12 18.4 18.8 12 18.8 1.8 12 1.8 12z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.3" fill="currentColor"/>`,
  ),
  wheel: svg(
    `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3.2"/><circle cx="12" cy="12" r="3" fill="currentColor"/>${stroke('M12 4v5M12 15v5M4 12h5M15 12h5', 2)}`,
  ),
  chassis: svg('<path fill="currentColor" d="M2.5 15.5V12l3-4.5h7.5l3.6 3.4 4.4.9v3.7z"/><circle cx="7" cy="17" r="2.6" fill="currentColor"/><circle cx="17" cy="17" r="2.6" fill="currentColor"/>'),
  gadget: svg(
    '<path fill="currentColor" d="M9.2 2.5h5.6v3.2h2.8a2 2 0 012 2v11.6a2 2 0 01-2 2H6.4a2 2 0 01-2-2V7.7a2 2 0 012-2h2.8z"/><path d="M12.8 9l-3.6 5.4h3l-1 4.2 3.8-5.6h-3.1z" fill="#fff" opacity=".9"/>',
  ),
  refresh: svg(stroke('M20 11a8 8 0 10-2.3 6.1M20 4.5V11h-6.5', 2.8)),
  flag: svg('<path fill="currentColor" d="M5 2.8h2.2v18.4H5z"/><path fill="currentColor" d="M7.2 3.6c3.8-1.5 6.2 1.6 11.6.2v9.4c-5.4 1.4-7.8-1.7-11.6-.2z"/>'),
} as const;

export type IconName = keyof typeof ICONS;
