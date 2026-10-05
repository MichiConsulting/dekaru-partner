// Schema im Erstgespraech: blaettern (Knoepfe, Pfeiltasten, Wischen), Branche
// und Paket umschalten, Praesentationsmodus. Alle Texte kommen fertig vom
// Server. Dieses Skript kennt keine Preise und importiert nichts aus lib/,
// damit im oeffentlichen Bundle unter /_astro/ keine Zahlen landen.

const wurzel = document.querySelector<HTMLElement>('[data-schema]');

if (wurzel) {
  const schema = wurzel;
  const html = document.documentElement;
  const schritte = [...schema.querySelectorAll<HTMLElement>('[data-schritt]')];
  const punkte = [...schema.querySelectorAll<HTMLButtonElement>('[data-gehe]')];
  const weiter = schema.querySelector<HTMLButtonElement>('[data-weiter]');
  const zurueck = schema.querySelector<HTMLButtonElement>('[data-zurueck]');
  const nochmal = schema.querySelector<HTMLButtonElement>('[data-nochmal]');
  const ansage = schema.querySelector<HTMLElement>('[data-ansage]');
  const paketAnsage = schema.querySelector<HTMLElement>('[data-paket-ansage]');
  const praesKnopf = schema.querySelector<HTMLButtonElement>('[data-praesentation]');
  const letzter = schritte.length - 1;
  let aktuell = 0;

  const titelVon = (i: number) => schritte[i]?.querySelector('.schritt__titel')?.textContent?.trim() ?? '';

  function zeige(i: number, mitAnsage = true): void {
    const neu = Math.max(0, Math.min(letzter, i));
    schritte.forEach((s, n) => {
      s.hidden = n !== neu;
      s.classList.remove('ist-aktiv');
    });
    // Erzwingt einen Neustart der Animationen, auch beim Zurueckblaettern.
    void schritte[neu].offsetWidth;
    schritte[neu].classList.add('ist-aktiv');
    aktuell = neu;
    punkte.forEach((p, n) => {
      if (n === neu) p.setAttribute('aria-current', 'step');
      else p.removeAttribute('aria-current');
    });
    if (zurueck) zurueck.disabled = neu === 0;
    if (weiter) weiter.disabled = neu === letzter;
    if (mitAnsage && ansage) ansage.textContent = `Schritt ${neu + 1} von ${schritte.length}: ${titelVon(neu)}`;
    const url = new URL(location.href);
    url.hash = `schritt-${neu}`;
    history.replaceState(null, '', url);
    // Liegt der Anfang des Schemas oberhalb des Fensters, zurueck nach oben.
    if (schema.getBoundingClientRect().top < 0) schema.scrollIntoView({ block: 'start' });
  }

  // ── Branche
  const branchenWahl = [...schema.querySelectorAll<HTMLAnchorElement>('[data-branche-wahl]')];
  function setzeBranche(id: string): void {
    schema.dataset.branche = id;
    for (const el of schema.querySelectorAll<HTMLElement>('[data-fuer-branche]')) el.hidden = el.dataset.fuerBranche !== id;
    for (const a of branchenWahl) {
      if (a.dataset.brancheWahl === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    const url = new URL(location.href);
    url.searchParams.set('branche', id);
    history.replaceState(null, '', url);
  }
  for (const a of branchenWahl) {
    a.addEventListener('click', (e) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      setzeBranche(a.dataset.brancheWahl ?? '');
      zeige(1);
      weiter?.focus();
    });
  }

  // ── Paket
  const paketKnoepfe = [...schema.querySelectorAll<HTMLButtonElement>('[data-paket-wahl]')];
  for (const k of paketKnoepfe) {
    k.addEventListener('click', () => {
      schema.dataset.paket = k.dataset.paketWahl ?? 'gross';
      for (const andere of paketKnoepfe) andere.setAttribute('aria-pressed', String(andere === k));
      if (paketAnsage) paketAnsage.textContent = `Paket ${k.querySelector('.pakete-wahl__name')?.textContent ?? ''}: ${k.dataset.anzahl} Bausteine`;
    });
  }

  // ── Blaettern
  weiter?.addEventListener('click', () => zeige(aktuell + 1));
  zurueck?.addEventListener('click', () => zeige(aktuell - 1));
  punkte.forEach((p, n) => p.addEventListener('click', () => zeige(n)));
  nochmal?.addEventListener('click', () => zeige(aktuell, false));

  document.addEventListener('keydown', (e) => {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const ziel = e.target as HTMLElement | null;
    if (ziel?.closest('input, textarea, select, [contenteditable="true"], details[open]')) return;
    if (e.key === 'ArrowRight' || e.key === 'PageDown') {
      e.preventDefault();
      zeige(aktuell + 1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      zeige(aktuell - 1);
    } else if (e.key === 'Escape' && html.classList.contains('praesentation')) {
      setzePraesentation(false);
    }
  });

  let startX = 0;
  let startY = 0;
  let zaehlt = false;
  schema.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 1) {
        zaehlt = false;
        return;
      }
      zaehlt = true;
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
    },
    { passive: true },
  );
  schema.addEventListener(
    'touchend',
    (e) => {
      if (!zaehlt) return;
      zaehlt = false;
      const t = e.changedTouches[0];
      const dx = t.clientX - startX;
      const dy = t.clientY - startY;
      if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      zeige(aktuell + (dx < 0 ? 1 : -1));
    },
    { passive: true },
  );

  // ── Praesentation: Kopf und Fuss weg, grosse Schrift. Vollbild nur, wenn
  // der Browser es kann; die Klasse allein reicht auch fuer eine
  // Bildschirmfreigabe im Fenster.
  function setzePraesentation(an: boolean): void {
    html.classList.toggle('praesentation', an);
    praesKnopf?.setAttribute('aria-pressed', String(an));
    try {
      if (an && !document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => undefined);
      } else if (!an && document.fullscreenElement) {
        document.exitFullscreen().catch(() => undefined);
      }
    } catch {
      // Kein Vollbild moeglich (z. B. iPhone): der Modus gilt trotzdem.
    }
  }
  praesKnopf?.addEventListener('click', () => setzePraesentation(!html.classList.contains('praesentation')));
  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement && html.classList.contains('praesentation')) setzePraesentation(false);
  });

  // ── Start
  schema.classList.add('schema--js');
  const ausAdresse = Number(/^#schritt-(\d+)$/.exec(location.hash)?.[1] ?? 0);
  zeige(Number.isFinite(ausAdresse) ? ausAdresse : 0, false);
}
