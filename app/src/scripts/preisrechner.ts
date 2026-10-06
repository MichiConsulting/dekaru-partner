// Rechnet die Summe live mit, sobald sich ein Feld aendert. Ohne dieses Skript
// rechnet der Server nach dem Absenden; mit ihm stimmt die Anzeige sofort.
// Es nutzt dieselbe Funktion berechne() wie der Server, es gibt also keine
// zweite Rechnung. Eigene Datei wegen der CSP (script-src 'self').

import { HOSTING_PROVISION_MONATE, MODULE_NUR_MIT, MODULE_PAKET_NAME, auswahlAusFeldern, berechne, euro, findePaket, moduleMoeglich, type Ergebnis } from '../lib/preise.ts';

function zeile(links: string, rechts: string, klasse?: string): HTMLLIElement {
  const li = document.createElement('li');
  if (klasse) li.className = klasse;
  const a = document.createElement('span');
  a.textContent = links;
  const b = document.createElement('span');
  b.textContent = rechts;
  li.append(a, b);
  return li;
}

function setzeText(wurzel: Element, selektor: string, text: string): void {
  const el = wurzel.querySelector<HTMLElement>(selektor);
  if (el) el.textContent = text;
}

function zeige(wurzel: Element, selektor: string, sichtbar: boolean): void {
  const el = wurzel.querySelector<HTMLElement>(selektor);
  if (el) el.hidden = !sichtbar;
}

function schreibe(bereich: Element, e: Ergebnis): void {
  setzeText(bereich, '[data-summe]', euro(e.summeEinmalig));
  const liste = bereich.querySelector<HTMLElement>('[data-aufstellung]');
  if (liste) {
    liste.textContent = '';
    for (const z of e.zeilen) liste.appendChild(zeile(z.bezeichnung, z.betrag === null ? 'nach Absprache' : euro(z.betrag)));
  }
  const h = e.hosting;
  zeige(bereich, '[data-hosting]', Boolean(h));
  zeige(bereich, '[data-provision-hosting]', Boolean(h));
  if (h) {
    setzeText(
      bereich,
      '[data-hosting-text]',
      h.zahlweise === 'jaehrlich' ? `${h.tarif.name}, ${euro(h.jeZahlung)} im Jahr, Jahresvertrag.` : `${h.tarif.name}, ${euro(h.jeZahlung)} im Monat.`,
    );
    setzeText(bereich, '[data-hosting-hinweise]', h.hinweise.join(' '));
    setzeText(
      bereich,
      '[data-provision-hosting]',
      `Dazu Hosting: ${euro(h.provision)} auf die ersten ${HOSTING_PROVISION_MONATE} bezahlten Monate, vierteljährlich ausgezahlt. Gratismonate zählen nicht.`,
    );
  }
  setzeText(bereich, '[data-provision]', euro(e.provisionEinmalig));
  setzeText(bereich, '[data-hinweise]', e.hinweise.join(' '));
}

/**
 * Software-Module nur mit Paket Gross. Beim Laden wird nur gesperrt, was nicht
 * angekreuzt ist: ein alter Briefing-Bogen mit Modul ohne Gross behaelt sein
 * Kreuz und zeigt die Warnung vom Server. Erst ein echter Paketwechsel weg von
 * Gross nimmt angekreuzte Module heraus und sagt das sichtbar.
 */
function moduleAbgleichen(form: HTMLFormElement, paketGewechselt: boolean): void {
  const bereich = form.querySelector<HTMLElement>('[data-module-bereich]');
  if (!bereich) return;
  const paket = new FormData(form).get('paket');
  const erlaubt = moduleMoeglich(typeof paket === 'string' ? paket : null);
  const felder = [...bereich.querySelectorAll<HTMLInputElement>('[data-modul-feld]')];
  const entfernt: string[] = [];
  for (const feld of felder) {
    if (!erlaubt && paketGewechselt && feld.checked) {
      feld.checked = false;
      entfernt.push(bereich.querySelector(`label[for="${feld.id}"]`)?.textContent?.trim() ?? '');
    }
    feld.disabled = !erlaubt && !feld.checked;
    feld.closest('.posten')?.classList.toggle('posten--gesperrt', feld.disabled);
  }
  for (const el of bereich.querySelectorAll<HTMLElement>('[data-nur-gross]')) el.hidden = erlaubt;
  const nochAn = felder.filter((f) => f.checked);
  const warnung = bereich.querySelector<HTMLElement>('[data-module-warnung]');
  if (warnung) warnung.hidden = erlaubt || nochAn.length === 0;
  const status = bereich.querySelector<HTMLElement>('[data-module-status]');
  if (!status) return;
  if (entfernt.length > 0) {
    const name = findePaket(typeof paket === 'string' ? paket : null)?.name ?? '';
    status.textContent = `Paket ${name} gewählt: ${entfernt.join(', ')} herausgenommen. Software-Module gibt es ${MODULE_NUR_MIT}.`;
    status.hidden = false;
  } else if (erlaubt && paketGewechselt) {
    status.textContent = `Paket ${MODULE_PAKET_NAME} gewählt: Software-Module sind wählbar.`;
    status.hidden = false;
  }
}

document.querySelectorAll<HTMLFormElement>('form.rechner-form').forEach((form) => {
  const bereich = form.querySelector('[data-summe-bereich]') ?? document.querySelector('[data-summe-bereich]');
  if (!bereich) return;
  const rechnen = () => {
    const felder: Record<string, string> = {};
    for (const [name, wert] of new FormData(form).entries()) if (typeof wert === 'string') felder[name] = wert;
    schreibe(bereich, berechne(auswahlAusFeldern(felder)));
  };
  form.addEventListener('change', (e) => {
    const ziel = e.target as HTMLInputElement | null;
    if (ziel?.name === 'paket' || ziel?.hasAttribute('data-modul-feld')) moduleAbgleichen(form, ziel.name === 'paket');
    rechnen();
  });
  form.addEventListener('input', rechnen);
  document.documentElement.classList.add('js');
  moduleAbgleichen(form, false);
  rechnen();
});
