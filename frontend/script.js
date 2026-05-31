// ============================================================
//  SOS-CH — script.js
//  Carte interactive + CRUD des services d'urgence
//  Auteurs : Reto Lazzeri, Matthias Renaud & Florian Zaccomer
// ============================================================

// ── 1. Configuration ─────────────────────────────────────────────────────
const API_BASE  = "http://localhost:5000/api";
const OSRM_BASE = "https://router.project-osrm.org";
const TABLE_COULEUR = { fire_station: "red", police: "blue", hospital: "green" };

// ── 2. Projection LV95 ────────────────────────────────────────────────────
const extent = [2420000, 1030000, 2900000, 1360000];
proj4.defs("EPSG:2056",
  "+proj=somerc +lat_0=46.95240555555556 +lon_0=7.439583333333333 +k_0=1 +x_0=2600000" +
  " +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs");
ol.proj.proj4.register(proj4);
const projection = new ol.proj.Projection({ code: "EPSG:2056", extent });

// ── 3. Carte OpenLayers ───────────────────────────────────────────────────
const map = new ol.Map({
  target: "map",
  layers: [new ol.layer.Tile({
    source: new ol.source.TileWMS({
      url: "https://wms.geo.admin.ch/",
      params: { LAYERS: "ch.swisstopo.pixelkarte-farbe", FORMAT: "image/png", VERSION: "1.3.0" },
      serverType: "mapserver", projection,
    }),
  })],
  view: new ol.View({
    projection, center: [2660000, 1190000], zoom: 2.5, minZoom: 2.5,
    extent: [2485000, 1075000, 2834000, 1296000], constrainOnlyCenter: true,
  }),
});

// ── 4. Styles ─────────────────────────────────────────────────────────────
function creerStyle(couleur, rayon = 6) {
  return new ol.style.Style({ image: new ol.style.Circle({
    radius: rayon,
    fill:   new ol.style.Fill({ color: couleur }),
    stroke: new ol.style.Stroke({ color: "white", width: 2 }),
  })});
}
const styleNormal     = { red: creerStyle("red"),   blue: creerStyle("blue"),   green: creerStyle("green") };
const styleSelectionne= { red: creerStyle("red",10),blue: creerStyle("blue",10),green: creerStyle("green",10) };

// ── 5. Sources et couches (créées AVANT tout chargement) ──────────────────
const sources = {
  red:   new ol.source.Vector(),
  blue:  new ol.source.Vector(),
  green: new ol.source.Vector(),
};
Object.entries(sources).forEach(([couleur, source]) => {
  const couche = new ol.layer.Vector({ source, style: styleNormal[couleur], zIndex: 300 });
  couche.set("poiCouleur", couleur);
  map.addLayer(couche);
});

// ── 6. Marqueur viseur ────────────────────────────────────────────────────
const crossSVG = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <circle cx="16" cy="16" r="13" fill="none" stroke="white" stroke-width="3"/>
  <circle cx="16" cy="16" r="13" fill="none" stroke="#ff6600" stroke-width="1.5"/>
  <line x1="16" y1="2"  x2="16" y2="10" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="2"  x2="16" y2="10" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="16" y1="22" x2="16" y2="30" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="16" y1="22" x2="16" y2="30" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="2"  y1="16" x2="10" y2="16" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="2"  y1="16" x2="10" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="22" y1="16" x2="30" y2="16" stroke="white" stroke-width="3" stroke-linecap="round"/>
  <line x1="22" y1="16" x2="30" y2="16" stroke="#ff6600" stroke-width="1.5" stroke-linecap="round"/>
  <circle cx="16" cy="16" r="2.5" fill="#ff6600" stroke="white" stroke-width="1.5"/>
</svg>`;
const sourceMarqueur = new ol.source.Vector();
map.addLayer(new ol.layer.Vector({
  source: sourceMarqueur, zIndex: 700,
  style: new ol.style.Style({ image: new ol.style.Icon({
    src: `data:image/svg+xml;utf8,${encodeURIComponent(crossSVG)}`, anchor: [0.5, 0.5],
  })}),
}));

// ── 7. Marqueur preview ───────────────────────────────────────────────────
const sourcePreview = new ol.source.Vector();
map.addLayer(new ol.layer.Vector({ source: sourcePreview, zIndex: 900, style: creerStyle("#ff6600", 9) }));

// ── 8. Itinéraires ────────────────────────────────────────────────────────
const couchesItineraires  = { red: null, blue: null, green: null };
const derniersItineraires = { red: null, blue: null, green: null };
function supprimerItineraire(c) {
  if (couchesItineraires[c]) { map.removeLayer(couchesItineraires[c]); couchesItineraires[c] = null; }
}
function supprimerTousItineraires() { Object.keys(couchesItineraires).forEach(supprimerItineraire); }

// ── 9. Panneau POI ────────────────────────────────────────────────────────
const panneau = document.getElementById("poi-panel");
let featureSelectionnee = null, couleurSelectionnee = null;
function fermerPanneau() {
  panneau.style.display = "none";
  if (featureSelectionnee) {
    featureSelectionnee.setStyle(styleNormal[couleurSelectionnee]);
    featureSelectionnee = null; couleurSelectionnee = null;
  }
}
document.getElementById("poi-close").addEventListener("click", fermerPanneau);

// ── 10. Chargement des données depuis PostgreSQL ──────────────────────────
// Prérequis : api.py doit tourner sur localhost:5000
//             et import_geojson.py doit avoir été exécuté une fois.

let nbTablesEchouees = 0;

function chargerPointsDB(table, couleur) {
  fetch(`${API_BASE}/export/${table}`)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(geojson => {
      const features = new ol.format.GeoJSON().readFeatures(geojson, {
        dataProjection: "EPSG:2056", featureProjection: "EPSG:2056",
      });
      features.forEach(f => {
        const props = f.getProperties();
        f.set("apiId", props.id);
        f.set("name",  props.name || "");
      });
      sources[couleur].addFeatures(features);
      console.log(`OK DB ${table} -> ${features.length} points charges`);
      if (features.length === 0)
        console.warn(`  -> Table ${table} vide : avez-vous lance import_geojson.py ?`);
    })
    .catch(err => {
      console.error(`Impossible de charger ${table} :`, err);
      nbTablesEchouees++;
      if (nbTablesEchouees === 1)
        afficherToast("API inaccessible — verifiez que api.py tourne sur localhost:5000", "error");
    });
}

chargerPointsDB("fire_station", "red");
chargerPointsDB("police",       "blue");
chargerPointsDB("hospital",     "green");

// ── 11. Conversion de coordonnées ─────────────────────────────────────────
function lv95VersWgs84(c) { return ol.proj.transform(c, "EPSG:2056", "EPSG:4326"); }
function wgs84VersLv95(c) { return ol.proj.transform(c, "EPSG:4326", "EPSG:2056"); }

// ── 12. Calcul d'itinéraires (OSRM) ──────────────────────────────────────
const NB_CANDIDATS = 20;
function getCandidats(coordLv95, couleur, n = NB_CANDIDATS) {
  return sources[couleur].getFeatures()
    .filter(f => f.getGeometry())
    .map(f => { const c = f.getGeometry().getCoordinates();
      return { feature: f, dist: Math.hypot(c[0]-coordLv95[0], c[1]-coordLv95[1]) }; })
    .sort((a,b) => a.dist - b.dist).slice(0,n).map(x => x.feature);
}
async function calculerItineraireOSRM(deWgs84, versWgs84) {
  const url = `${OSRM_BASE}/route/v1/driving/${deWgs84[0]},${deWgs84[1]};${versWgs84[0]},${versWgs84[1]}?overview=full&geometries=geojson`;
  const res  = await fetch(url); if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const data = await res.json();
  if (data.code !== "Ok" || !data.routes?.length) throw new Error("Pas d'itineraire");
  const r = data.routes[0];
  return { time: r.duration, distance: r.distance/1000, coords: r.geometry.coordinates };
}
async function trouverMeilleurPOI(coordLv95, couleur) {
  const candidats = getCandidats(coordLv95, couleur);
  if (!candidats.length) return null;
  const deWgs84 = lv95VersWgs84(coordLv95);
  const resultats = await Promise.all(candidats.map(async feature => {
    try { const route = await calculerItineraireOSRM(deWgs84, lv95VersWgs84(feature.getGeometry().getCoordinates()));
          return { feature, route, time: route.time }; }
    catch { return { feature, route: null, time: Infinity }; }
  }));
  return resultats.reduce((best,r) => r.time < best.time ? r : best, resultats[0]);
}
function afficherItineraire(coords, couleur) {
  supprimerItineraire(couleur);
  const couleursLigne = { blue:"#1a56db", green:"#057a55", red:"#e02424" };
  const coordsLv95 = coords.map(([lon,lat]) => wgs84VersLv95([lon,lat]));
  const feat = new ol.Feature({ geometry: new ol.geom.LineString(coordsLv95) });
  feat.setStyle([
    new ol.style.Style({ stroke: new ol.style.Stroke({ color:"white", width:7 }) }),
    new ol.style.Style({ stroke: new ol.style.Stroke({ color:couleursLigne[couleur], width:4, lineDash:[12,6] }) }),
  ]);
  couchesItineraires[couleur] = new ol.layer.Vector({ source: new ol.source.Vector({ features:[feat] }), zIndex:500 });
  map.addLayer(couchesItineraires[couleur]);
}

// ── 13. Toast ─────────────────────────────────────────────────────────────
let timerToast = null;
function afficherToast(message, type="info") {
  const toast = document.getElementById("routing-toast");
  if (timerToast) clearTimeout(timerToast);
  toast.textContent = message; toast.className = `toast-${type}`;
  timerToast = setTimeout(() => { toast.className = "toast-hidden"; }, 3200);
}

// ── 14. Multi-itinéraires ─────────────────────────────────────────────────
function getCouleursSelectionnees() {
  return [...document.querySelectorAll(".svc-check:checked")].map(cb => cb.dataset.color);
}
async function calculerMultiItineraires(coordLv95) {
  const sel = getCouleursSelectionnees();
  if (!sel.length) { afficherToast("Cochez au moins un service", "error"); return; }
  sourceMarqueur.clear();
  sourceMarqueur.addFeature(new ol.Feature({ geometry: new ol.geom.Point(coordLv95) }));
  const panel = document.getElementById("multi-route-panel");
  ["red","blue","green"].forEach(c => {
    supprimerItineraire(c); derniersItineraires[c] = null;
    const ligne = document.getElementById(`mrp-row-${c}`);
    const res   = document.getElementById(`mrp-result-${c}`);
    if (sel.includes(c)) { ligne.style.display="flex"; ligne.style.opacity="1"; res.innerHTML=`<span class="mrp-loading">Calcul…</span>`; }
    else ligne.style.display="none";
  });
  panel.style.display = "block";
  let nbFini = 0;
  await Promise.all(sel.map(async c => {
    try {
      const meilleur = await trouverMeilleurPOI(coordLv95, c);
      if (!meilleur?.route) { document.getElementById(`mrp-result-${c}`).innerHTML=`<span class="mrp-error">Aucun itineraire</span>`; return; }
      derniersItineraires[c] = meilleur.route;
      const cb = document.querySelector(`.svc-check[data-color="${c}"]`);
      if (cb?.checked) afficherItineraire(meilleur.route.coords, c);
      const mins = Math.round(meilleur.route.time/60);
      const km   = meilleur.route.distance.toFixed(1);
      const p    = meilleur.feature.getProperties();
      const nom  = p.name||p.Name||p.NAME||p.bezeichnung||p.nom||"Sans nom";
      document.getElementById(`mrp-result-${c}`).innerHTML =
        `<div class="mrp-time"><strong>${mins} min</strong><span class="mrp-km"> · ${km} km</span></div><div class="mrp-name">${nom}</div>`;
    } catch(err) {
      document.getElementById(`mrp-result-${c}`).innerHTML=`<span class="mrp-error">Erreur</span>`;
    }
    nbFini++;
    if (nbFini === sel.length) afficherToast("Itineraires calcules","success");
  }));
}

// ── 15. Clic sur la carte ─────────────────────────────────────────────────
map.on("singleclick", async e => {
  if (modeAjoutActif) {
    const [x, y] = e.coordinate;
    coordsEnAttente = [x, y];
    sourcePreview.clear();
    sourcePreview.addFeature(new ol.Feature({ geometry: new ol.geom.Point([x, y]) }));
    document.getElementById("apm-click-icon").textContent = "📍";
    document.getElementById("apm-click-text").textContent =
      `Point place — X: ${Math.round(x).toLocaleString("fr-CH")}, Y: ${Math.round(y).toLocaleString("fr-CH")}`;
    document.getElementById("apm-click-zone").classList.add("apm-click-zone--ok");
    verifierPretModal();
    return;
  }
  await calculerMultiItineraires(e.coordinate);
});
map.once("rendercomplete", () => { map.getTargetElement().style.cursor = "crosshair"; });

// ── 16. Cases à cocher ────────────────────────────────────────────────────
document.querySelectorAll(".svc-check").forEach(cb => {
  cb.addEventListener("change", () => {
    const c = cb.dataset.color;
    const l = document.getElementById(`mrp-row-${c}`);
    if (l) l.style.opacity = cb.checked ? "1" : "0.35";
    if (cb.checked) { if (derniersItineraires[c]) afficherItineraire(derniersItineraires[c].coords,c); }
    else supprimerItineraire(c);
  });
});
document.getElementById("btn-clear-all").addEventListener("click", () => {
  supprimerTousItineraires(); sourceMarqueur.clear();
  document.getElementById("multi-route-panel").style.display="none"; fermerPanneau();
});
document.getElementById("mrp-close").addEventListener("click", () => {
  document.getElementById("multi-route-panel").style.display="none";
  supprimerTousItineraires(); sourceMarqueur.clear();
});

// ── 17. Modal AJOUT ───────────────────────────────────────────────────────
const overlayAjout  = document.getElementById("add-point-overlay");
let typeEnAttente   = null;
let coordsEnAttente = null;
let modeAjoutActif  = false;

document.getElementById("btn-add-point").addEventListener("click", () => {
  overlayAjout.classList.add("apm-visible");
  reinitialiserModal();
  modeAjoutActif = true;
  map.getTargetElement().style.cursor = "crosshair";
});

function fermerModal() {
  overlayAjout.classList.remove("apm-visible");
  typeEnAttente   = null;
  coordsEnAttente = null;
  modeAjoutActif  = false;
  sourcePreview.clear();
  map.getTargetElement().style.cursor = "crosshair";
}
document.getElementById("apm-close").addEventListener("click",  fermerModal);
document.getElementById("apm-cancel").addEventListener("click", fermerModal);

function reinitialiserModal() {
  document.querySelectorAll(".apm-type-btn").forEach(b => b.classList.remove("selected"));
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
    document.querySelectorAll(".apm-type-btn").forEach(b => b.classList.remove("selected"));
    btn.classList.add("selected");
    typeEnAttente = btn.dataset.type;
    verifierPretModal();
  });
});

function verifierPretModal() {
  document.getElementById("apm-submit").disabled = !(typeEnAttente && coordsEnAttente);
}

document.getElementById("apm-submit").addEventListener("click", async () => {
  const nom = document.getElementById("apm-name").value.trim();
  const [x, y] = coordsEnAttente;
  document.getElementById("apm-submit").disabled = true;
  document.getElementById("apm-status").innerHTML = `<span class="apm-saving">Enregistrement…</span>`;
  try {
    const res  = await fetch(`${API_BASE}/points/${typeEnAttente}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: nom, x, y }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.erreur || `HTTP ${res.status}`);
    document.getElementById("apm-status").innerHTML = `<span class="apm-success">Ajoute (id ${data.id})</span>`;
    afficherToast("Point ajoute", "success");
    const couleur = TABLE_COULEUR[typeEnAttente];
    const feat    = new ol.Feature({ geometry: new ol.geom.Point([x, y]) });
    feat.set("name",  nom);
    feat.set("apiId", data.id);
    sources[couleur].addFeature(feat);
    setTimeout(fermerModal, 1200);
  } catch(err) {
    document.getElementById("apm-status").innerHTML = `<span class="apm-error-msg">Erreur : ${err.message}</span>`;
    document.getElementById("apm-submit").disabled  = false;
  }
});

// ── 18. Panneau ADMIN ─────────────────────────────────────────────────────
const panneauAdmin = document.getElementById("admin-panel");
let idEnEdition = null;
document.getElementById("btn-admin-panel").addEventListener("click", () => {
  if (panneauAdmin.style.display==="none") { panneauAdmin.style.display="block"; chargerTableAdmin(); }
  else panneauAdmin.style.display="none";
});
document.getElementById("adm-close").addEventListener("click", () => { panneauAdmin.style.display="none"; });
document.getElementById("adm-filter-table").addEventListener("change", chargerTableAdmin);
document.getElementById("adm-refresh").addEventListener("click", chargerTableAdmin);

async function chargerTableAdmin() {
  const table = document.getElementById("adm-filter-table").value;
  const tbody = document.getElementById("adm-tbody");
  tbody.innerHTML=`<tr><td colspan="5" class="adm-loading">Chargement…</td></tr>`;
  fermerEdition();
  try {
    const res  = await fetch(`${API_BASE}/points/${table}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.erreur||`HTTP ${res.status}`);
    if (data.points.length===0) {
      tbody.innerHTML=`<tr><td colspan="5" class="adm-loading">Aucun point dans cette table.</td></tr>`; return;
    }
    tbody.innerHTML = data.points.map(p=>`
      <tr data-id="${p.id}">
        <td class="adm-cell-id">${p.id}</td>
        <td>${p.name||"—"}</td>
        <td>${Math.round(p.x)}</td>
        <td>${Math.round(p.y)}</td>
        <td class="adm-cell-actions">
          <button class="adm-btn adm-btn--edit"   onclick="ouvrirEdition(${p.id},'${escapeHtml(p.name||'')}',${p.x},${p.y})">✏️</button>
          <button class="adm-btn adm-btn--delete" onclick="supprimerPointAdmin(${p.id})">🗑️</button>
        </td>
      </tr>`).join("");
  } catch(err) {
    tbody.innerHTML=`<tr><td colspan="5" class="adm-error">Erreur : ${err.message}</td></tr>`;
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

// ── 19. Anti-XSS ──────────────────────────────────────────────────────────
function escapeHtml(t){return t.replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
