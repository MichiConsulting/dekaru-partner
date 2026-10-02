// Der Umschalter zwischen hell und dunkel im Kopf der Seite. Den Startwert
// setzt public/theme-init.js schon im <head>; hier kommt nur der Klick dazu.
// Gespeichert wird die Wahl in localStorage ("dekaru-theme"), ohne Wahl gilt
// die Systemeinstellung, auch wenn sie sich waehrend des Besuchs aendert.

export type Modus = 'light' | 'dark';
export const SCHLUESSEL = 'dekaru-theme';

const html = document.documentElement;
const system = window.matchMedia('(prefers-color-scheme: dark)');

function aktueller(): Modus {
  const gesetzt = html.getAttribute('data-theme');
  if (gesetzt === 'light' || gesetzt === 'dark') return gesetzt;
  return system.matches ? 'dark' : 'light';
}

function speichere(modus: Modus): void {
  try {
    localStorage.setItem(SCHLUESSEL, modus);
  } catch {
    // Privater Modus oder gesperrter Speicher: die Wahl gilt dann nur fuer diese Seite.
  }
}

for (const knopf of document.querySelectorAll<HTMLButtonElement>('[data-modus]')) {
  const zeige = () => knopf.setAttribute('aria-pressed', String(aktueller() === 'dark'));
  knopf.addEventListener('click', () => {
    const neu: Modus = aktueller() === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', neu);
    speichere(neu);
    zeige();
  });
  system.addEventListener('change', zeige);
  zeige();
}
