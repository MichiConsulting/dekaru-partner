-- dekaru Partner-Portal, Schema Version 2: Uebungsstand der Pflichtsaetze
-- aus der Gespraechshilfe (inhalt/gespraechshilfe.json). Wiederholbar.
--
-- Auf der Live-Datenbank einmalig anwenden:
--   cd app && export DATABASE_URL='...' && npm run db:migrate && unset DATABASE_URL

CREATE TABLE IF NOT EXISTS pflichtsatz_antworten (
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  -- id des Eintrags in gespraechshilfe.json, zum Beispiel g01
  satz_id text NOT NULL,
  -- Uebungsform des letzten Versuchs: luecken oder reihenfolge
  modus text NOT NULL CHECK (modus IN ('luecken', 'reihenfolge')),
  -- richtig: der letzte Versuch stimmte, dann "sitzt" der Satz
  richtig boolean NOT NULL,
  je_richtig boolean NOT NULL DEFAULT false,
  antwort jsonb,
  versuche integer NOT NULL DEFAULT 1,
  zuletzt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (benutzer_id, satz_id)
);

INSERT INTO schema_version (version) VALUES (2) ON CONFLICT DO NOTHING;
