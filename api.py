"""
SOS-CH — API REST Flask + PostgreSQL/PostGIS
=============================================
Ce fichier contient TOUT : connexion DB, création des tables, et les endpoints.

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
  set PGPASSWORD=postgres
  python api.py
  → http://localhost:5000

Auteurs : Reto Lazzeri, Matthias Renaud & Florian Zaccomer — HEIG-VD
"""

import os
import sys
import json
import pg8000
import pg8000.dbapi
from flask import Flask, request, jsonify
from flask_cors import CORS

# ── Application Flask ─────────────────────────────────────────────────────
app = Flask(__name__)
CORS(app)

# ── Tables autorisées ─────────────────────────────────────────────────────
TABLES_AUTORISEES = ("fire_station", "hospital", "police")

# ── Configuration de la base de données ──────────────────────────────────
DB_CONFIG = {
    "host":     os.getenv("PGHOST",     "localhost"),
    "port":     int(os.getenv("PGPORT", 5432)),
    "database": os.getenv("PGDATABASE", "sosdb"),
    "user":     os.getenv("PGUSER",     "postgres"),
    "password": os.getenv("PGPASSWORD", "postgres"),
}


# ── Connexion pg8000 ──────────────────────────────────────────────────────
def get_conn():
    """Retourne une connexion pg8000 à la base de données."""
    conn = pg8000.connect(**DB_CONFIG)
    conn.autocommit = False
    return conn


# ── Réponses JSON ─────────────────────────────────────────────────────────
def erreur(message, code=400):
    return jsonify({"erreur": message}), code

def succes(donnees, code=200):
    return jsonify(donnees), code


# ── Création automatique des tables ───────────────────────────────────────
def initialiser_base_de_donnees():
    conn = get_conn()
    cur = conn.cursor()

    # Activer PostGIS
    cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # Créer les 3 tables
    for table in TABLES_AUTORISEES:
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id   SERIAL PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                geom GEOMETRY(Point, 2056) NOT NULL
            )
        """)
        cur.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{table}_geom
                ON {table} USING GIST (geom)
        """)

    conn.commit()
    cur.close()
    conn.close()
    print("OK Tables crees : fire_station, hospital, police")


# ── GET /api/points/<table> ───────────────────────────────────────────────
@app.route("/api/points/<table>", methods=["GET"])
def lister_points(table):
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")
    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT id, name,
                   ST_X(geom) AS x,
                   ST_Y(geom) AS y
            FROM {table}
            ORDER BY id DESC
            LIMIT 200
        """)
        cols = [d[0] for d in cur.description]
        lignes = [dict(zip(cols, row)) for row in cur.fetchall()]
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"count": len(lignes), "points": lignes})


# ── POST /api/points/<table> ──────────────────────────────────────────────
@app.route("/api/points/<table>", methods=["POST"])
def ajouter_point(table):
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    corps = request.get_json(silent=True) or {}
    nom = corps.get("name", "")
    x   = corps.get("x")
    y   = corps.get("y")

    if x is None or y is None:
        return erreur("Les coordonnees x et y sont obligatoires (EPSG:2056)")
    try:
        x, y = float(x), float(y)
    except (TypeError, ValueError):
        return erreur("x et y doivent etre des nombres")

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"""
            INSERT INTO {table} (name, geom)
            VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 2056))
            RETURNING id
        """, (nom, x, y))
        nouvel_id = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    print(f"OK Ajoute dans {table} : id={nouvel_id}, name={nom}, x={x}, y={y}")
    return succes({"id": nouvel_id, "name": nom, "x": x, "y": y}, 201)


# ── PUT /api/points/<table>/<id> ──────────────────────────────────────────
@app.route("/api/points/<table>/<int:point_id>", methods=["PUT"])
def modifier_point(table, point_id):
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    corps = request.get_json(silent=True) or {}
    nom = corps.get("name")
    x   = corps.get("x")
    y   = corps.get("y")

    champs, valeurs = [], []

    if nom is not None:
        champs.append("name = %s")
        valeurs.append(nom)

    if x is not None and y is not None:
        try:
            x, y = float(x), float(y)
        except ValueError:
            return erreur("x et y doivent etre des nombres")
        champs.append("geom = ST_SetSRID(ST_MakePoint(%s, %s), 2056)")
        valeurs += [x, y]
    elif x is not None or y is not None:
        return erreur("Fournir x ET y ensemble pour modifier la position")

    if not champs:
        return erreur("Aucun champ a modifier (name, x, y)")

    valeurs.append(point_id)

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(
            f"UPDATE {table} SET {', '.join(champs)} WHERE id = %s",
            valeurs
        )
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            return erreur(f"Point id={point_id} introuvable", 404)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"modifie": True, "id": point_id})


# ── DELETE /api/points/<table>/<id> ───────────────────────────────────────
@app.route("/api/points/<table>/<int:point_id>", methods=["DELETE"])
def supprimer_point(table, point_id):
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"DELETE FROM {table} WHERE id = %s", (point_id,))
        if cur.rowcount == 0:
            conn.rollback()
            cur.close()
            conn.close()
            return erreur(f"Point id={point_id} introuvable", 404)
        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"supprime": True, "id": point_id})


# ── GET /api/export/<table> ───────────────────────────────────────────────
@app.route("/api/export/<table>", methods=["GET"])
def exporter_geojson(table):
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        cur = conn.cursor()
        cur.execute(f"""
            SELECT id, name,
                   ST_AsGeoJSON(geom)::text AS geometry
            FROM {table}
            ORDER BY id
        """)
        cols = [d[0] for d in cur.description]
        lignes = [dict(zip(cols, row)) for row in cur.fetchall()]
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    features = [
        {
            "type": "Feature",
            "geometry": json.loads(l["geometry"]),
            "properties": {
                "id":     l["id"],
                "name":   l["name"],
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
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    print("=== SOS-CH API ===")
    print(f"  Base de donnees : {DB_CONFIG['database']} sur {DB_CONFIG['host']}:{DB_CONFIG['port']}")

    try:
        initialiser_base_de_donnees()
        print("OK Base de donnees prete")
    except Exception as e:
        enc = sys.stdout.encoding or "utf-8"
        safe_msg = str(e).encode(enc, errors="replace").decode(enc)
        print(f"ERREUR connexion PostgreSQL : {safe_msg}")
        print("  -> Verifiez PGHOST / PGDATABASE / PGUSER / PGPASSWORD")
        print("  -> L'API demarre quand meme, mais les endpoints /api/* echoueront")

    print("  Demarrage sur http://localhost:5000")
    app.run(debug=True, port=5000)
