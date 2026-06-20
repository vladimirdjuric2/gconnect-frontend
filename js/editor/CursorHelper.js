/**
 * CursorHelper.js
 * Generisanje prilagođenih SVG kursora za alate vizuelnog editora.
 *
 * Izdvojeno iz EditorManager-a (čista funkcija bez stanja) radi smanjenja
 * veličine monolita i centralizacije boja kroz DEVICE_COLORS.
 */
import { DEVICE_COLORS } from '../komponente/core/Konstante.js';

// SVG sadržaj (unutrašnjost <svg>) po alatu. ${color} se popunjava bojom alata.
const TOOL_SVG = {
    gnc: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <rect x="11" y="11" width="14" height="14" rx="2" fill="none" stroke="${c}" stroke-width="2" />
        <rect x="14" y="14" width="8" height="8" fill="none" stroke="${c}" stroke-width="1.5" />
        <path d="M14 7v4M22 7v4M14 25v4M22 25v4M7 14h4M7 22h4M25 14h4M25 22h4" stroke="${c}" stroke-width="1.5" stroke-linecap="round" />
    `,
    pump: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <path d="M12 18h12M15 14v8M20 12v6M20 18a3 3 0 0 1-3 3" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="20" cy="22" r="1.5" fill="${c}" />
        <circle cx="20" cy="26" r="1" fill="${c}" />
    `,
    valve: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <path d="M18 10v10M13 18h10M11 23l1 2M15 23v3M19 23v3M23 23l-1 2" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" />
    `,
    gauge: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <circle cx="18" cy="18" r="8" fill="none" stroke="${c}" stroke-width="1.8" />
        <line x1="18" y1="18" x2="22" y2="14" stroke="${c}" stroke-width="2" stroke-linecap="round" />
        <circle cx="18" cy="18" r="2" fill="${c}" />
    `,
    flow_meter: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <path d="M11 15c2 0 3 2 5 2s3-2 5-2s3 2 5 2M11 21c2 0 3 2 5 2s3-2 5-2s3 2 5 2" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    `,
    pipe: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <path d="M10 18h16" stroke="${c}" stroke-width="3" stroke-linecap="round" />
        <circle cx="10" cy="18" r="2.5" fill="${c}" />
        <circle cx="26" cy="18" r="2.5" fill="${c}" />
    `,
    wire: (c) => `
        <circle cx="18" cy="18" r="15" fill="rgba(15, 15, 25, 0.85)" stroke="${c}" stroke-width="2" />
        <path d="M18 9l-4 9h8l-4 9" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
    `
};

/**
 * Vraća CSS vrednost kursora (url data:svg) za zadati alat.
 * @param {String} tool Naziv alata ('gnc','pump','valve','gauge','flow_meter','pipe','wire')
 * @returns {String} CSS cursor vrednost
 */
export function getToolCursor(tool) {
    const builder = TOOL_SVG[tool];
    if (!builder) return 'crosshair';

    const color = DEVICE_COLORS[tool] || '#ffffff';
    const svgContent = builder(color);
    const svgString = `<svg xmlns="http://www.w3.org/2000/svg" width="36" height="36" viewBox="0 0 36 36">${svgContent}</svg>`;
    return `url("data:image/svg+xml,${encodeURIComponent(svgString)}") 18 18, crosshair`;
}
