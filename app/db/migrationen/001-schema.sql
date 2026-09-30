-- dekaru Partner-Portal, Schema Version 1.
-- Laeuft auf Postgres (Neon) und auf PGlite. Alle Anweisungen sind
-- wiederholbar, ein zweiter Lauf aendert nichts.

CREATE TABLE IF NOT EXISTS schema_version (
  version integer PRIMARY KEY,
  angewendet_am timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS benutzer (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  rolle text NOT NULL CHECK (rolle IN ('admin', 'vertriebler')),
  -- Slug aus vertriebler.json in dekaru-rechnungen, verknuepft die Provision.
  vertriebler_slug text UNIQUE,
  passwort_hash text NOT NULL,
  passwort_wechsel_noetig boolean NOT NULL DEFAULT false,
  aktiv boolean NOT NULL DEFAULT true,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  letzter_login timestamptz
);

CREATE TABLE IF NOT EXISTS sitzungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Nur der SHA-256 des Cookie-Tokens liegt in der Datenbank.
  token_hash text NOT NULL UNIQUE,
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  csrf_token text NOT NULL,
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  zuletzt_aktiv timestamptz NOT NULL DEFAULT now(),
  laeuft_ab timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sitzungen_benutzer ON sitzungen(benutzer_id);

-- Ratenbegrenzung beim Login, je E-Mail-Adresse und je IP-Adresse.
CREATE TABLE IF NOT EXISTS login_versuche (
  schluessel text PRIMARY KEY,
  fehlversuche integer NOT NULL DEFAULT 0,
  fenster_start timestamptz NOT NULL DEFAULT now(),
  gesperrt_bis timestamptz
);

CREATE TABLE IF NOT EXISTS kunden (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  name text NOT NULL,
  ort text NOT NULL DEFAULT '',
  ansprechpartner text NOT NULL DEFAULT '',
  telefon text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('angerufen', 'termin', 'zweittermin', 'angebot', 'abschluss', 'absage')),
  -- Tag, an dem der aktuelle Status gesetzt wurde. Damit zaehlen Abschluesse je Monat.
  status_seit date NOT NULL DEFAULT CURRENT_DATE,
  termin_datum date,
  notiz text NOT NULL DEFAULT '',
  erstellt_am timestamptz NOT NULL DEFAULT now(),
  geaendert_am timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS kunden_benutzer ON kunden(benutzer_id);

CREATE TABLE IF NOT EXISTS kapitel_fortschritt (
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  kapitel text NOT NULL,
  erledigt_am timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (benutzer_id, kapitel)
);

CREATE TABLE IF NOT EXISTS quiz_antworten (
  benutzer_id uuid NOT NULL REFERENCES benutzer(id) ON DELETE CASCADE,
  frage_id text NOT NULL,
  kapitel text NOT NULL,
  richtig boolean NOT NULL,
  je_richtig boolean NOT NULL DEFAULT false,
  antwort jsonb,
  versuche integer NOT NULL DEFAULT 1,
  zuletzt timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (benutzer_id, frage_id)
);

CREATE TABLE IF NOT EXISTS provision_abrechnungen (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vertriebler_slug text NOT NULL,
  monat text NOT NULL CHECK (monat ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  daten jsonb NOT NULL,
  importiert_am timestamptz NOT NULL DEFAULT now(),
  importiert_von uuid REFERENCES benutzer(id) ON DELETE SET NULL,
  ausgezahlt_am date,
  UNIQUE (vertriebler_slug, monat)
);

INSERT INTO schema_version (version) VALUES (1) ON CONFLICT DO NOTHING;
