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
    // Paletten gelten fuer jede Branche, die Wahl bleibt. Ohne Wahl zeigt die
    // Vorschau den Standard der neuen Branche.
    if (!schema.dataset.palette) setzePalette(null, false);
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

  // ── Farben: Ebene 1 Farbgruppen, Ebene 2 die Paletten einer Gruppe. Die
  // Farben kommen als kompakte Daten aus dem Seitenquelltext
  // (data-paletten-daten, src/lib/paletten.ts schemaDaten), dieses Skript
  // kennt keine Palette selbst. Gespeichert wird nur in der Adresse
  // (?gruppe=BL&palette=BL-2), damit der Link zum Nachschicken sie mitnimmt.
  type PalettenDaten = {
    gruppen: Record<string, { label: string; codes: string[] }>;
    paletten: Record<string, [string, string, string, string, string]>;
  };
  const datenEl = schema.querySelector<HTMLScriptElement>('[data-paletten-daten]');
  const daten: PalettenDaten = datenEl ? JSON.parse(datenEl.textContent ?? '{}') : { gruppen: {}, paletten: {} };
  const farbAnsage = schema.querySelector<HTMLElement>('[data-farb-ansage]');
  const uebersicht = schema.querySelector<HTMLElement>('[data-gruppen-uebersicht]');
  const ansicht = schema.querySelector<HTMLElement>('[data-gruppen-ansicht]');
  const gruppenTitel = schema.querySelector<HTMLElement>('[data-gruppe-titel]');
  const liste = schema.querySelector<HTMLUListElement>('[data-paletten-liste]');
  const vorlage = schema.querySelector<HTMLTemplateElement>('[data-karten-vorlage]');
  const hinweisNamen = schema.querySelector<HTMLElement>('[data-hinweis-namen]');
  const PROBE = ['bg', 'surface', 'ink', 'ink-soft', 'muted', 'accent', 'accent-deep', 'on-accent', 'border', 'link'];

  const farbenVon = (code: string): string[] => {
    const roh = daten.paletten[code]?.[4] ?? '';
    return PROBE.map((_, i) => roh.slice(i * 7, i * 7 + 7));
  };
  const stilVon = (code: string): string => farbenVon(code).map((f, i) => `--pl-${PROBE[i]}:${f}`).join(';');
  const paletteTitelVon = (code: string): string => `Palette ${code} ${daten.paletten[code]?.[0] ?? ''}`;
  const farbLink = (gruppe: string, palette: string): string => {
    const url = new URL(location.href);
    url.hash = 'schritt-3';
    if (gruppe) url.searchParams.set('gruppe', gruppe);
    else url.searchParams.delete('gruppe');
    if (palette) url.searchParams.set('palette', palette);
    else url.searchParams.delete('palette');
    return url.pathname + url.search + url.hash;
  };
  const adresseSetzen = (): void => {
    const url = new URL(location.href);
    for (const [k, v] of [['gruppe', schema.dataset.gruppe ?? ''], ['palette', schema.dataset.palette ?? '']]) {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    }
    history.replaceState(null, '', url);
  };
  /** Standardpalette der Branche: erste Empfehlung im sichtbaren Block. */
  const standardCode = (): string =>
    schema.querySelector<HTMLElement>(`.empfehlung[data-fuer-branche="${schema.dataset.branche}"] [data-palette-wahl]`)?.dataset.paletteWahl ?? '';

  function markiere(): void {
    const code = schema.dataset.palette ?? '';
    for (const a of schema.querySelectorAll<HTMLAnchorElement>('[data-palette-wahl]')) {
      if (code && a.dataset.paletteWahl === code) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    }
    const gruppe = code ? daten.paletten[code]?.[2] : '';
    for (const el of schema.querySelectorAll<HTMLElement>('[data-gruppe-gewaehlt]')) el.hidden = el.dataset.gruppeGewaehlt !== gruppe;
  }

  function karteBauen(code: string, gruppe: string, i: number): HTMLLIElement | null {
    const p = daten.paletten[code];
    const li = vorlage?.content.firstElementChild?.cloneNode(true) as HTMLLIElement | undefined;
    if (!p || !li) return null;
    const [name, charakter, , zusatz] = p;
    const farben = farbenVon(code);
    li.style.setProperty('--i', String(i));
    const a = li.querySelector<HTMLAnchorElement>('a')!;
    a.href = farbLink(gruppe, code);
    a.dataset.paletteWahl = code;
    li.querySelector<HTMLElement>('.palette__probe')!.setAttribute('style', stilVon(code));
    // Felder in Leserichtung wie farbfelder(): Akzent, Akzent dunkel, Schrift, Flaeche, Hintergrund.
    const felder = [farben[5], farben[6], farben[2], farben[1], farben[0]];
    li.querySelectorAll<HTMLElement>('.palette__feld').forEach((f, n) => (f.style.background = felder[n]));
    li.querySelector('.palette__code')!.textContent = code;
    li.querySelector('.palette__name')!.textContent = name;
    li.querySelector('.palette__charakter')!.textContent = charakter;
    const z = li.querySelector<HTMLElement>('.palette__zusatz')!;
    if (zusatz) z.textContent = zusatz;
    else z.remove();
    return li;
  }

  function oeffneGruppe(kuerzel: string, fokus = true): void {
    const g = daten.gruppen[kuerzel];
    if (!g || !liste || !ansicht || !uebersicht) return;
    liste.replaceChildren(...g.codes.map((c, i) => karteBauen(c, kuerzel, i)).filter((x): x is HTMLLIElement => x !== null));
    if (gruppenTitel) gruppenTitel.textContent = g.label;
    if (hinweisNamen) hinweisNamen.hidden = kuerzel !== 'IN';
    schema.dataset.gruppe = kuerzel;
    uebersicht.hidden = true;
    ansicht.hidden = false;
    // Animationen der Karten neu starten.
    liste.classList.remove('ist-neu');
    void liste.offsetWidth;
    liste.classList.add('ist-neu');
    markiere();
    zurueckLinks();
    adresseSetzen();
    if (fokus) gruppenTitel?.focus();
    if (farbAnsage) farbAnsage.textContent = `${g.label}: ${g.codes.length} Paletten`;
  }

  function schliesseGruppe(): void {
    const vorher = schema.dataset.gruppe ?? '';
    schema.dataset.gruppe = '';
    if (ansicht) ansicht.hidden = true;
    if (uebersicht) uebersicht.hidden = false;
    adresseSetzen();
    gruppenLinks();
    schema.querySelector<HTMLAnchorElement>(`[data-gruppe-wahl="${vorher}"]`)?.focus();
  }

  /** Links ohne Skript aktuell halten (Mittelklick, neuer Tab). */
  function gruppenLinks(): void {
    for (const a of schema.querySelectorAll<HTMLAnchorElement>('[data-gruppe-wahl]')) a.href = farbLink(a.dataset.gruppeWahl ?? '', schema.dataset.palette ?? '');
  }
  function zurueckLinks(): void {
    const z = schema.querySelector<HTMLAnchorElement>('[data-gruppe-zurueck]');
    if (z) z.href = farbLink('', schema.dataset.palette ?? '');
  }

  function setzePalette(code: string | null, ansagen = true): void {
    const wahl = code && daten.paletten[code] ? code : '';
    schema.dataset.palette = wahl;
    markiere();
    const zeige = wahl || standardCode();
    const vorschau = schema.querySelector<HTMLElement>('[data-farb-vorschau]');
    if (vorschau && zeige) vorschau.setAttribute('style', stilVon(zeige));
    const titel = schema.querySelector<HTMLElement>('[data-farb-titel]');
    const hinweis = schema.querySelector<HTMLElement>('[data-farb-hinweis]');
    if (titel) titel.textContent = wahl ? paletteTitelVon(wahl) : 'Noch keine Palette gewählt';
    if (hinweis) hinweis.textContent = wahl ? 'Diesen Namen bitte nennen.' : `Die Vorschau zeigt ${paletteTitelVon(zeige)}. Wählen Sie unten eine Palette.`;
    adresseSetzen();
    gruppenLinks();
    zurueckLinks();
    if (ansagen && farbAnsage) farbAnsage.textContent = wahl ? `${paletteTitelVon(wahl)} gewählt. Diesen Namen bitte nennen.` : '';
  }

  const normalerKlick = (e: MouseEvent): boolean => !(e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0);

  // Ein Zuhoerer fuer alles im Farbschritt: Karten entstehen erst beim Oeffnen.
  schema.querySelector('#schritt-3')?.addEventListener('click', (e) => {
    const ev = e as MouseEvent;
    const ziel = (ev.target as HTMLElement | null)?.closest<HTMLAnchorElement>('a');
    if (!ziel || !normalerKlick(ev)) return;
    if (ziel.dataset.gruppeWahl) {
      ev.preventDefault();
      oeffneGruppe(ziel.dataset.gruppeWahl);
    } else if (ziel.hasAttribute('data-gruppe-zurueck')) {
      ev.preventDefault();
      schliesseGruppe();
    } else if (ziel.dataset.paletteWahl) {
      ev.preventDefault();
      setzePalette(ziel.dataset.paletteWahl);
      // Eine Empfehlung oeffnet ihre Gruppe, damit die Wahl auch dort sichtbar ist.
      if (ziel.dataset.gruppeZiel && ziel.dataset.gruppeZiel !== schema.dataset.gruppe) oeffneGruppe(ziel.dataset.gruppeZiel, false);
    }
  });

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
