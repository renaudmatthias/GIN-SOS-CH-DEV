-- ============================================================
--  SOS-CH — Initialisation de la base de données PostgreSQL
-- ============================================================
-- Ce script SQL crée les tables et insère des données de test.
--
-- QU'EST-CE QUE SQL ?
--   SQL = Structured Query Language = langage pour parler à une base de données.
--   On écrit des commandes (SELECT, INSERT, CREATE...) que PostgreSQL exécute.
--
-- COMMENT EXÉCUTER CE SCRIPT ?
--   Option 1 — Depuis le terminal :
--     psql -U postgres -d sosdb -f init_db.sql
--
--   Option 2 — Créer la DB et l'initialiser en une seule fois :
--     psql -U postgres -c "CREATE DATABASE sosdb;" &&
--     psql -U postgres -d sosdb -f init_db.sql
--
-- LES COMMENTAIRES EN SQL commencent par "--" (comme ces lignes !)
-- ============================================================


-- ============================================================
-- ÉTAPE 1 : Activer l'extension PostGIS
-- ============================================================
-- PostgreSQL seul ne comprend pas les coordonnées géographiques.
-- PostGIS est une "extension" qui ajoute des types et des fonctions
-- pour stocker et manipuler des données géospatiales (points, lignes, polygones...).
--
-- CREATE EXTENSION IF NOT EXISTS = on installe l'extension seulement
-- si elle n'est pas déjà installée (pour éviter une erreur si on relance le script).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS postgis;


-- ============================================================
-- ÉTAPE 2 : Créer les 3 tables
-- ============================================================
-- Une "table" en base de données est comme un tableau Excel :
--   - Chaque colonne a un nom et un type de données
--   - Chaque ligne est un enregistrement (ex: un hôpital)
--
-- Nos 3 tables ont toutes la même structure :
--   id   → SERIAL PRIMARY KEY : numéro unique auto-incrémenté (1, 2, 3, ...)
--           PRIMARY KEY = clé primaire, identifie chaque ligne de façon unique
--   name → TEXT NOT NULL DEFAULT '' : du texte, obligatoire, vide par défaut
--   geom → GEOMETRY(Point, 2056) : un point géographique
--           2056 = code EPSG du système de coordonnées suisse LV95
--
-- IF NOT EXISTS = on ne crée la table que si elle n'existe pas encore.
-- ============================================================

-- Table des casernes de pompiers
CREATE TABLE IF NOT EXISTS fire_station (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);

-- Table des hôpitaux
CREATE TABLE IF NOT EXISTS hospital (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);

-- Table des postes de police
CREATE TABLE IF NOT EXISTS police (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    geom GEOMETRY(Point, 2056) NOT NULL
);


-- ============================================================
-- ÉTAPE 3 : Créer les index spatiaux
-- ============================================================
-- Un "index" est comme l'index d'un livre : il permet de trouver
-- une information rapidement sans lire toute la table.
--
-- USING GIST = type d'index optimisé pour les données géospatiales.
-- Sans index, une recherche géographique (ex: trouver les hôpitaux
-- dans un rayon de 5 km) serait très lente sur de grandes tables.
--
-- ON fire_station (geom) = on crée l'index sur la colonne "geom" de la table.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_fire_station_geom ON fire_station USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_hospital_geom     ON hospital     USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_police_geom       ON police       USING GIST (geom);


-- ============================================================
-- ÉTAPE 4 : Insérer des données de test
-- ============================================================
-- INSERT INTO = ajouter des lignes dans une table.
-- On précise les colonnes et les valeurs correspondantes.
--
-- ST_MakePoint(x, y) : fonction PostGIS pour créer un point géographique
--   à partir de coordonnées x (Est) et y (Nord).
--   En LV95 (système suisse) : x ≈ 2'600'000, y ≈ 1'200'000
--
-- ST_SetSRID(..., 2056) : associe le système de coordonnées au point.
--   SRID 2056 = code officiel du système LV95 (Suisse).
--
-- ON CONFLICT DO NOTHING : si un enregistrement identique existe déjà,
--   on ne fait rien (on ne génère pas d'erreur et on n'écrase rien).
--   Pratique pour relancer le script plusieurs fois sans dupliquer les données.
-- ============================================================

-- ── Casernes de pompiers ─────────────────────────────────────────────────
INSERT INTO fire_station (name, geom) VALUES
    -- Chaque ligne = un lieu, avec son nom et ses coordonnées LV95
    ('Caserne Centrale Lausanne',    ST_SetSRID(ST_MakePoint(2537800, 1152000), 2056)),
    ('Caserne Bern Mitte',           ST_SetSRID(ST_MakePoint(2600700, 1199700), 2056)),
    ('Caserne Zürich City',          ST_SetSRID(ST_MakePoint(2683000, 1248000), 2056)),
    ('Caserne Genève Plainpalais',   ST_SetSRID(ST_MakePoint(2499500, 1117500), 2056)),
    ('Caserne Yverdon-les-Bains',    ST_SetSRID(ST_MakePoint(2538500, 1181000), 2056))
ON CONFLICT DO NOTHING;

-- ── Hôpitaux ─────────────────────────────────────────────────────────────
INSERT INTO hospital (name, geom) VALUES
    ('CHUV Lausanne',                ST_SetSRID(ST_MakePoint(2535000, 1153000), 2056)),
    ('Inselspital Bern',             ST_SetSRID(ST_MakePoint(2598500, 1200000), 2056)),
    ('UniversitätsSpital Zürich',    ST_SetSRID(ST_MakePoint(2683500, 1249000), 2056)),
    ('HUG Genève',                   ST_SetSRID(ST_MakePoint(2499000, 1118500), 2056)),
    ('Hôpital d''Yverdon',           ST_SetSRID(ST_MakePoint(2537500, 1180400), 2056))
    -- Note : en SQL, une apostrophe dans un texte s'écrit '' (deux apostrophes)
ON CONFLICT DO NOTHING;

-- ── Postes de police ─────────────────────────────────────────────────────
INSERT INTO police (name, geom) VALUES
    ('Police Cantonale Lausanne',    ST_SetSRID(ST_MakePoint(2538000, 1152500), 2056)),
    ('Kantonspolizei Bern',          ST_SetSRID(ST_MakePoint(2601000, 1199000), 2056)),
    ('Kantonspolizei Zürich',        ST_SetSRID(ST_MakePoint(2682500, 1248500), 2056)),
    ('Police Cantonale Genève',      ST_SetSRID(ST_MakePoint(2499800, 1117000), 2056)),
    ('Police Yverdon-les-Bains',     ST_SetSRID(ST_MakePoint(2538200, 1181200), 2056))
ON CONFLICT DO NOTHING;


-- ============================================================
-- ÉTAPE 5 : Vérification — afficher le nombre de points par table
-- ============================================================
-- SELECT = lire des données dans une table
-- COUNT(*) = compter le nombre de lignes
-- UNION ALL = combiner les résultats de plusieurs SELECT en un seul tableau
--
-- Ce SELECT devrait retourner :
--   fire_station | 5
--   hospital     | 5
--   police       | 5
-- ============================================================

SELECT 'fire_station' AS table_name, COUNT(*) AS nb_points FROM fire_station
UNION ALL
SELECT 'hospital',                   COUNT(*)               FROM hospital
UNION ALL
SELECT 'police',                     COUNT(*)               FROM police;

-- ============================================================
-- FIN DU SCRIPT
-- Si tout s'est bien passé, la base de données est prête !
-- Vous pouvez maintenant démarrer l'API avec : python api.py
-- ============================================================
