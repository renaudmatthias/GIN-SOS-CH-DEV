# SOS-CH — Carte des services d'urgence en Suisse

Application web interactive permettant de visualiser les pompiers, hôpitaux et postes de police
en Suisse, et de calculer l'itinéraire routier le plus rapide depuis n'importe quel point.

**Auteurs :** Reto Lazzeri, Matthias Renaud & Florian Zaccomer — HEIG-VD

---

## Structure du projet

```
sos-ch/
├── api.py              ← Serveur Flask (API REST)
├── init_db.sql         ← Script SQL pour créer la base de données
├── requirements.txt    ← Dépendances Python
├── README.md           ← Ce fichier
└── frontend/
    ├── index.html      ← Page principale (carte + interface)
    ├── script.js       ← Logique JavaScript (carte, CRUD, itinéraires)
    ├── style.css       ← Styles CSS
    ├── fire_station.geojson  ← Données pompiers (statiques)
    ├── hospital.geojson      ← Données hôpitaux (statiques)
    └── police_v2.geojson     ← Données police (statiques)
```

---

## Prérequis

- **Python 3.9+**
- **PostgreSQL 13+** avec l'extension **PostGIS** installée
- Pip : `flask`, `flask-cors`, `pg8000`

### Installer les dépendances Python

```bash
pip install -r requirements.txt
```

---

## Étape 1 — Créer la base de données PostgreSQL

Ouvrez un terminal et connectez-vous à PostgreSQL :

```bash
psql -U postgres
```

Puis créez la base :

```sql
CREATE DATABASE sosdb;
\c sosdb
CREATE EXTENSION postgis;
\q
```

---

## Étape 2 — Initialiser les tables (optionnel)

Le script `init_db.sql` crée les tables et insère quelques données de test :

```bash
psql -U postgres -d sosdb -f init_db.sql
```

> **Note :** Les tables sont aussi créées automatiquement au démarrage de `api.py`.
> Cette étape est optionnelle, mais utile pour avoir des données de test.

---

## Étape 3 — Configurer les variables d'environnement

Créez un fichier `.env` (ou exportez les variables dans votre terminal) :

```bash
# Linux / macOS
export PGHOST=localhost
export PGPORT=5432
export PGDATABASE=sosdb
export PGUSER=postgres
export PGPASSWORD=votre_mot_de_passe

# Windows (PowerShell)
$env:PGHOST="localhost"
$env:PGPORT="5432"
$env:PGDATABASE="sosdb"
$env:PGUSER="postgres"
$env:PGPASSWORD="votre_mot_de_passe"
```

---

## Étape 4 — Démarrer l'API Flask

```bash
python api.py
```

Vous devriez voir :
```
=== SOS-CH API ===
  Base de données : sosdb sur localhost:5432
✓ Tables créées (ou déjà existantes) : fire_station, hospital, police
✓ Base de données prête
  Démarrage sur http://localhost:5000
```

---

## Étape 5 — Ouvrir le frontend

Ouvrez le dossier `frontend/` avec un serveur local.

**Option A — VS Code (recommandé) :**
Installez l'extension *Live Server*, clic droit sur `index.html` → *Open with Live Server*.

**Option B — Python :**
```bash
cd frontend
python -m http.server 8080
# → Ouvrez http://localhost:8080
```

**Option C — Node.js :**
```bash
cd frontend
npx serve .
```

> ⚠️ Il faut obligatoirement un serveur local (pas ouvrir `index.html` directement dans le navigateur),
> sinon les fichiers GeoJSON ne se chargent pas (restriction CORS des navigateurs).

---

## Endpoints de l'API

| Méthode  | URL                              | Description                     |
|----------|----------------------------------|---------------------------------|
| `GET`    | `/api/points/<table>`            | Lister les points ajoutés       |
| `POST`   | `/api/points/<table>`            | Ajouter un nouveau point        |
| `PUT`    | `/api/points/<table>/<id>`       | Modifier un point existant      |
| `DELETE` | `/api/points/<table>/<id>`       | Supprimer un point              |
| `GET`    | `/api/export/<table>`            | Exporter en GeoJSON             |

`<table>` doit être : `fire_station`, `hospital`, ou `police`

### Exemples avec curl

```bash
# Ajouter une caserne de pompiers
curl -X POST http://localhost:5000/api/points/fire_station \
  -H "Content-Type: application/json" \
  -d '{"name": "Caserne Nord", "x": 2537800, "y": 1180400}'

# Lister les hôpitaux ajoutés
curl http://localhost:5000/api/points/hospital

# Modifier le nom d'un point (id=1)
curl -X PUT http://localhost:5000/api/points/police/1 \
  -H "Content-Type: application/json" \
  -d '{"name": "Poste de police central"}'

# Supprimer un point (id=1)
curl -X DELETE http://localhost:5000/api/points/fire_station/1
```

---

## Utilisation de l'interface

### Voir les itinéraires
1. Cochez les services souhaités (Pompiers / Police / Hôpital) dans la toolbar
2. Cliquez n'importe où sur la carte
3. Les itinéraires routiers les plus rapides s'affichent avec le temps et la distance

### Ajouter un point
1. Cliquez sur **+ Ajouter** (bouton vert)
2. Choisissez le type de service
3. Donnez un nom (optionnel)
4. Cliquez sur la carte pour placer le point, ou saisissez les coordonnées LV95
5. Cliquez **Enregistrer** → le point est sauvegardé en base et apparaît sur la carte

### Gérer les points (modifier / supprimer)
1. Cliquez sur **⚙ Gérer** (bouton violet)
2. Sélectionnez le type de service dans le menu déroulant
3. Pour modifier : cliquez ✏️ sur un point, changez les valeurs, cliquez **Enregistrer**
4. Pour supprimer : cliquez 🗑️ et confirmez

---

## Système de coordonnées

Les données utilisent le système **LV95 (EPSG:2056)**, le système de coordonnées suisse :
- X (Est) : environ 2'480'000 à 2'830'000
- Y (Nord) : environ 1'070'000 à 1'300'000
- Centre de la Suisse : X ≈ 2'660'000, Y ≈ 1'190'000

---

## Technologies utilisées

| Technologie | Rôle |
|-------------|------|
| **Flask** (Python) | Serveur web et API REST |
| **PostgreSQL + PostGIS** | Base de données géospatiale |
| **pg8000** | Driver Python pur pour PostgreSQL (sans dépendances C) |
| **OpenLayers 10** | Bibliothèque cartographique |
| **Swisstopo WMS** | Fond de carte (carte nationale suisse) |
| **OSRM** | Calcul d'itinéraires routiers (service public) |
| **Bootstrap 5** | Mise en page et composants UI |
| **proj4js** | Conversion entre systèmes de coordonnées |
