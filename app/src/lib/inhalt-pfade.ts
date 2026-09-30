// Woher die Lerninhalte kommen. Der andere Agent legt sie unter
// <repo>/inhalt/ ab: Kapitel als *.md, quiz.json, grafiken/*.svg. Solange
// dort keine Kapitel liegen, gilt app/inhalt-platzhalter/ mit demselben Aufbau.

import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const APP = fileURLToPath(new URL('../../', import.meta.url));
const REPO = fileURLToPath(new URL('../../../', import.meta.url));

export const INHALT_ECHT = `${REPO}inhalt/`;
export const INHALT_PLATZHALTER = `${APP}inhalt-platzhalter/`;

function hatKapitel(ordner: string): boolean {
  if (!existsSync(ordner)) return false;
  return readdirSync(ordner).some((name) => /^\d+.*\.md$/.test(name));
}

/** true, wenn die echten Inhalte aus inhalt/ verwendet werden. */
export function echteInhalte(): boolean {
  return hatKapitel(INHALT_ECHT);
}

export function inhaltOrdner(): string {
  return echteInhalte() ? INHALT_ECHT : INHALT_PLATZHALTER;
}
