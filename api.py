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

# ── Importation des bibliothèques ─────────────────────────────────────────
# On importe les outils dont on a besoin pour faire fonctionner le programme.

import os           # Pour lire les variables d'environnement (ex: mot de passe)
import sys          # Pour gérer le système (ex: encodage Windows)
import json         # Pour travailler avec le format JSON (texte structuré)
import pg8000       # Bibliothèque pour se connecter à PostgreSQL depuis Python
import pg8000.dbapi
from flask import Flask, request, jsonify  # Flask = outil pour créer une API web
from flask_cors import CORS                # CORS = permet au navigateur d'appeler l'API

# ── Création de l'application Flask ──────────────────────────────────────
# Flask est un "micro-framework" : il nous permet de créer facilement une API web.
# On crée notre application et on active CORS pour autoriser les appels depuis le navigateur.
app = Flask(__name__)
CORS(app)

# ── Liste des tables autorisées ───────────────────────────────────────────
# Pour des raisons de sécurité, on n'accepte que ces 3 noms de tables.
# Si quelqu'un essaie d'accéder à une autre table, on refuse.
TABLES_AUTORISEES = ("fire_station", "hospital", "police")

# ── Configuration de la base de données ──────────────────────────────────
# Ce dictionnaire contient toutes les infos pour se connecter à PostgreSQL.
# os.getenv("NOM", "valeur_par_defaut") lit une variable d'environnement.
# Si la variable n'existe pas, on utilise la valeur par défaut (ex: "localhost").
DB_CONFIG = {
    "host":     os.getenv("PGHOST",     "localhost"),  # Adresse du serveur PostgreSQL
    "port":     int(os.getenv("PGPORT", 5432)),        # Port (5432 = port par défaut PostgreSQL)
    "database": os.getenv("PGDATABASE", "sosdb"),      # Nom de la base de données
    "user":     os.getenv("PGUSER",     "postgres"),   # Nom d'utilisateur
    "password": os.getenv("PGPASSWORD", "postgres"),   # Mot de passe
}


# ── Fonction : Se connecter à la base de données ──────────────────────────
def get_conn():
    """
    Ouvre et retourne une connexion à la base de données PostgreSQL.
    On utilise pg8000, une bibliothèque Python pour parler à PostgreSQL.
    autocommit = False : les changements ne sont pas sauvegardés automatiquement,
    il faut appeler conn.commit() pour les confirmer.
    """
    conn = pg8000.connect(**DB_CONFIG)  # ** = décompresse le dictionnaire en arguments
    conn.autocommit = False             # On gère les transactions manuellement
    return conn


# ── Fonctions utilitaires pour les réponses JSON ──────────────────────────
# Ces deux petites fonctions simplifient le code : au lieu de répéter
# jsonify(...) partout, on appelle juste erreur() ou succes().

def erreur(message, code=400):
    """Retourne une réponse d'erreur au format JSON. Code 400 = mauvaise requête."""
    return jsonify({"erreur": message}), code

def succes(donnees, code=200):
    """Retourne une réponse de succès au format JSON. Code 200 = OK."""
    return jsonify(donnees), code


# ── Fonction : Créer les tables au démarrage ──────────────────────────────
def initialiser_base_de_donnees():
    """
    Cette fonction est appelée une seule fois au démarrage du serveur.
    Elle crée les 3 tables (fire_station, hospital, police) si elles n'existent pas encore.
    CREATE TABLE IF NOT EXISTS = on ne crée que si la table n'existe pas déjà.
    """
    conn = get_conn()   # On ouvre une connexion
    cur = conn.cursor() # Un curseur sert à envoyer des commandes SQL

    # On active l'extension PostGIS pour stocker des coordonnées géographiques
    cur.execute("CREATE EXTENSION IF NOT EXISTS postgis;")

    # On crée les 3 tables avec une boucle
    for table in TABLES_AUTORISEES:
        # Chaque table a :
        #   id   = numéro unique auto-incrémenté (1, 2, 3, ...)
        #   name = nom du lieu (texte)
        #   geom = coordonnées géographiques (Point en système suisse LV95 / EPSG:2056)
        cur.execute(f"""
            CREATE TABLE IF NOT EXISTS {table} (
                id   SERIAL PRIMARY KEY,
                name TEXT NOT NULL DEFAULT '',
                geom GEOMETRY(Point, 2056) NOT NULL
            )
        """)
        # On crée un index spatial pour accélérer les recherches géographiques
        # GIST = type d'index optimisé pour les données géospatiales
        cur.execute(f"""
            CREATE INDEX IF NOT EXISTS idx_{table}_geom
                ON {table} USING GIST (geom)
        """)

    conn.commit()   # On confirme tous les changements dans la base
    cur.close()     # On ferme le curseur
    conn.close()    # On ferme la connexion
    print("OK Tables créées : fire_station, hospital, police")


# ══════════════════════════════════════════════════════════════════════════
#  ENDPOINT 1 — GET /api/points/<table>
#  Lister tous les points d'une table
# ══════════════════════════════════════════════════════════════════════════
@app.route("/api/points/<table>", methods=["GET"])
def lister_points(table):
    """
    Retourne la liste des 200 derniers points de la table demandée, au format JSON.
    Exemple d'appel : GET http://localhost:5000/api/points/hospital
    """
    # Vérification de sécurité : on refuse si la table n'est pas dans notre liste
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        cur = conn.cursor()

        # On sélectionne id, name, et les coordonnées x et y du point géographique.
        # ST_X() et ST_Y() sont des fonctions PostGIS pour extraire longitude/latitude.
        # ORDER BY id DESC = du plus récent au plus ancien
        # LIMIT 200 = maximum 200 résultats
        cur.execute(f"""
            SELECT id, name,
                   ST_X(geom) AS x,
                   ST_Y(geom) AS y
            FROM {table}
            ORDER BY id DESC
            LIMIT 200
        """)

        # On transforme les résultats en liste de dictionnaires Python
        # cur.description contient les noms des colonnes
        cols = [d[0] for d in cur.description]                    # ['id', 'name', 'x', 'y']
        lignes = [dict(zip(cols, row)) for row in cur.fetchall()] # [{'id':1, 'name':'CHUV', ...}, ...]

        cur.close()
        conn.close()
    except Exception as e:
        # Si une erreur survient (ex: problème réseau, SQL incorrect), on retourne l'erreur
        return erreur(str(e), 500)

    return succes({"count": len(lignes), "points": lignes})


# ══════════════════════════════════════════════════════════════════════════
#  ENDPOINT 2 — POST /api/points/<table>
#  Ajouter un nouveau point
# ══════════════════════════════════════════════════════════════════════════
@app.route("/api/points/<table>", methods=["POST"])
def ajouter_point(table):
    """
    Ajoute un nouveau point dans la table.
    Le client envoie un JSON avec : { "name": "...", "x": ..., "y": ... }
    Exemple : POST http://localhost:5000/api/points/hospital
              Body: {"name": "HUG Genève", "x": 2499000, "y": 1118500}
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    # On lit le corps de la requête (le JSON envoyé par le client)
    # silent=True = si ce n'est pas du JSON valide, on retourne {} au lieu d'une erreur
    corps = request.get_json(silent=True) or {}
    nom = corps.get("name", "")  # Nom du lieu (facultatif, vide par défaut)
    x   = corps.get("x")         # Coordonnée X (obligatoire)
    y   = corps.get("y")         # Coordonnée Y (obligatoire)

    # Vérification : x et y sont obligatoires
    if x is None or y is None:
        return erreur("Les coordonnées x et y sont obligatoires (EPSG:2056)")

    # On convertit x et y en nombres décimaux (float)
    try:
        x, y = float(x), float(y)
    except (TypeError, ValueError):
        return erreur("x et y doivent être des nombres")

    try:
        conn = get_conn()
        cur = conn.cursor()

        # INSERT INTO = ajouter une ligne dans la table
        # ST_MakePoint(x, y) = créer un point géographique à partir de x et y
        # ST_SetSRID(..., 2056) = préciser que c'est le système de coordonnées suisse LV95
        # RETURNING id = retourner l'id de la ligne qu'on vient d'insérer
        cur.execute(f"""
            INSERT INTO {table} (name, geom)
            VALUES (%s, ST_SetSRID(ST_MakePoint(%s, %s), 2056))
            RETURNING id
        """, (nom, x, y))  # Les %s sont remplacés par les valeurs (protection contre les injections SQL)

        nouvel_id = cur.fetchone()[0]  # On récupère l'id généré automatiquement
        conn.commit()                  # On confirme l'insertion
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    print(f"OK Ajouté dans {table} : id={nouvel_id}, name={nom}, x={x}, y={y}")
    # Code 201 = "Created" (ressource créée avec succès)
    return succes({"id": nouvel_id, "name": nom, "x": x, "y": y}, 201)


# ══════════════════════════════════════════════════════════════════════════
#  ENDPOINT 3 — PUT /api/points/<table>/<id>
#  Modifier un point existant
# ══════════════════════════════════════════════════════════════════════════
@app.route("/api/points/<table>/<int:point_id>", methods=["PUT"])
def modifier_point(table, point_id):
    """
    Modifie un point existant (son nom et/ou ses coordonnées).
    On peut modifier seulement le nom, seulement la position, ou les deux.
    Exemple : PUT http://localhost:5000/api/points/hospital/3
              Body: {"name": "Nouveau Nom", "x": 2537000, "y": 1152000}
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    corps = request.get_json(silent=True) or {}
    nom = corps.get("name")  # None si pas fourni
    x   = corps.get("x")
    y   = corps.get("y")

    # On construit dynamiquement la requête UPDATE selon ce qui est fourni
    champs  = []  # Ex: ["name = %s", "geom = ST_SetSRID(...)"]
    valeurs = []  # Les valeurs correspondantes

    # Si on a un nouveau nom, on l'ajoute à la liste des champs à modifier
    if nom is not None:
        champs.append("name = %s")
        valeurs.append(nom)

    # Si on a x ET y, on modifie aussi la position géographique
    if x is not None and y is not None:
        try:
            x, y = float(x), float(y)
        except ValueError:
            return erreur("x et y doivent être des nombres")
        champs.append("geom = ST_SetSRID(ST_MakePoint(%s, %s), 2056)")
        valeurs += [x, y]
    elif x is not None or y is not None:
        # Si seulement x ou seulement y est fourni, c'est une erreur
        return erreur("Fournir x ET y ensemble pour modifier la position")

    # Si rien n'est fourni, on retourne une erreur
    if not champs:
        return erreur("Aucun champ à modifier (name, x, y)")

    valeurs.append(point_id)  # L'id va en dernier pour la clause WHERE

    try:
        conn = get_conn()
        cur = conn.cursor()

        # On exécute le UPDATE avec les champs construits dynamiquement
        # ', '.join(champs) = "name = %s, geom = ST_SetSRID(...)"
        cur.execute(
            f"UPDATE {table} SET {', '.join(champs)} WHERE id = %s",
            valeurs
        )

        # cur.rowcount = nombre de lignes modifiées
        # Si 0 ligne modifiée, l'id n'existe pas dans la table
        if cur.rowcount == 0:
            conn.rollback()  # On annule la transaction
            cur.close()
            conn.close()
            return erreur(f"Point id={point_id} introuvable", 404)  # 404 = Not Found

        conn.commit()
        cur.close()
        conn.close()
    except Exception as e:
        return erreur(str(e), 500)

    return succes({"modifie": True, "id": point_id})


# ══════════════════════════════════════════════════════════════════════════
#  ENDPOINT 4 — DELETE /api/points/<table>/<id>
#  Supprimer un point
# ══════════════════════════════════════════════════════════════════════════
@app.route("/api/points/<table>/<int:point_id>", methods=["DELETE"])
def supprimer_point(table, point_id):
    """
    Supprime un point de la base de données.
    Exemple : DELETE http://localhost:5000/api/points/hospital/3
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        cur = conn.cursor()

        # DELETE FROM = supprimer les lignes qui correspondent à la condition WHERE
        cur.execute(f"DELETE FROM {table} WHERE id = %s", (point_id,))

        # Si aucune ligne supprimée, l'id n'existe pas
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


# ══════════════════════════════════════════════════════════════════════════
#  ENDPOINT 5 — GET /api/export/<table>
#  Exporter tous les points au format GeoJSON
# ══════════════════════════════════════════════════════════════════════════
@app.route("/api/export/<table>", methods=["GET"])
def exporter_geojson(table):
    """
    Exporte tous les points d'une table au format GeoJSON.
    GeoJSON est un format standard pour partager des données géographiques.
    Il peut être ouvert directement dans QGIS, Leaflet, etc.
    Exemple : GET http://localhost:5000/api/export/hospital
    """
    if table not in TABLES_AUTORISEES:
        return erreur(f"Table inconnue. Valeurs possibles : {list(TABLES_AUTORISEES)}")

    try:
        conn = get_conn()
        cur = conn.cursor()

        # ST_AsGeoJSON(geom) = convertit la géométrie PostGIS en texte GeoJSON
        # ::text = on force la conversion en texte (casting)
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

    # On construit la structure GeoJSON standard (FeatureCollection)
    # Chaque point devient un "Feature" avec sa géométrie et ses propriétés
    features = [
        {
            "type": "Feature",
            "geometry": json.loads(l["geometry"]),  # On parse le texte JSON en dictionnaire
            "properties": {
                "id":     l["id"],
                "name":   l["name"],
                "fclass": table   # Type du lieu (ex: "hospital")
            }
        }
        for l in lignes  # Boucle sur chaque ligne = une "list comprehension"
    ]

    # Structure complète GeoJSON avec le système de coordonnées (CRS = EPSG:2056)
    geojson = {
        "type": "FeatureCollection",
        "crs": {
            "type": "name",
            "properties": {"name": "urn:ogc:def:crs:EPSG::2056"}
        },
        "features": features
    }

    return succes(geojson)


# ══════════════════════════════════════════════════════════════════════════
#  DÉMARRAGE DU SERVEUR
# ══════════════════════════════════════════════════════════════════════════
# Ce bloc n'est exécuté que si on lance ce fichier directement avec "python api.py"
# (et non si on l'importe depuis un autre fichier Python)
if __name__ == "__main__":

    # Sur Windows, on configure l'encodage UTF-8 pour afficher les accents correctement
    if sys.platform == "win32":
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")

    print("=== SOS-CH API ===")
    print(f"  Base de données : {DB_CONFIG['database']} sur {DB_CONFIG['host']}:{DB_CONFIG['port']}")

    # On essaie d'initialiser la base de données au démarrage
    try:
        initialiser_base_de_donnees()
        print("OK Base de données prête")
    except Exception as e:
        # Si la connexion échoue (ex: PostgreSQL pas démarré), on affiche un message
        # mais on démarre quand même le serveur Flask
        enc = sys.stdout.encoding or "utf-8"
        safe_msg = str(e).encode(enc, errors="replace").decode(enc)
        print(f"ERREUR connexion PostgreSQL : {safe_msg}")
        print("  -> Vérifiez PGHOST / PGDATABASE / PGUSER / PGPASSWORD")
        print("  -> L'API démarre quand même, mais les endpoints /api/* échoueront")

    print("  Démarrage sur http://localhost:5000")
    # debug=True = relance automatiquement le serveur si on modifie le code
    app.run(debug=True, port=5000)
