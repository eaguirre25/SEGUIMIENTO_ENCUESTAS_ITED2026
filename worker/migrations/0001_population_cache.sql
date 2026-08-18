CREATE TABLE IF NOT EXISTS dashboard_population_cache (
  population TEXT PRIMARY KEY CHECK (population IN ('students', 'teachers', 'families')),
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO dashboard_population_cache (population, payload, updated_at)
SELECT 'students', payload, updated_at
FROM dashboard_cache
WHERE id = 1;
