-- ============================================================
--  SOS-CH — Initialisation de la base de données PostgreSQL
-- ============================================================
-- Ce script crée les tables et insère quelques données de test.
-- Pour l'exécuter :
--   psql -U postgres -d sosdb -f init_db.sql
--
-- Ou depuis la ligne de commande (tout en une fois) :
--   psql -U postgres -c "CREATE DATABASE sosdb;" && \
--   psql -U postgres -d sosdb -f init_db.sql
-- ============================================================

-- 1) Activer PostGIS (extension géospatiale pour PostgreSQL)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- 2) Créer les 3 tables (pompiers, hôpitaux, police)
--    Chaque table a :
--      id   → identifiant unique auto-incrémenté
--      name → nom du service
--      geom → point géographique en LV95 (système suisse EPSG:2056)
-- ============================================================

CREATE TABLE IF NOT EXISTS fire_station (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);

CREATE TABLE IF NOT EXISTS hospital (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);

CREATE TABLE IF NOT EXISTS police (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);

-- 3) Index spatiaux pour accélérer les recherches géographiques
CREATE INDEX IF NOT EXISTS idx_fire_station_geom ON fire_station USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hospital_geom     ON hospital     USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_police_geom       ON police       USING GIST (geom);

-- ============================================================
-- 4) Données de test (quelques points en Suisse)
--    Les coordonnées sont en LV95 (x ≈ 2'600'000, y ≈ 1'200'000)
-- ============================================================

-- Casernes de pompiers
INSERT INTO fire_station (name, geom) VALUES
    ('Caserne Centrale Lausanne',    ST_SetSRID(ST_MakePoint(2537800, 1152000), 2056)),
    ('Caserne Bern Mitte',           ST_SetSRID(ST_MakePoint(2600700, 1199700), 2056)),
    ('Caserne Zürich City',          ST_SetSRID(ST_MakePoint(2683000, 1248000), 2056)),
    ('Caserne Genève Plainpalais',   ST_SetSRID(ST_MakePoint(2499500, 1117500), 2056)),
    ('Caserne Yverdon-les-Bains',    ST_SetSRID(ST_MakePoint(2538500, 1181000), 2056))
ON CONFLICT DO NOTHING;

-- Hôpitaux
INSERT INTO hospital (name, geom) VALUES
    ('CHUV Lausanne',                ST_SetSRID(ST_MakePoint(2535000, 1153000), 2056)),
    ('Inselspital Bern',             ST_SetSRID(ST_MakePoint(2598500, 1200000), 2056)),
    ('UniversitätsSpital Zürich',    ST_SetSRID(ST_MakePoint(2683500, 1249000), 2056)),
    ('HUG Genève',                   ST_SetSRID(ST_MakePoint(2499000, 1118500), 2056)),
    ('Hôpital d''Yverdon',           ST_SetSRID(ST_MakePoint(2537500, 1180400), 2056))
ON CONFLICT DO NOTHING;

-- Postes de police
INSERT INTO police (name, geom) VALUES
    ('Police Cantonale Lausanne',    ST_SetSRID(ST_MakePoint(2538000, 1152500), 2056)),
    ('Kantonspolizei Bern',          ST_SetSRID(ST_MakePoint(2601000, 1199000), 2056)),
    ('Kantonspolizei Zürich',        ST_SetSRID(ST_MakePoint(2682500, 1248500), 2056)),
    ('Police Cantonale Genève',      ST_SetSRID(ST_MakePoint(2499800, 1117000), 2056)),
    ('Police Yverdon-les-Bains',     ST_SetSRID(ST_MakePoint(2538200, 1181200), 2056))
ON CONFLICT DO NOTHING;

-- ============================================================
-- 5) Vérification : afficher le nombre de points par table
-- ============================================================
SELECT 'fire_station' AS table_name, COUNT(*) AS nb_points FROM fire_station
UNION ALL
SELECT 'hospital',                   COUNT(*)               FROM hospital
UNION ALL
SELECT 'police',                     COUNT(*)               FROM police;
