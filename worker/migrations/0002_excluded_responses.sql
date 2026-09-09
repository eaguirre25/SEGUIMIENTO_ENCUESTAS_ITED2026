CREATE TABLE IF NOT EXISTS dashboard_excluded_responses (
  response_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL DEFAULT 'Prueba',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO dashboard_excluded_responses (response_key, reason) VALUES
  ('2026-08-12|09:18:21|ees26|00|state|3|complete', 'Respuesta de prueba histórica'),
  ('2026-08-12|09:05:59|ees 1|1|state|1|complete', 'Respuesta de prueba histórica'),
  ('2026-08-11|23:24:09|sin informar|s6|unknown|4|incomplete', 'Respuesta de prueba histórica'),
  ('2026-08-11|22:09:20|sin informar|sin informar|unknown||incomplete', 'Respuesta de prueba histórica');
