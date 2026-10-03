// Bildpfade in den Kapiteln auf die Grafik-Route umbiegen, Tabellen und
// Grafiken in einen schiebbaren Rahmen setzen.
//
// Die Kapitel liegen in inhalt/kapitel/ und verweisen auf Grafiken mit
// ![Text](grafiken/name.svg) oder ../grafiken/name.svg. Ausgeliefert werden
// sie ueber /grafiken/name.svg, hinter dem Login. Ausserdem bekommt jedes
// Bild loading="lazy".

const MUSTER = /(?:^|\/)grafiken\/([^/]+\.svg)$/;

function besuche(knoten, fn) {
  if (!knoten || typeof knoten !== 'object') return;
  fn(knoten);
  if (Array.isArray(knoten.children)) for (const kind of knoten.children) besuche(kind, fn);
}

// Breite Tabellen passen auf dem Handy nicht in die Spalte. Statt die Zellen
// zu zerquetschen, bekommt jede Tabelle denselben schiebbaren Rahmen wie im
// Portal (.tabelle-wrap.schiebbar aus global.css).
function rahmeTabellen(knoten) {
  if (!Array.isArray(knoten.children)) return;
  knoten.children = knoten.children.map((kind) => {
    if (kind?.type === 'element' && kind.tagName === 'table') {
      return { type: 'element', tagName: 'div', properties: { className: ['tabelle-wrap', 'schiebbar'] }, children: [kind] };
    }
    // Ein Absatz, der nur aus einer Grafik besteht, wird zur figure mit
    // demselben schiebbaren Rahmen: auf dem Handy behaelt die Grafik ihre
    // Mindestbreite, damit die Schrift darin lesbar bleibt.
    if (kind?.type === 'element' && kind.tagName === 'p' && istNurBild(kind)) {
      const bild = kind.children.find((k) => k.type === 'element');
      return { type: 'element', tagName: 'figure', properties: { className: ['grafik-wrap', 'schiebbar'] }, children: [bild] };
    }
    rahmeTabellen(kind);
    return kind;
  });
}

function istNurBild(absatz) {
  const kinder = (absatz.children ?? []).filter((k) => !(k.type === 'text' && !k.value.trim()));
  return kinder.length === 1 && kinder[0].type === 'element' && kinder[0].tagName === 'img';
}

export function rehypeGrafiken() {
  return (baum) => {
    besuche(baum, (knoten) => {
      if (knoten.type !== 'element' || knoten.tagName !== 'img') return;
      const src = String(knoten.properties?.src ?? '');
      const treffer = MUSTER.exec(src);
      if (treffer) knoten.properties.src = `/grafiken/${treffer[1]}`;
      knoten.properties.loading = 'lazy';
    });
    rahmeTabellen(baum);
  };
}
