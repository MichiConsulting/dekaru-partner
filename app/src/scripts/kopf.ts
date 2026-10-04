// Kopf der Seite. Das Konto-Menue ist details/summary und funktioniert ohne
// JavaScript; hier kommt nur dazu, dass ein Klick daneben oder Escape es
// schliesst. Auf dem Handy ist die Zeile mit Unterpunkten seitlich
// schiebbar, der aktive Punkt wird beim Laden sichtbar gerollt.
for (const menue of document.querySelectorAll<HTMLDetailsElement>('[data-konto]')) {
  document.addEventListener('click', (e) => {
    if (menue.open && !menue.contains(e.target as Node)) menue.open = false;
  });
  menue.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menue.open) {
      menue.open = false;
      menue.querySelector('summary')?.focus();
    }
  });
}

const leiste = document.querySelector<HTMLElement>('.unternav');
if (leiste && leiste.scrollWidth > leiste.clientWidth + 1) {
  // Passt die Zeile nicht, blendet der rechte Rand aus, und der aktive Punkt
  // wird nur gerollt, wenn er sonst im Ausblendrand laege.
  leiste.classList.add('schiebt');
  const aktiv = leiste.querySelector<HTMLElement>('[aria-current="page"]');
  if (aktiv) {
    const rechts = aktiv.offsetLeft + aktiv.offsetWidth;
    const sichtbar = leiste.clientWidth - 32;
    if (rechts > sichtbar) leiste.scrollLeft = rechts - sichtbar;
  }
}
