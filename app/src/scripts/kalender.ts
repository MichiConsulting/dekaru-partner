// Kalender, nur Verbesserung: die Linie "jetzt" im Stundenraster wandert
// jede Minute mit. Ohne JavaScript steht sie beim Stand des Seitenaufrufs.
// Die Uhrzeit kommt aus Europe/Berlin, wie auf dem Server.
import { minutenBerlin } from '../lib/datum.ts';
import { jetztLage } from '../lib/kalender-ansicht.ts';

function aktualisiere(): void {
  const raster = document.querySelector<HTMLElement>('[data-kal-raster]');
  const linie = raster?.querySelector<HTMLElement>('[data-kal-jetzt]');
  if (!raster || !linie) return;
  const lage = jetztLage(minutenBerlin(), { von: Number(raster.dataset.von), bis: Number(raster.dataset.bis) });
  linie.hidden = lage === null;
  if (lage !== null) linie.style.setProperty('--oben', `${lage.toFixed(3)}%`);
}

if (document.querySelector('[data-kal-jetzt]')) {
  aktualisiere();
  window.setInterval(aktualisiere, 60_000);
}
