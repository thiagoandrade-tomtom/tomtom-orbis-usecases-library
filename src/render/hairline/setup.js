/* The hairline kernel's two globals, set before any figure module runs.
   Figures are written in the hairline-create skill's format — they read
   `HL` and end with `hairline({...})` — so the same file passes the
   skill's look.mjs and loads here. Here `hairline()` only registers. */
import { HL } from './kernel.js';

export const FIGURES = new Map();

globalThis.HL = HL;
globalThis.hairline = fig => FIGURES.set(fig.name, fig);

export { HL };
