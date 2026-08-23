import fs from 'fs';
import path from 'path';

let cachedLogoDataUri: string | null = null;

/** Invoice header logo — cropped horizontal asset (not the square 3000×3000 master). */
export const LOGO_INVOICE = {
  nativeWidth: 1000,
  nativeHeight: 733,
  displayWidth: 210,
  displayHeight: Math.round(210 * (733 / 1000)),
};

/** Embed logo as data URI so html2pdf never depends on CORS/static URLs. */
export function getLogoDataUri(): string {
  if (cachedLogoDataUri) return cachedLogoDataUri;
  const candidates = [
    path.join(__dirname, '../../assets/huffaz-holiday-logo-invoice.png'),
    path.join(__dirname, '../../assets/huffaz-holiday-logo.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo-invoice.png'),
    path.join(__dirname, '../../../frontend/public/huffaz-holiday-logo.png'),
  ];
  for (const logoPath of candidates) {
    if (fs.existsSync(logoPath)) {
      cachedLogoDataUri = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
      return cachedLogoDataUri;
    }
  }
  return '';
}

/** Render a crisp, aspect-correct logo block for PDF headers. */
export function logoHtml(alt: string): string {
  const src = getLogoDataUri();
  if (!src) return '';
  const { displayWidth, displayHeight } = LOGO_INVOICE;
  return `<img
    src="${src}"
    alt="${alt}"
    width="${displayWidth}"
    height="${displayHeight}"
    style="width:${displayWidth}px;height:${displayHeight}px;max-width:100%;object-fit:contain;object-position:left top;display:block;border:0;image-rendering:auto;-webkit-print-color-adjust:exact;print-color-adjust:exact;"
    decoding="sync"
    loading="eager"
  />`;
}

const NAVY = '#063d79';
const BLUE = '#07529a';
const GREY = '#9aa8b6';

function svg(inner: string, size = 16, color = NAVY): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" style="display:inline-block;vertical-align:middle;">${inner}</svg>`;
}

const paths = {
  adults: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  child: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>',
  infant: '<path d="M9 12h.01"/><path d="M15 12h.01"/><path d="M10 16c.5.5 1.5 1 2 1s1.5-.5 2-1"/><path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5s-.9 2.5-2 2.5c-.8 0-1.5-.4-1.5-1"/>',
  ticket: '<path d="M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2Z"/><path d="M13 5v2"/><path d="M13 17v2"/><path d="M13 11v2"/>',
  visa: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M15 8h2"/><path d="M15 12h2"/><path d="M7 16h10"/>',
  hotel: '<path d="M3 21h18"/><path d="M5 21V7l8-4v18"/><path d="M19 21V11l-6-4"/><path d="M9 9v.01"/><path d="M9 12v.01"/><path d="M9 15v.01"/><path d="M9 18v.01"/>',
  transport: '<path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M15 18h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/>',
  pin: '<path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/>',
  globe: '<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
  plane: '<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
};

export const icons = {
  adults: svg(paths.adults, 14, BLUE),
  child: svg(paths.child, 14, BLUE),
  infant: svg(paths.infant, 14, BLUE),
  pin: svg(paths.pin, 12, BLUE),
  phone: svg(paths.phone, 11, BLUE),
  globe: svg(paths.globe, 11, BLUE),
  plane: svg(paths.plane, 10, BLUE),
};

export function serviceIcon(type: string, active: boolean, accent: string): string {
  const pathKey = type.toLowerCase() as keyof typeof paths;
  const pathData = paths[pathKey] || paths.ticket;
  const color = active ? '#ffffff' : GREY;
  const bg = active ? accent : '#d5dbe1';
  return `<div style="display:inline-block;width:34px;height:34px;line-height:34px;border-radius:50%;background:${bg};text-align:center;">${svg(pathData, 15, color)}</div>`;
}

export function sectionIcon(type: string, color: string): string {
  const pathKey = type.toLowerCase() as keyof typeof paths;
  return svg(paths[pathKey] || paths.ticket, 13, color);
}

/** Decorative flight-path graphic for top-right of header. */
export function flightPathGraphic(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="48" viewBox="0 0 150 48" style="display:block;margin-left:auto;margin-bottom:4px;">
    <path d="M6 38 C 38 34, 58 16, 92 12 S 122 8, 136 6" fill="none" stroke="${BLUE}" stroke-width="1.3" stroke-dasharray="3.5 3.5" opacity="0.9"/>
    <circle cx="6" cy="38" r="3.5" fill="${BLUE}"/>
    <path d="M6 35.5v5M3.5 38h5" stroke="#fff" stroke-width="1.1"/>
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z" fill="none" stroke="${BLUE}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" transform="translate(118,-2) scale(0.9)"/>
  </svg>`;
}

export { NAVY, BLUE, GREY };
