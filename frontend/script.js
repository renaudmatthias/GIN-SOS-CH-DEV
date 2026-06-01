// ============================================================
//  SOS-CH — script.js
//  Carte interactive + gestion des services d'urgence
//
//  Ce fichier gère tout ce qui se passe dans le navigateur :
//    - Afficher la carte de la Suisse
//    - Afficher les points (pompiers, police, hôpitaux)
//    - Calculer les itinéraires routiers
//    - Ajouter / modifier / supprimer des points
//
//  Auteurs : Reto Lazzeri, Matthias Renaud & Florian Zaccomer
// ============================================================


// ════════════════════════════════════════════════════════════
//  1. CONFIGURATION GLOBALE
//     On définit ici les "constantes" : des valeurs qui ne
//     changent jamais pendant l'exécution du programme.
//     On les met en haut pour les retrouver facilement.
// ════════════════════════════════════════════════════════════

// Adresse de notre serveur Python (api.py doit tourner sur cet ordinateur)
// Toutes les requêtes vers la base de données passent par cette URL
const API_BASE = "http://localhost:5000/api";

// Adresse du service gratuit qui calcule les itinéraires routiers
// OSRM utilise les données OpenStreetMap pour calculer les routes
const OSRM_BASE = "https://router.project-osrm.org";

// Correspondance entre le nom de la table en base de données et la couleur sur la carte
// Exemple : TABLE_COULEUR["police"] retourne "blue"
const TABLE_COULEUR = {
  fire_station: "red",
  police:       "blue",
  hospital:     "green"
};


// ════════════════════════════════════════════════════════════
//  2. SYSTÈME DE COORDONNÉES SUISSE (LV95 / EPSG:2056)
//
//  En Suisse on n'utilise pas latitude/longitude (WGS84).
//  On utilise un système appelé LV95 où les coordonnées
//  ressemblent à : X ≈ 2'600'000 et Y ≈ 1'200'000.
//
//  On doit "expliquer" ce système à OpenLayers et proj4
//  pour que la carte s'affiche correctement.
// ════════════════════════════════════════════════════════════

// Les 4 coins de la Suisse en coordonnées LV95
// Format : [X_min, Y_min, X_max, Y_max]
const limitesSuisse = [2420000, 1030000, 2900000, 1360000];

// Définition mathématique de la projection LV95
// (formule standard, pas besoin de la comprendre en détail)
proj4.defs(
  "EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs"
);

// Dire à OpenLayers que proj4 connaît maintenant cette projection
ol.proj.proj4.register(proj4);

// Créer un objet "projection" qu'on va passer à la carte plus bas
const projectionLV95 = new ol.proj.Projection({
  code:   "EPSG:2056",
  extent: limitesSuisse
});


// ════════════════════════════════════════════════════════════
//  3. CRÉATION DE LA CARTE
//
//  On initialise la carte OpenLayers dans la balise HTML
//  qui a l'attribut id="map".
//  La carte est composée de couches (layers) empilées :
//    - En bas : le fond de carte (image de la Suisse)
//    - Au-dessus : les points (pompiers, police, hôpitaux)
//    - Encore au-dessus : les itinéraires et marqueurs
// ════════════════════════════════════════════════════════════

const carte = new ol.Map({

  // L'élément HTML dans lequel afficher la carte
  target: "map",

  // Liste des couches (on commence juste avec le fond de carte)
  // Les couches de points seront ajoutées juste après
  layers: [
    new ol.layer.Tile({
      source: new ol.source.TileWMS({
        url:        "https://wms.geo.admin.ch/",  // serveur de Swisstopo
        params: {
          LAYERS: "ch.swisstopo.pixelkarte-farbe", // couche = carte nationale suisse
          FORMAT: "image/png",
          VERSION: "1.3.0"
        },
        serverType: "mapserver",
        projection: projectionLV95
      })
    })
  ],

  // La vue : position de départ et niveaux de zoom autorisés
  view: new ol.View({
    projection: projectionLV95,
    center:     [2660000, 1190000], // centre géographique de la Suisse en LV95
    zoom:       2.5,
    minZoom:    2.5,                // on ne peut pas dézoomer plus que ça
    // Zone de navigation limitée à la Suisse (on ne peut pas aller en France, etc.)
    extent:              [2485000, 1075000, 2834000, 1296000],
    constrainOnlyCenter: true       // seul le centre est bloqué (pas les bords)
  })
});


// ════════════════════════════════════════════════════════════
//  4. STYLES VISUELS DES POINTS
//
//  Un "style" définit l'apparence d'un point sur la carte :
//  couleur, taille, contour, etc.
//  On crée deux tailles : normale et grande (quand sélectionné)
// ════════════════════════════════════════════════════════════

// Fonction qui crée un style "cercle coloré avec contour blanc"
// couleur = "red", "blue" ou "green"
// rayon   = taille en pixels (6 par défaut si on ne précise pas)
function creerStylePoint(couleur, rayon = 6) {
  return new ol.style.Style({
    image: new ol.style.Circle({
      radius: rayon,
      fill:   new ol.style.Fill({ color: couleur }),           // intérieur coloré
      stroke: new ol.style.Stroke({ color: "white", width: 2 }) // contour blanc pour la lisibilité
    })
  });
}

// Styles utilisés quand un point est au repos (taille normale)
const stylesNormaux = {
  red:   creerStylePoint("red"),
  blue:  creerStylePoint("blue"),
  green: creerStylePoint("green")
};

// Styles utilisés quand on clique sur un point (plus grand pour le mettre en évidence)
const stylesSelectionnes = {
  red:   creerStylePoint("red",   10),
  blue:  creerStylePoint("blue",  10),
  green: creerStylePoint("green", 10)
};


// ════════════════════════════════════════════════════════════
//  5. SOURCES ET COUCHES DE POINTS
//
//  Une "source" (ol.source.Vector) = un sac qui contient
//  des points géographiques (features).
//
//  Une "couche" (ol.layer.Vector) = ce qui affiche
//  visuellement les points du sac sur la carte.
//
//  On crée une paire source+couche pour chaque couleur.
// ════════════════════════════════════════════════════════════

// Les 3 sacs de points (un par type de service)
const sources = {
  red:   new ol.source.Vector(), // pompiers
  blue:  new ol.source.Vector(), // police
  green: new ol.source.Vector()  // hôpitaux
};

// Pour chaque couleur, créer la couche et l'ajouter à la carte
// zIndex: 300 = s'affiche au-dessus du fond de carte (zIndex 0)
for (const couleur of ["red", "blue", "green"]) {
  const couchePoints = new ol.layer.Vector({
    source: sources[couleur],
    style:  stylesNormaux[couleur],
    zIndex: 300
  });
  // On stocke la couleur dans la couche pour pouvoir la retrouver plus tard
  couchePoints.set("poiCouleur", couleur);
  carte.addLayer(couchePoints);
}


// ════════════════════════════════════════════════════════════
//  6. MARQUEUR VISEUR (croix orange)
//
//  Ce symbole apparaît à l'endroit où l'utilisateur a cliqué
//  pour lancer le calcul d'itinéraires.
//  C'est une image SVG (dessin vectoriel) encodée directement
//  dans le code pour ne pas avoir besoin d'un fichier image.
// ════════════════════════════════════════════════════════════

// Le dessin SVG de la croix (cercle + 4 branches + point central)
const svgCroix =
  '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">' +
    '<circle cx="16" cy="16" r="13" fill="none" stroke="white" stroke-width="3"/>' +
    '<circle cx="16" cy="16" r="13" fill="none" stroke="#ff6600" stroke-width="1.5"/>' +
    '<line x1="16" y1="2"  x2="16" y2="10" stroke="white"   stroke-width="3"   stroke-linecap="round"/>' +
    '<line x1="16" y1="2"  x2="16" y2="10" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="16" y1="22" x2="16" y2="30" stroke="white"   stroke-width="3"   stroke-linecap="round"/>' +
    '<line x1="16" y1="22" x2="16" y2="30" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="2"  y1="16" x2="10" y2="16" stroke="white"   stroke-width="3"   stroke-linecap="round"/>' +
    '<line x1="2"  y1="16" x2="10" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>' +
    '<line x1="22" y1="16" x2="30" y2="16" stroke="white"   stroke-width="3"   stroke-linecap="round"/>' +
    '<line x1="22" y1="16" x2="30" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>' +
    '<circle cx="16" cy="16" r="2.5" fill="#ff6600" stroke="white" stroke-width="1.5"/>' +
  '</svg>';

// La source qui contiendra le marqueur (un seul point à la fois)
const sourceMarqueur = new ol.source.Vector();

// Ajouter la couche du marqueur à la carte (zIndex 700 = au-dessus de tout)
carte.addLayer(new ol.layer.Vector({
  source: sourceMarqueur,
  zIndex:  700,
  style: new ol.style.Style({
    image: new ol.style.Icon({
      // encodeURIComponent convertit le SVG en URL valide
      src:    "data:image/svg+xml;utf8," + encodeURIComponent(svgCroix),
      anchor: [0.5, 0.5] // centrer l'image sur le point
    })
  })
}));


// ════════════════════════════════════════════════════════════
//  7. POINT ORANGE DE PRÉVISUALISATION
//
//  Quand l'utilisateur est en mode "ajout" et clique sur
//  la carte pour choisir une position, ce point orange
//  s'affiche temporairement pour montrer l'emplacement choisi.
//  Il disparaît quand on annule ou confirme l'ajout.
// ════════════════════════════════════════════════════════════

const sourcePreview = new ol.source.Vector();

carte.addLayer(new ol.layer.Vector({
  source: sourcePreview,
  zIndex: 900,                          // tout en haut (visible par-dessus tout)
  style:  creerStylePoint("#ff6600", 9) // orange, légèrement plus grand que les points normaux
}));


// ════════════════════════════════════════════════════════════
//  8. MÉMOIRE DES ITINÉRAIRES AFFICHÉS
//
//  On garde en mémoire :
//    - couchesItineraires : les couches OpenLayers affichées
//      sur la carte, pour pouvoir les supprimer plus tard
//    - derniersItineraires : les coordonnées des derniers
//      itinéraires calculés, pour pouvoir les ré-afficher
//      si l'utilisateur recoche une case de service
// ════════════════════════════════════════════════════════════

// null = pas d'itinéraire affiché pour cette couleur
const couchesItineraires = {
  red:   null,
  blue:  null,
  green: null
};

const derniersItineraires = {
  red:   null,
  blue:  null,
  green: null
};

// Supprime l'itinéraire d'une couleur donnée de la carte
function supprimerItineraire(couleur) {
  // On vérifie d'abord qu'il y a bien quelque chose à supprimer
  if (couchesItineraires[couleur] !== null) {
    carte.removeLayer(couchesItineraires[couleur]);
    couchesItineraires[couleur] = null; // remettre à null pour indiquer "vide"
  }
}

// Raccourci pour tout supprimer en même temps
function supprimerTousItineraires() {
  supprimerItineraire("red");
  supprimerItineraire("blue");
  supprimerItineraire("green");
}


// ════════════════════════════════════════════════════════════
//  9. PANNEAU D'INFO D'UN POINT
//
//  Quand l'utilisateur clique directement sur un point
//  existant (pompiers, police, hôpital), un panneau s'ouvre
//  pour afficher ses informations (nom, type, etc.)
// ════════════════════════════════════════════════════════════

const panneauInfo = document.getElementById("poi-panel");

// On garde en mémoire le point actuellement sélectionné
// pour pouvoir lui remettre son style normal quand on ferme le panneau
let featureSelectionnee   = null;
let couleurSelectionnee   = null;

// Ferme le panneau et remet le point à sa taille normale
function fermerPanneauInfo() {
  panneauInfo.style.display = "none";

  // Si un point était sélectionné, lui remettre son style normal
  if (featureSelectionnee !== null) {
    featureSelectionnee.setStyle(stylesNormaux[couleurSelectionnee]);
    featureSelectionnee = null;
    couleurSelectionnee = null;
  }
}

// Quand on clique sur le bouton × du panneau
document.getElementById("poi-close").addEventListener("click", fermerPanneauInfo);


// ════════════════════════════════════════════════════════════
//  10. CHARGEMENT DES POINTS SUR LA CARTE
//
//  Les points viennent de deux sources différentes :
//
//  SOURCE A — Fichiers GeoJSON (données statiques)
//    → Contiennent tous les services d'urgence de Suisse
//      issus d'OpenStreetMap
//    → Toujours disponibles (pas besoin de la base de données)
//    → Chargés en premier au démarrage
//
//  SOURCE B — Base de données PostgreSQL (points ajoutés)
//    → Points ajoutés manuellement via l'interface
//    → Nécessitent que api.py soit démarré
//    → Si l'API est éteinte, la carte fonctionne quand même
//      grâce aux GeoJSON
// ════════════════════════════════════════════════════════════

// Quel fichier GeoJSON correspond à quelle couleur ?
const fichiersGeoJSON = {
  red:   "fire_station.geojson",
  blue:  "police_v2.geojson",
  green: "hospital.geojson"
};

// Charge un fichier GeoJSON et ajoute ses points à la carte
function chargerFichierGeoJSON(couleur) {
  const nomFichier = fichiersGeoJSON[couleur];

  // fetch() envoie une requête HTTP pour récupérer le fichier
  // .then() = "quand la réponse arrive, faire ceci..."
  fetch(nomFichier)
    .then(function(reponse) {
      // Si le fichier n'existe pas ou est inaccessible, on lance une erreur
      if (!reponse.ok) {
        throw new Error("Impossible de charger " + nomFichier + " (erreur HTTP " + reponse.status + ")");
      }
      // Convertir la réponse en objet JavaScript (le GeoJSON est du JSON)
      return reponse.json();
    })
    .then(function(donneesGeoJSON) {
      // Convertir le GeoJSON en "features" OpenLayers
      // dataProjection    = système de coordonnées dans lequel sont écrites les données
      // featureProjection = système utilisé par notre carte
      const features = new ol.format.GeoJSON().readFeatures(donneesGeoJSON, {
        dataProjection:    "EPSG:2056",
        featureProjection: "EPSG:2056"
      });

      // Parcourir chaque point pour lui ajouter des infos utiles
      for (const f of features) {
        // Marquer ce point comme venant d'un GeoJSON (pas de la DB)
        // Utile pour distinguer les deux types dans le panneau "Gérer"
        f.set("sourceGeojson", true);

        // Normaliser le champ "name" : selon le fichier, il peut s'appeler
        // "name", "Name" ou "NAME" — on prend le premier qui existe
        const nom = f.get("name") || f.get("Name") || f.get("NAME") || "";
        f.set("name", nom);
      }

      // Ajouter tous les points dans le sac correspondant à la couleur
      sources[couleur].addFeatures(features);
      console.log("✓ GeoJSON chargé : " + nomFichier + " → " + features.length + " points");
    })
    .catch(function(erreur) {
      // En cas d'erreur, on affiche juste un message dans la console
      // sans bloquer le reste de l'application
      console.error("✗ Erreur GeoJSON " + nomFichier + " :", erreur);
    });
}

// Charge les points ajoutés par l'utilisateur depuis la base de données
function chargerPointsDepuisDB(nomTable, couleur) {
  // L'endpoint /export/<table> retourne un GeoJSON de tous les points de cette table
  fetch(API_BASE + "/export/" + nomTable)
    .then(function(reponse) {
      if (!reponse.ok) {
        throw new Error("Erreur HTTP " + reponse.status);
      }
      return reponse.json();
    })
    .then(function(donneesGeoJSON) {
      const features = new ol.format.GeoJSON().readFeatures(donneesGeoJSON, {
        dataProjection:    "EPSG:2056",
        featureProjection: "EPSG:2056"
      });

      for (const f of features) {
        const props = f.getProperties();
        // Stocker l'ID de la base de données sur le point
        // → indispensable pour pouvoir le modifier ou le supprimer plus tard
        f.set("apiId",    props.id);
        f.set("name",     props.name || "");
        // Marquer ce point comme venant de la base de données
        f.set("sourceDB", true);
      }

      sources[couleur].addFeatures(features);
      console.log("✓ DB chargée : " + nomTable + " → " + features.length + " points");
    })
    .catch(function(erreur) {
      // Si l'API n'est pas disponible, on affiche un simple avertissement
      // La carte continue de fonctionner avec les GeoJSON
      console.warn("⚠ API non disponible pour " + nomTable + " (api.py est-il démarré ?) :", erreur);
    });
}

// ── Lancement du chargement au démarrage ──────────────────────────────────
// On charge d'abord les GeoJSON (rapides, en local),
// puis les points de la DB en parallèle (peuvent prendre plus de temps)
chargerFichierGeoJSON("red");
chargerFichierGeoJSON("blue");
chargerFichierGeoJSON("green");

chargerPointsDepuisDB("fire_station", "red");
chargerPointsDepuisDB("police",       "blue");
chargerPointsDepuisDB("hospital",     "green");


// ════════════════════════════════════════════════════════════
//  11. CONVERSION ENTRE SYSTÈMES DE COORDONNÉES
//
//  Notre carte utilise LV95 (coordonnées suisses).
//  OSRM (calcul d'itinéraires) a besoin de WGS84 (lat/lon).
//  Ces deux fonctions font la conversion dans les deux sens.
// ════════════════════════════════════════════════════════════

// Convertit des coordonnées LV95 → WGS84 (longitude, latitude)
function lv95VersWgs84(coordonnees) {
  return ol.proj.transform(coordonnees, "EPSG:2056", "EPSG:4326");
}

// Convertit des coordonnées WGS84 → LV95
function wgs84VersLv95(coordonnees) {
  return ol.proj.transform(coordonnees, "EPSG:4326", "EPSG:2056");
}


// ════════════════════════════════════════════════════════════
//  12. CALCUL D'ITINÉRAIRES AVEC OSRM
//
//  OSRM est un moteur d'itinéraires open source gratuit.
//  On lui envoie deux points (départ + arrivée) en WGS84
//  et il répond avec la route la plus rapide en voiture.
//
//  Stratégie pour ne pas être trop lent :
//    1. Calculer la distance à vol d'oiseau vers tous les points
//    2. Garder seulement les 20 plus proches (candidats)
//    3. Demander un vrai itinéraire OSRM pour chacun
//    4. Garder celui qui prend le moins de temps
// ════════════════════════════════════════════════════════════

// Nombre maximum de points candidats à tester avec OSRM
const NB_CANDIDATS = 20;

// Retourne les N points d'une couleur les plus proches du point cliqué
// Le calcul de distance utilise le théorème de Pythagore (distance à vol d'oiseau)
function getPointsLesPlusProches(coordCliquee, couleur, nombreMax = NB_CANDIDATS) {
  const tousLesPoints = sources[couleur].getFeatures();

  // Pour chaque point, calculer sa distance au point cliqué
  const pointsAvecDistance = [];

  for (const feature of tousLesPoints) {
    // Ignorer les points sans géométrie (ne devrait pas arriver, mais par sécurité)
    if (!feature.getGeometry()) continue;

    const coordPoint = feature.getGeometry().getCoordinates();

    // Distance à vol d'oiseau avec Pythagore : √((x2-x1)² + (y2-y1)²)
    const dx = coordPoint[0] - coordCliquee[0];
    const dy = coordPoint[1] - coordCliquee[1];
    const distance = Math.sqrt(dx * dx + dy * dy);

    pointsAvecDistance.push({ feature, distance });
  }

  // Trier du plus proche au plus loin
  pointsAvecDistance.sort(function(a, b) {
    return a.distance - b.distance;
  });

  // Retourner seulement les N premiers (les plus proches)
  return pointsAvecDistance
    .slice(0, nombreMax)
    .map(function(item) { return item.feature; });
}

// Appelle l'API OSRM pour calculer un itinéraire entre deux points
// depart  et arrivee sont en WGS84 : [longitude, latitude]
// Retourne une promesse avec { time, distance, coords }
function demanderItineraireOSRM(depart, arrivee) {
  // Construction de l'URL de la requête OSRM
  // Format : /route/v1/driving/lon1,lat1;lon2,lat2
  const url =
    OSRM_BASE + "/route/v1/driving/" +
    depart[0]  + "," + depart[1]  + ";" +
    arrivee[0] + "," + arrivee[1] +
    "?overview=full&geometries=geojson";
    // overview=full  → on veut la géométrie complète de la route (pas juste le début et la fin)
    // geometries=geojson → format de réponse pour les coordonnées

  return fetch(url)
    .then(function(reponse) {
      if (!reponse.ok) {
        throw new Error("OSRM a répondu avec une erreur : " + reponse.status);
      }
      return reponse.json();
    })
    .then(function(data) {
      // Vérifier que OSRM a bien trouvé un itinéraire
      if (data.code !== "Ok" || !data.routes || data.routes.length === 0) {
        throw new Error("OSRM n'a pas trouvé d'itinéraire");
      }

      const route = data.routes[0]; // prendre le meilleur itinéraire proposé

      return {
        time:     route.duration,           // durée en secondes
        distance: route.distance / 1000,    // distance convertie de mètres en km
        coords:   route.geometry.coordinates // tableau de [lon, lat] pour tracer la ligne
      };
    });
}

// Trouve le point le plus rapide à atteindre parmi les candidats
// Lance tous les appels OSRM en même temps (en parallèle) pour aller plus vite
function trouverPointLePlusRapide(coordCliquee, couleur) {
  const candidats = getPointsLesPlusProches(coordCliquee, couleur);

  // Si aucun point n'existe pour ce service, on abandonne
  if (candidats.length === 0) {
    return Promise.resolve(null);
  }

  // Convertir le point de départ en WGS84 pour OSRM
  const departWgs84 = lv95VersWgs84(coordCliquee);

  // Créer une promesse de calcul d'itinéraire pour chaque candidat
  const promessesItineraires = candidats.map(function(feature) {
    const coordPoint   = feature.getGeometry().getCoordinates();
    const arriveeWgs84 = lv95VersWgs84(coordPoint);

    return demanderItineraireOSRM(departWgs84, arriveeWgs84)
      .then(function(route) {
        // Succès : retourner le point avec son itinéraire et sa durée
        return { feature, route, time: route.time };
      })
      .catch(function() {
        // Échec : retourner Infinity pour que ce candidat soit toujours perdant
        return { feature, route: null, time: Infinity };
      });
  });

  // Promise.all attend que TOUTES les promesses soient terminées
  // puis on compare les durées pour trouver la plus courte
  return Promise.all(promessesItineraires).then(function(resultats) {
    let meilleur = resultats[0];
    for (let i = 1; i < resultats.length; i++) {
      if (resultats[i].time < meilleur.time) {
        meilleur = resultats[i];
      }
    }
    return meilleur;
  });
}

// Trace l'itinéraire sur la carte sous forme de ligne colorée pointillée
function afficherItineraireSurCarte(coordsWgs84, couleur) {
  // D'abord supprimer l'ancien itinéraire de cette couleur s'il existe
  supprimerItineraire(couleur);

  // Couleurs des lignes sur la carte (plus foncées que les points pour contraster)
  const couleursLignes = { blue: "#1a56db", green: "#057a55", red: "#e02424" };

  // Convertir les coordonnées WGS84 → LV95 pour correspondre à la projection de la carte
  const coordsLv95 = coordsWgs84.map(function(point) {
    return wgs84VersLv95([point[0], point[1]]);
  });

  // Créer une "feature" géographique de type ligne
  const featureLigne = new ol.Feature({
    geometry: new ol.geom.LineString(coordsLv95)
  });

  // Style à deux couches pour un effet lisible sur n'importe quel fond :
  //   Couche 1 (en dessous) : halo blanc épais
  //   Couche 2 (au-dessus) : ligne colorée pointillée fine
  featureLigne.setStyle([
    new ol.style.Style({
      stroke: new ol.style.Stroke({ color: "white", width: 7 })
    }),
    new ol.style.Style({
      stroke: new ol.style.Stroke({
        color:    couleursLignes[couleur],
        width:    4,
        lineDash: [12, 6] // [longueur du tiret, longueur de l'espace]
      })
    })
  ]);

  // Créer la couche contenant cette ligne et l'ajouter à la carte
  couchesItineraires[couleur] = new ol.layer.Vector({
    source: new ol.source.Vector({ features: [featureLigne] }),
    zIndex: 500 // entre les points (300) et les marqueurs (700)
  });
  carte.addLayer(couchesItineraires[couleur]);
}


// ════════════════════════════════════════════════════════════
//  13. MESSAGES TEMPORAIRES (TOASTS)
//
//  Un "toast" est un petit message qui apparaît brièvement
//  en bas de l'écran pour informer l'utilisateur d'une action.
//  Exemple : "Point ajouté ✓" ou "Erreur : API inaccessible"
//  Il disparaît automatiquement après quelques secondes.
// ════════════════════════════════════════════════════════════

// Timer pour savoir quand cacher le toast (null = pas de timer actif)
let timerToast = null;

// Affiche un message temporaire en bas de l'écran
// message = le texte à afficher
// type    = "info" (bleu), "success" (vert) ou "error" (rouge)
function afficherToast(message, type = "info") {
  const toast = document.getElementById("routing-toast");

  // Si un toast est déjà visible, annuler son timer pour le remplacer
  if (timerToast !== null) {
    clearTimeout(timerToast);
  }

  // Afficher le nouveau toast
  toast.textContent = message;
  toast.className   = "toast-" + type; // ex: "toast-success" → couleur verte en CSS

  // Programmer la disparition automatique après 3.2 secondes
  timerToast = setTimeout(function() {
    toast.className = "toast-hidden"; // la classe CSS "toast-hidden" cache le toast
  }, 3200);
}


// ════════════════════════════════════════════════════════════
//  14. CALCUL DES ITINÉRAIRES POUR LES 3 SERVICES
//
//  Quand l'utilisateur clique sur la carte (hors mode ajout),
//  on calcule en parallèle l'itinéraire le plus rapide
//  vers chaque type de service coché dans la toolbar.
//
//  Le panneau de résultats affiche :
//    - La durée en minutes
//    - La distance en km
//    - Le nom du lieu le plus proche
// ════════════════════════════════════════════════════════════

// Retourne la liste des couleurs dont la case est cochée
function getServicesCoches() {
  const cases    = document.querySelectorAll(".svc-check:checked");
  const couleurs = [];
  for (const caseACocher of cases) {
    couleurs.push(caseACocher.dataset.color);
  }
  return couleurs;
}

// Lance le calcul des itinéraires depuis le point cliqué
function calculerTousLesItineraires(coordCliquee) {
  const servicesActifs = getServicesCoches();

  // Si aucune case n'est cochée, on ne peut rien calculer
  if (servicesActifs.length === 0) {
    afficherToast("Cochez au moins un service", "error");
    return;
  }

  // Placer la croix orange à l'endroit cliqué
  sourceMarqueur.clear();
  sourceMarqueur.addFeature(new ol.Feature({
    geometry: new ol.geom.Point(coordCliquee)
  }));

  const panneau = document.getElementById("multi-route-panel");

  // Préparer le panneau de résultats :
  //   - Services cochés   → afficher "Calcul..." en attente
  //   - Services non cochés → cacher leur ligne
  for (const c of ["red", "blue", "green"]) {
    supprimerItineraire(c);           // supprimer l'ancien itinéraire sur la carte
    derniersItineraires[c] = null;    // oublier le dernier itinéraire calculé

    const lignePanneau = document.getElementById("mrp-row-"    + c);
    const cellResultat = document.getElementById("mrp-result-" + c);

    if (servicesActifs.includes(c)) {
      // Ce service est coché : montrer la ligne avec un message d'attente
      lignePanneau.style.display = "flex";
      lignePanneau.style.opacity = "1";
      cellResultat.innerHTML     = '<span class="mrp-loading">Calcul...</span>';
    } else {
      // Ce service n'est pas coché : cacher sa ligne dans le panneau
      lignePanneau.style.display = "none";
    }
  }

  panneau.style.display = "block"; // afficher le panneau de résultats

  // Compteur pour savoir quand tous les calculs sont terminés
  let nbCalculsTermines = 0;

  // Lancer le calcul pour chaque service coché (tous en même temps = en parallèle)
  for (const couleur of servicesActifs) {

    trouverPointLePlusRapide(coordCliquee, couleur)
      .then(function(meilleur) {
        const cellResultat = document.getElementById("mrp-result-" + couleur);

        // Cas où aucun itinéraire n'a été trouvé
        if (!meilleur || !meilleur.route) {
          cellResultat.innerHTML = '<span class="mrp-error">Aucun itinéraire</span>';
          return;
        }

        // Sauvegarder l'itinéraire pour pouvoir le ré-afficher si on recoche la case
        derniersItineraires[couleur] = meilleur.route;

        // Tracer l'itinéraire sur la carte
        const caseService = document.querySelector('.svc-check[data-color="' + couleur + '"]');
        if (caseService && caseService.checked) {
          afficherItineraireSurCarte(meilleur.route.coords, couleur);
        }

        // Formater les résultats à afficher dans le panneau
        const minutes = Math.round(meilleur.route.time / 60); // secondes → minutes
        const km      = meilleur.route.distance.toFixed(1);   // 1 décimale
        const props   = meilleur.feature.getProperties();
        // Le nom peut être stocké dans différents champs selon la source des données
        const nomLieu = props.name || props.Name || props.NAME || props.nom || "Sans nom";

        // Afficher le résultat dans la cellule correspondante
        cellResultat.innerHTML =
          '<div class="mrp-time">' +
            '<strong>' + minutes + ' min</strong>' +
            '<span class="mrp-km"> · ' + km + ' km</span>' +
          '</div>' +
          '<div class="mrp-name">' + nomLieu + '</div>';
      })
      .catch(function() {
        // En cas d'erreur inattendue, afficher un message d'erreur
        document.getElementById("mrp-result-" + couleur).innerHTML =
          '<span class="mrp-error">Erreur</span>';
      })
      .then(function() {
        // Ce bloc s'exécute TOUJOURS (succès ou erreur), comme un "finally"
        nbCalculsTermines++;
        // Quand tous les services ont terminé leur calcul, afficher un toast
        if (nbCalculsTermines === servicesActifs.length) {
          afficherToast("Itinéraires calculés", "success");
        }
      });
  }
}


// ════════════════════════════════════════════════════════════
//  15. GESTION DU CLIC SUR LA CARTE
//
//  Le comportement au clic dépend du mode actif :
//
//  Mode normal (modeAjoutActif = false) :
//    → Calculer les itinéraires depuis le point cliqué
//
//  Mode ajout (modeAjoutActif = true) :
//    → Enregistrer les coordonnées pour le nouveau point
//    → Afficher un point orange de prévisualisation
// ════════════════════════════════════════════════════════════

// Variable qui indique si on est en mode "ajout de point"
// Déclarée ici avec let car elle est modifiée dans plusieurs fonctions plus bas
let modeAjoutActif    = false;
let coordsNouveauPoint = null; // coordonnées LV95 du point placé sur la carte

// Écouter les clics sur la carte
carte.on("singleclick", function(evenement) {

  if (modeAjoutActif) {
    // ── Mode ajout : enregistrer la position cliquée ──────────────
    const x = evenement.coordinate[0]; // coordonnée X en LV95
    const y = evenement.coordinate[1]; // coordonnée Y en LV95
    coordsNouveauPoint = [x, y];

    // Afficher le point orange de prévisualisation à cet endroit
    sourcePreview.clear();
    sourcePreview.addFeature(new ol.Feature({
      geometry: new ol.geom.Point([x, y])
    }));

    // Mettre à jour le texte dans la fenêtre d'ajout
    // toLocaleString("fr-CH") formate les nombres avec des apostrophes (2'537'800)
    document.getElementById("apm-click-icon").textContent = "📍";
    document.getElementById("apm-click-text").textContent =
      "Point placé — X: " + Math.round(x).toLocaleString("fr-CH") +
      ", Y: " + Math.round(y).toLocaleString("fr-CH");
    document.getElementById("apm-click-zone").classList.add("apm-click-zone--ok");

    // Vérifier si on peut maintenant activer le bouton "Enregistrer"
    verifierSiPretAEnregistrer();

    // Important : on sort de la fonction pour ne PAS calculer d'itinéraire
    return;
  }

  // ── Mode normal : calculer les itinéraires ──────────────────────
  calculerTousLesItineraires(evenement.coordinate);
});

// Changer le curseur en croix dès que la carte a fini de se charger
carte.once("rendercomplete", function() {
  carte.getTargetElement().style.cursor = "crosshair";
});


// ════════════════════════════════════════════════════════════
//  16. CASES À COCHER DES SERVICES (toolbar)
//
//  Quand l'utilisateur coche ou décoche un service :
//    - Coché   → ré-afficher son itinéraire sur la carte
//    - Décoché → retirer son itinéraire de la carte
//              → griser sa ligne dans le panneau de résultats
// ════════════════════════════════════════════════════════════

// Ajouter un écouteur sur chaque case à cocher
const toutesLesCases = document.querySelectorAll(".svc-check");
for (const caseACocher of toutesLesCases) {
  caseACocher.addEventListener("change", function() {
    const couleur      = this.dataset.color; // "red", "blue" ou "green"
    const lignePanneau = document.getElementById("mrp-row-" + couleur);

    if (this.checked) {
      // Case cochée → restaurer l'opacité normale et ré-afficher l'itinéraire
      if (lignePanneau) lignePanneau.style.opacity = "1";
      // Ré-afficher le dernier itinéraire calculé pour ce service (s'il existe)
      if (derniersItineraires[couleur] !== null) {
        afficherItineraireSurCarte(derniersItineraires[couleur].coords, couleur);
      }
    } else {
      // Case décochée → griser la ligne et supprimer l'itinéraire de la carte
      if (lignePanneau) lignePanneau.style.opacity = "0.35";
      supprimerItineraire(couleur);
    }
  });
}

// Bouton "Effacer" : tout remettre à zéro
document.getElementById("btn-clear-all").addEventListener("click", function() {
  supprimerTousItineraires();                                          // enlever les lignes
  sourceMarqueur.clear();                                             // enlever la croix
  document.getElementById("multi-route-panel").style.display = "none"; // cacher le panneau
  fermerPanneauInfo();
});

// Bouton × du panneau d'itinéraires : fermer et effacer
document.getElementById("mrp-close").addEventListener("click", function() {
  document.getElementById("multi-route-panel").style.display = "none";
  supprimerTousItineraires();
  sourceMarqueur.clear();
});


// ════════════════════════════════════════════════════════════
//  17. FENÊTRE D'AJOUT D'UN NOUVEAU POINT
//
//  Processus complet pour ajouter un point :
//    Étape 1 → Cliquer sur le bouton "+ Ajouter"
//    Étape 2 → Choisir le type (pompiers / police / hôpital)
//    Étape 3 → Taper un nom (optionnel)
//    Étape 4 → Cliquer sur la carte pour choisir la position
//    Étape 5 → Cliquer "Enregistrer"
//              → Requête POST envoyée à api.py
//              → Le point apparaît immédiatement sur la carte
// ════════════════════════════════════════════════════════════

const fenetreAjout = document.getElementById("add-point-overlay");

// Variables qui mémorisent les choix en cours dans la fenêtre d'ajout
let typeChoisi = null; // "fire_station", "police" ou "hospital"

// Ouvrir la fenêtre d'ajout et activer le mode "placement de point"
document.getElementById("btn-add-point").addEventListener("click", function() {
  fenetreAjout.classList.add("apm-visible"); // CSS affiche la fenêtre
  reinitialiserFenetreAjout();               // vider les champs
  modeAjoutActif = true;                     // activer le mode ajout
  carte.getTargetElement().style.cursor = "crosshair";
});

// Ferme la fenêtre et annule tout
function fermerFenetreAjout() {
  fenetreAjout.classList.remove("apm-visible"); // CSS cache la fenêtre
  typeChoisi         = null;
  coordsNouveauPoint = null;
  modeAjoutActif     = false;
  sourcePreview.clear();                         // supprimer le point orange
  carte.getTargetElement().style.cursor = "crosshair";
}
document.getElementById("apm-close").addEventListener("click",  fermerModal);
document.getElementById("apm-cancel").addEventListener("click", fermerModal);

function reinitialiserModal() {
  document.querySelectorAll(".apm-type-btn").forEach(b => {
    b.classList.remove("btn-primary", "text-white");
    b.classList.add("btn-outline-secondary");
  });
  document.getElementById("apm-name").value = "";
  typeEnAttente   = null;
  coordsEnAttente = null;
  document.getElementById("apm-submit").disabled = true;
  document.getElementById("apm-status").textContent = "";
  document.getElementById("apm-click-icon").textContent = "🖱️";
  document.getElementById("apm-click-text").textContent = "Cliquez n'importe où sur la carte pour placer le point";
  document.getElementById("apm-click-zone").classList.remove("apm-click-zone--ok");
}

document.querySelectorAll(".apm-type-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".apm-type-btn").forEach(b => {
      b.classList.remove("btn-primary", "text-white");
      b.classList.add("btn-outline-secondary");
    });
    btn.classList.remove("btn-outline-secondary");
    btn.classList.add("btn-primary", "text-white");
    typeEnAttente = btn.dataset.type;
    verifierPretModal();
  });
}

// Active le bouton "Enregistrer" seulement si :
//   - Un type de service a été choisi
//   - ET une position a été cliquée sur la carte
function verifierSiPretAEnregistrer() {
  const pret = (typeChoisi !== null) && (coordsNouveauPoint !== null);
  document.getElementById("apm-submit").disabled = !pret;
}

// Envoi du nouveau point à l'API Flask (bouton "Enregistrer")
document.getElementById("apm-submit").addEventListener("click", function() {
  const nom = document.getElementById("apm-name").value.trim(); // trim = supprimer espaces début/fin
  const x   = coordsNouveauPoint[0];
  const y   = coordsNouveauPoint[1];

  // Désactiver le bouton pour éviter un double-clic
  document.getElementById("apm-submit").disabled   = true;
  document.getElementById("apm-status").innerHTML  = '<span class="apm-saving">Enregistrement...</span>';

  // Envoyer une requête HTTP POST à notre API Flask
  // JSON.stringify convertit l'objet JavaScript en texte JSON pour l'envoi
  fetch(API_BASE + "/points/" + typeChoisi, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name: nom, x: x, y: y })
  })
  .then(function(reponse) {
    // Lire la réponse JSON et vérifier si la requête a réussi
    return reponse.json().then(function(data) {
      if (!reponse.ok) {
        throw new Error(data.erreur || "Erreur HTTP " + reponse.status);
      }
      return data;
    });
  })
  .then(function(data) {
    // Succès ! Afficher une confirmation avec l'ID attribué par la DB
    document.getElementById("apm-status").innerHTML =
      '<span class="apm-success">Ajouté (id ' + data.id + ')</span>';
    afficherToast("Point ajouté", "success");

    // Ajouter immédiatement le point sur la carte sans recharger toute la couche
    const couleur      = TABLE_COULEUR[typeChoisi];
    const nouveauPoint = new ol.Feature({
      geometry: new ol.geom.Point([x, y])
    });
    nouveauPoint.set("name",     nom);
    nouveauPoint.set("apiId",    data.id); // stocker l'ID pour pouvoir modifier/supprimer
    nouveauPoint.set("sourceDB", true);
    sources[couleur].addFeature(nouveauPoint);

    // Attendre 1.2 secondes puis fermer la fenêtre
    // (pour laisser le temps à l'utilisateur de lire la confirmation)
    setTimeout(fermerFenetreAjout, 1200);
  })
  .catch(function(erreur) {
    // En cas d'erreur, afficher le message et réactiver le bouton pour réessayer
    document.getElementById("apm-status").innerHTML =
      '<span class="apm-error-msg">Erreur : ' + erreur.message + '</span>';
    document.getElementById("apm-submit").disabled = false;
  });
});


// ════════════════════════════════════════════════════════════
//  18. PANNEAU DE GESTION (modifier / supprimer)
//
//  Ce panneau liste UNIQUEMENT les points ajoutés via
//  l'interface (stockés en base de données).
//  Les points des fichiers GeoJSON n'apparaissent pas ici
//  car ils ne peuvent pas être modifiés ni supprimés.
//
//  Pour chaque point on peut :
//    ✏️ Modifier le nom et/ou les coordonnées → requête PUT
//    🗑️ Supprimer le point               → requête DELETE
// ════════════════════════════════════════════════════════════

const panneauAdmin = document.getElementById("admin-panel");

// ID du point actuellement en cours d'édition (null = aucun)
let idPointEnEdition = null;

// Ouvrir ou fermer le panneau au clic sur "⚙ Gérer"
document.getElementById("btn-admin-panel").addEventListener("click", function() {
  if (panneauAdmin.style.display === "none") {
    panneauAdmin.style.display = "block";
    chargerListePoints(); // charger les données depuis l'API à l'ouverture
  } else {
    panneauAdmin.style.display = "none";
  }
});

// Bouton × pour fermer le panneau
document.getElementById("adm-close").addEventListener("click", function() {
  panneauAdmin.style.display = "none";
});

// Recharger la liste quand on change de type dans le menu déroulant
document.getElementById("adm-filter-table").addEventListener("change", chargerListePoints);

// Bouton "↺ Actualiser" pour recharger manuellement
document.getElementById("adm-refresh").addEventListener("click", chargerListePoints);

// Charge et affiche les points de la table sélectionnée depuis l'API
function chargerListePoints() {
  const table = document.getElementById("adm-filter-table").value;
  const tbody = document.getElementById("adm-tbody");
  tbody.innerHTML=`<tr><td colspan="5" class="adm-loading">Chargement…</td></tr>`;
  fermerEdition();
  try {
    const res  = await fetch(`${API_BASE}/points/${table}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.erreur||`HTTP ${res.status}`);
    if (data.points.length===0) {
      tbody.innerHTML=`<tr><td colspan="5" class="adm-loading">Aucun point ajouté en base de données.<br><small style="opacity:.6">Les points des fichiers GeoJSON ne s'affichent pas ici.</small></td></tr>`; return;
    }
    tbody.innerHTML = data.points.map(p=>`
      <tr data-id="${p.id}">
        <td class="adm-cell-id">${p.id}</td>
        <td>${p.name||"—"}</td>
        <td>${Math.round(p.x)}</td>
        <td>${Math.round(p.y)}</td>
        <td class="adm-cell-actions">
          <button class="btn btn-outline-primary btn-sm me-1" onclick="ouvrirEdition(${p.id},'${escapeHtml(p.name||'')}',${p.x},${p.y})">✏️</button>
          <button class="btn btn-outline-danger btn-sm" onclick="supprimerPointAdmin(${p.id})">🗑️</button>
        </td>
      </tr>`).join("");
  } catch(err) {
    tbody.innerHTML=`<tr><td colspan="5" class="adm-error">API inaccessible — vérifiez que api.py tourne sur localhost:5000</td></tr>`;
  }
}
function ouvrirEdition(id,nom,x,y) {
  idEnEdition=id;
  document.getElementById("adm-edit-id").textContent=`#${id}`;
  document.getElementById("adm-edit-name").value=nom;
  document.getElementById("adm-edit-x").value=Math.round(x);
  document.getElementById("adm-edit-y").value=Math.round(y);
  document.getElementById("adm-edit-status").textContent="";
  document.getElementById("adm-edit-zone").style.display="block";
  document.querySelectorAll("#adm-tbody tr").forEach(tr=>tr.classList.remove("selected"));
  const lr=document.querySelector(`#adm-tbody tr[data-id="${id}"]`);
  if (lr) lr.classList.add("selected");
}
function fermerEdition() {
  idEnEdition=null;
  document.getElementById("adm-edit-zone").style.display="none";
  document.getElementById("adm-edit-status").textContent="";
  document.querySelectorAll("#adm-tbody tr").forEach(tr=>tr.classList.remove("selected"));
}
document.getElementById("adm-edit-cancel").addEventListener("click", fermerEdition);
document.getElementById("adm-edit-save").addEventListener("click", async () => {
  const table=document.getElementById("adm-filter-table").value;
  const nom=document.getElementById("adm-edit-name").value.trim();
  const x=parseFloat(document.getElementById("adm-edit-x").value);
  const y=parseFloat(document.getElementById("adm-edit-y").value);
  document.getElementById("adm-edit-status").innerHTML=`<span class="apm-saving">Enregistrement…</span>`;
  try {
    const res=await fetch(`${API_BASE}/points/${table}/${idEnEdition}`,{
      method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:nom,x,y})});
    const data=await res.json();
    if (!res.ok) throw new Error(data.erreur||`HTTP ${res.status}`);
    afficherToast("Point modifie","success");
    fermerEdition(); chargerTableAdmin();
  } catch(err) {
    document.getElementById("adm-edit-status").innerHTML=`<span class="apm-error-msg">Erreur : ${err.message}</span>`;
  }
});
async function supprimerPointAdmin(id) {
  if (!confirm(`Supprimer le point #${id} ?`)) return;
  const table=document.getElementById("adm-filter-table").value;
  try {
    const res=await fetch(`${API_BASE}/points/${table}/${id}`,{method:"DELETE"});
    const data=await res.json();
    if (!res.ok) throw new Error(data.erreur||`HTTP ${res.status}`);
    afficherToast(`Point #${id} supprime`,"success");
    const couleur=TABLE_COULEUR[table];
    const f=sources[couleur].getFeatures().find(f=>f.get("apiId")===id);
    if (f) sources[couleur].removeFeature(f);
    chargerTableAdmin();
  } catch(err) { afficherToast(`Erreur : ${err.message}`,"error"); }
}
window.ouvrirEdition=ouvrirEdition;
window.supprimerPointAdmin=supprimerPointAdmin;

  // Afficher "Chargement..." pendant qu'on attend la réponse
  tbody.innerHTML = '<tr><td colspan="5" class="adm-loading">Chargement...</td></tr>';
  fermerFormulaireEdition(); // fermer un éventuel formulaire d'édition ouvert

  fetch(API_BASE + "/points/" + table)
    .then(function(reponse) {
      return reponse.json().then(function(data) {
        if (!reponse.ok) {
          throw new Error(data.erreur || "Erreur HTTP " + reponse.status);
        }
        return data;
      });
    })
    .then(function(data) {
      // Cas où la table est vide
      if (data.points.length === 0) {
        tbody.innerHTML =
          '<tr><td colspan="5" class="adm-loading">' +
            'Aucun point ajouté en base de données.<br>' +
            '<small style="opacity:.6">Les points des fichiers GeoJSON ne s\'affichent pas ici.</small>' +
          '</td></tr>';
        return;
      }

      // Construire le HTML du tableau ligne par ligne
      let lignesHTML = "";
      for (const point of data.points) {
        lignesHTML +=
          '<tr data-id="' + point.id + '">' +
            '<td class="adm-cell-id">' + point.id + '</td>' +
            '<td>' + (point.name || "—") + '</td>' +
            '<td>' + Math.round(point.x) + '</td>' +
            '<td>' + Math.round(point.y) + '</td>' +
            '<td class="adm-cell-actions">' +
              // Les onclick appellent des fonctions globales définies plus bas
              '<button class="btn btn-outline-primary btn-sm me-1" onclick="ouvrirEdition(' + point.id + ',\'' + escapeHtml(point.name || "") + '\',' + point.x + ',' + point.y + ')">✏️</button>' +
              '<button class="btn btn-outline-danger btn-sm" onclick="supprimerPointAdmin(' + point.id + ')">🗑️</button>' +
            '</td>' +
          '</tr>';
      }
      tbody.innerHTML = lignesHTML;
    })
    .catch(function() {
      // L'API est inaccessible (api.py non démarré)
      tbody.innerHTML =
        '<tr><td colspan="5" class="adm-error">' +
          'API inaccessible — vérifiez que api.py tourne sur localhost:5000' +
        '</td></tr>';
    });
}

// Ouvre le formulaire d'édition inline pour un point donné
// Pré-remplit les champs avec les valeurs actuelles
function ouvrirEdition(id, nom, x, y) {
  idPointEnEdition = id; // mémoriser l'ID du point en cours d'édition

  // Remplir les champs du formulaire
  document.getElementById("adm-edit-id").textContent     = "#" + id;
  document.getElementById("adm-edit-name").value         = nom;
  document.getElementById("adm-edit-x").value            = Math.round(x);
  document.getElementById("adm-edit-y").value            = Math.round(y);
  document.getElementById("adm-edit-status").textContent = "";

  // Afficher le formulaire d'édition
  document.getElementById("adm-edit-zone").style.display = "block";

  // Mettre en évidence la ligne correspondante dans le tableau
  for (const ligne of document.querySelectorAll("#adm-tbody tr")) {
    ligne.classList.remove("table-active");
  }
  const ligneSelectionnee = document.querySelector('#adm-tbody tr[data-id="' + id + '"]');
  if (ligneSelectionnee) {
    ligneSelectionnee.classList.add("table-active");
  }
}

// Ferme le formulaire d'édition et remet le tableau à la normale
function fermerFormulaireEdition() {
  idPointEnEdition = null;
  document.getElementById("adm-edit-zone").style.display   = "none";
  document.getElementById("adm-edit-status").textContent   = "";
  for (const ligne of document.querySelectorAll("#adm-tbody tr")) {
    ligne.classList.remove("table-active");
  }
}

// Bouton "Annuler" dans le formulaire d'édition
document.getElementById("adm-edit-cancel").addEventListener("click", fermerFormulaireEdition);

// Bouton "Enregistrer" dans le formulaire d'édition → requête PUT vers l'API
document.getElementById("adm-edit-save").addEventListener("click", function() {
  const table = document.getElementById("adm-filter-table").value;
  const nom   = document.getElementById("adm-edit-name").value.trim();
  const x     = parseFloat(document.getElementById("adm-edit-x").value);
  const y     = parseFloat(document.getElementById("adm-edit-y").value);

  document.getElementById("adm-edit-status").innerHTML =
    '<span class="apm-saving">Enregistrement...</span>';

  // Requête PUT = modification d'une ressource existante
  fetch(API_BASE + "/points/" + table + "/" + idPointEnEdition, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ name: nom, x: x, y: y })
  })
  .then(function(reponse) {
    return reponse.json().then(function(data) {
      if (!reponse.ok) throw new Error(data.erreur || "Erreur HTTP " + reponse.status);
      return data;
    });
  })
  .then(function() {
    afficherToast("Point modifié", "success");
    fermerFormulaireEdition();
    chargerListePoints(); // recharger le tableau pour voir les nouvelles valeurs
  })
  .catch(function(erreur) {
    document.getElementById("adm-edit-status").innerHTML =
      '<span class="apm-error-msg">Erreur : ' + erreur.message + '</span>';
  });
});

// Supprime un point de la base de données après confirmation de l'utilisateur
function supprimerPointAdmin(id) {
  // confirm() affiche une boîte de dialogue et retourne true si l'utilisateur clique "OK"
  if (!confirm("Supprimer le point #" + id + " ?")) {
    return; // l'utilisateur a cliqué "Annuler" → on ne fait rien
  }

  const table = document.getElementById("adm-filter-table").value;

  // Requête DELETE = suppression d'une ressource
  fetch(API_BASE + "/points/" + table + "/" + id, { method: "DELETE" })
    .then(function(reponse) {
      return reponse.json().then(function(data) {
        if (!reponse.ok) throw new Error(data.erreur || "Erreur HTTP " + reponse.status);
        return data;
      });
    })
    .then(function() {
      afficherToast("Point #" + id + " supprimé", "success");

      // Supprimer aussi le point de la carte (pas seulement de la DB)
      const couleur       = TABLE_COULEUR[table];
      const tousLesPoints = sources[couleur].getFeatures();
      for (const point of tousLesPoints) {
        // On trouve le bon point grâce à l'apiId qu'on avait stocké lors du chargement
        if (point.get("apiId") === id) {
          sources[couleur].removeFeature(point);
          break; // on a trouvé le point, inutile de continuer la boucle
        }
      }

      chargerListePoints(); // mettre à jour le tableau dans le panneau
    })
    .catch(function(erreur) {
      afficherToast("Erreur : " + erreur.message, "error");
    });
}

// Ces deux fonctions sont appelées depuis des attributs onclick dans le HTML
// (les boutons ✏️ et 🗑️ générés dynamiquement dans le tableau)
// Il faut les attacher à window pour qu'elles soient accessibles globalement
window.ouvrirEdition       = ouvrirEdition;
window.supprimerPointAdmin = supprimerPointAdmin;


// ════════════════════════════════════════════════════════════
//  19. PROTECTION CONTRE LES FAILLES XSS
//
//  XSS (Cross-Site Scripting) = une faille de sécurité où
//  du code malveillant est injecté dans la page via du texte.
//
//  Exemple : si un point a le nom "<script>alert('hacked')</script>",
//  sans protection ce code s'exécuterait dans le navigateur !
//
//  La solution : remplacer les caractères spéciaux HTML par
//  leurs équivalents inoffensifs ("entités HTML") avant de
//  les insérer dans du HTML.
// ════════════════════════════════════════════════════════════

function escapeHtml(texte) {
  return texte
    .replace(/&/g,  "&amp;")  // & devient &amp;
    .replace(/"/g,  "&quot;") // " devient &quot;
    .replace(/</g,  "&lt;")   // < devient &lt;
    .replace(/>/g,  "&gt;");  // > devient &gt;
}