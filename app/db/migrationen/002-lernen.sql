-- dekaru Partner-Portal, Schema Version 2: der neue Lernbereich.
-- Wiederholbar wie Version 1. Anwenden mit: npm run db:migrate

-- Wie weit jemand in den Lernkarten eines Kapitels ist. "gelesen" wird wahr,
-- sobald die letzte Karte erreicht oder die Abfrage gestartet wurde.
CREATE TABLE IF NOT EXISTS lernkarten_stand (
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  kapitel text NOT NULL,
  letzte_karte integer NOT NULL DEFAULT 0,
  gelesen boolean NOT NULL DEFAULT false,
  aktualisiert_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (benutzer_id, kapitel)
);

-- Ein laufender oder abgeschlossener Abfrage-Durchlauf je Kapitel und Person.
-- Eine Frage je Seite: "position" ist die Frage, die gerade dran ist,
-- "ergebnisse" sammelt je beantworteter Frage Antwort und Bewertung.
-- Der Schluessel "wiederholen" steht fuer die kapitelfreie Wiederholung.
CREATE TABLE IF NOT EXISTS abfrage_durchlaeufe (
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  schluessel text NOT NULL,
  fragen jsonb NOT NULL,
  position integer NOT NULL DEFAULT 0,
  ergebnisse jsonb NOT NULL DEFAULT '[]'::jsonb,
  gestartet_am timestamptz NOT NULL DEFAULT now(),
  beendet_am timestamptz,
  PRIMARY KEY (benutzer_id, schluessel)
);

INSERT INTO schema_version (version) VALUES (2) ON CONFLICT DO NOTHING;
