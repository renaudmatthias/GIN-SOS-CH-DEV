"""
SOS-CH — API REST Flask + PostgreSQL/PostGIS
=============================================
Ce fichier contient TOUT : connexion DB, création des tables, et les endpoints.
Pas besoin de crud.py.

Tables :
  - fire_station  (pompiers)
  - hospital      (hôpitaux)
  - police        (police)

Chaque table a : id, name, geom (EPSG:2056)

Endpoints :
  GET  /api/points/<table>        — lister tous les points (JSON)
  POST /api/points/<table>        — ajouter un point
  PUT  /api/points/<table>/<id>   — modifier un point
  DELETE /api/points/<table>/<id> — supprimer un point
  GET  /api/export/<table>        — exporter en GeoJSON

Démarrage :
  python api.py
  → http://localhost:5000

Auteurs : Reto Lazzeri, Matthias Renaud & Florian Zaccomer — HEIG-VD
"""

import os
import sys
import json
import psycopg2
import psycopg2.extras
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Application Flask ─────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)  # Autorise les requêtes depuis le frontend (CORS = Cross-Origin)

# ── Tables autorisées (sécurité : pas d'injection SQL via le nom de table) ─
TABLES_AUTORISEES = ("fire_station", "hospital", "police")

# ── Configuration de la base de données (variables d'environnement) ────────
DB_CONFIG = {
    "host":     os.getenv("PGHOST",     "localhost"),
    "port":     int(os.getenv("PGPORT", 5432)),
    "dbname":   os.getenv("PGDATABASE", "sosdb"),
    "user":     os.getenv("PGUSER",     "postgres"),
    "password": os.getenv("PGPASSWORD", ""),
}


# ── Fonction utilitaire : ouvrir une connexion PostgreSQL ─────────────────
def get_conn():
    """Retourne une connexion psycopg2 à la base de données."""
    return psycopg2.connect(**DB_CONFIG)


# ── Fonctions utilitaires pour les réponses JSON ──────────────────────────
def erreur(message, code=400):
    """Retourne une réponse JSON d'erreur."""
    return jsonify({"erreur": message}), code

def succes(donnees, code=200):
    """Retourne une réponse JSON de succès."""
    return jsonify(donnees), code


# ── Création automatique des tables au démarrage ──────────────────────────
def initialiser_base_de_donnees():
    """
    Crée les tables fire_station, hospital et police si elles n'existent pas.
    Appelé automatiquement au démarrage de l'API.
    Chaque table contient :
      - id   : identifiant unique auto-incrémenté
      - name : nom du lieu
      - geom : point géographique en coordonnées suisses LV95 (EPSG:2056)
    """
    conn = get_conn()
    with conn.cursor() as cur:
        # Activer PostGIS si pas encore fait
        cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

        # Créer les 3 tables avec la même structure
        for table in TABLES_AUTORISEES:
            cur.execute(f"""
                CREATE TABLE IF NOT EXISTS {table} (
                    id   SERIAL PRIMARY KEY,
                    name TEXT NOT NULL DEFAULT '',
                    geom GEOMETRY(Point, 2056) NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_{table}_geom
                    ON {table} USING GIST (geom);
            """)
    conn.commit()
    conn.close()
    print("OK Tables crees (ou deja existantes) : fire_station, hospital, police")


# ── GET /api/points/<table> ───────────────────────────────────────────────
@app.route("/api/points/<table>", methods=["GET"])
def lister_points(table):
    """
    Retourne tous les points d'une table sous forme JSON.
    Exemple : GET /api/points/hospital
    Réponse : { "count": 5, "points": [ {id, name, x, y}, ... ] }
    """
    # Vérifier que la table est autorisée
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, name,
                       ST_X(geom) AS x,
                       ST_Y(geom) AS y
                FROM {table}
                ORDER BY id DESC
                LIMIT 200
            """)
            lignes = cur.fetchall()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({
        "count":  len(lignes),
        "points": [dict(l) for l in lignes]
    })


# ── POST /api/points/<table> ──────────────────────────────────────────────
@app.route("/api/points/<table>", methods=["POST"])
def ajouter_point(table):
    """
    Ajoute un nouveau point dans la table indiquée.
    Corps JSON attendu : { "name": "Nom", "x": 2660000, "y": 1190000 }
    Retourne l'id du nouveau point.
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    # Lire le corps de la requête
    corps = request.get_json(silent=True) or {}
    nom   = corps.get("name", "")
    x     = corps.get("x")
    y     = corps.get("y")

    # Vérifications de base
    if x is None or y is None:
        return erreur("Les coordonnées x et y sont obligatoires (EPSG:2056)")
    try:
        x, y = float(x), float(y)
    except (TypeError, ValueError):
        return erreur("x et y doivent être des nombres")

    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(f"""
                INSERT INTO {table} (name, geom)
                VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 2056))
                RETURNING id
            """, (nom, x, y))
            nouvel_id = cur.fetchone()[0]
        conn.commit()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    print(f"OK Ajoute dans {table} : id={nouvel_id}, name={nom}, x={x}, y={y}")
    return succes({"id": nouvel_id, "name": nom, "x": x, "y": y}, 201)


# ── PUT /api/points/<table>/<id> ──────────────────────────────────────────
@app.route("/api/points/<table>/<int:point_id>", methods=["PUT"])
def modifier_point(table, point_id):
    """
    Modifie un point existant (nom et/ou coordonnées).
    Corps JSON : { "name": "Nouveau nom", "x": 2660000, "y": 1190000 }
    Au moins un champ doit être fourni.
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    corps = request.get_json(silent=True) or {}
    nom   = corps.get("name")
    x     = corps.get("x")
    y     = corps.get("y")

    # Construire la requête UPDATE dynamiquement
    champs, valeurs = [], []

    if nom is not None:
        champs.append("name = %s")
        valeurs.append(nom)

    if x is not None and y is not None:
        try:
            x, y = float(x), float(y)
        except ValueError:
            return erreur("x et y doivent être des nombres")
        champs.append("geom = ST_SetSRID(ST_MakePoint(%s, %s), 2056)")
        valeurs += [x, y]
    elif x is not None or y is not None:
        return erreur("Fournir x ET y ensemble pour modifier la position")

    if not champs:
        return erreur("Aucun champ à modifier (name, x, y)")

    valeurs.append(point_id)

    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(
                f"UPDATE {table} SET {', '.join(champs)} WHERE id = %s",
                valeurs
            )
            if cur.rowcount == 0:
                conn.rollback()
                conn.close()
                return erreur(f"Point id={point_id} introuvable", 404)
        conn.commit()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"modifie": True, "id": point_id})


# ── DELETE /api/points/<table>/<id> ───────────────────────────────────────
@app.route("/api/points/<table>/<int:point_id>", methods=["DELETE"])
def supprimer_point(table, point_id):
    """
    Supprime un point par son id.
    Exemple : DELETE /api/points/fire_station/42
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        with conn.cursor() as cur:
            cur.execute(f"DELETE FROM {table} WHERE id = %s", (point_id,))
            if cur.rowcount == 0:
                conn.rollback()
                conn.close()
                return erreur(f"Point id={point_id} introuvable", 404)
        conn.commit()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"supprime": True, "id": point_id})


# ── GET /api/export/<table> ───────────────────────────────────────────────
@app.route("/api/export/<table>", methods=["GET"])
def exporter_geojson(table):
    """
    Exporte tous les points d'une table au format GeoJSON.
    Utile pour recharger les données dans OpenLayers.
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        with conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
            cur.execute(f"""
                SELECT id, name,
                       ST_AsGeoJSON(geom)::json AS geometry
                FROM {table}
                ORDER BY id
            """)
            lignes = cur.fetchall()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    # Construire le GeoJSON
    features = [
        {
            "type":     "Feature",
            "geometry": dict(l)["geometry"],
            "properties": {
                "id":   l["id"],
                "name": l["name"],
                # Propriété compatible avec les GeoJSON statiques existants
                "fclass": table
            }
        }
        for l in lignes
    ]

    geojson = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::2056"}
        },
        "features": features
    }

    return succes(geojson)


# ── Démarrage ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    # Force UTF-8 output on Windows to avoid cp1252 encoding crashes
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    print("=== SOS-CH API ===")
    print(f"  Base de donnees : {DB_CONFIG['dbname']} sur {DB_CONFIG['host']}:{DB_CONFIG['port']}")

    # Tester la connexion et créer les tables
    try:
        initialiser_base_de_donnees()
        print("OK Base de donnees prete")
    except Exception as e:
        # Encode safely for Windows console (avoids cp1252/UTF-8 crash on accented chars)
        enc = sys.stdout.encoding or "utf-8"
        safe_msg = str(e).encode(enc, errors="replace").decode(enc)
        print(f"ERREUR connexion PostgreSQL : {safe_msg}")
        print("  -> Cause probable : DB inexistante, mot de passe incorrect, ou PostGIS absent")
        print("  -> Verifiez PGHOST / PGDATABASE / PGUSER / PGPASSWORD")
        print("  -> L'API demarre quand meme, mais les endpoints /api/* echoueront")

    print("  Demarrage sur http://localhost:5000")
    app.run(debug=True, port=5000)
