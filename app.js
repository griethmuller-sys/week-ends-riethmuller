/* Week-ends Riethmuller — application.
   Le squelette du calendrier vient de calendrier.json (fichier statique).
   Les activites et les week-ends reserves vivent dans Supabase, en temps reel. */

let CAL = null;
let ETAT = { activites: {}, reserves: [] };
let PERSONNES = [];
let NOM = {};

let sb = null;                 // client Supabase
let session = null;            // session authentifiee
let etatDistant = null;        // miroir de la base, sert a calculer les differences
let pousseEnCours = false;
let ignorerRealtimeJusqua = 0;
const JOURS_COURTS = ["lun", "mar", "mer", "jeu", "ven", "sam", "dim"];
const JOURS_LONGS = ["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];
const MOIS_NOMS = ["janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

let pressePapier = null;          // activite copiee, en attente de collage
let glisse = null;                // activite en cours de deplacement
let chronoGlisser = null;         // garde-fou si dragend ne se declenche jamais
let renduDiffere = false;         // un rendu a ete demande pendant un glisser
let rechargementDiffere = false;  // idem pour un rechargement depuis la base
const HISTORIQUE = { pile: [], position: -1 };
let publicationEnCours = false;
let publicationDemandee = false;

const vue = {
  onglet: "weekends",
  mois: null,
  recherche: "",
  moi: null,
};

/* ------------------------------------------------------------- utilitaires */
const $ = (sel, racine = document) => racine.querySelector(sel);
const echapper = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function dateDe(iso) {
  const [a, m, j] = iso.split("-").map(Number);
  return new Date(a, m - 1, j);
}
function isoDe(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function jourSemaine(iso) { return (dateDe(iso).getDay() + 6) % 7; }
function jjmm(iso) { const [, m, j] = iso.split("-"); return `${j}/${m}`; }
function jourNombre(d) { return d.getDate() === 1 ? "1er" : String(d.getDate()); }
function plageLisible(we) {
  const ouverts = joursOuverts(we);
  const a = dateDe(ouverts[0].iso);
  const b = dateDe(ouverts[ouverts.length - 1].iso);
  if (a.getMonth() === b.getMonth()) {
    return `${jourNombre(a)} – ${jourNombre(b)} ${MOIS_NOMS[a.getMonth()]}`;
  }
  return `${jourNombre(a)} ${MOIS_NOMS[a.getMonth()]} – ${jourNombre(b)} ${MOIS_NOMS[b.getMonth()]}`;
}

function actesDe(iso) { return ETAT.activites[iso] || []; }
function estReserve(sam) { return ETAT.reserves.includes(sam); }
function tronquer(t, n) { return t.length > n ? t.slice(0, n - 1) + "…" : t; }
function idUnique() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function weekendParSam(sam) { return CAL.weekends.find((w) => w.sam === sam); }
function joursOuverts(we) { return we.jours.filter((j) => j.ouvert); }
function actesDuWeekend(we) { return joursOuverts(we).flatMap((j) => actesDe(j.iso)); }
function estLibre(we) { return actesDuWeekend(we).length === 0; }
function scoutDansWeekend(we) { return actesDuWeekend(we).some((a) => a.origine === "scout"); }

function correspond(texte) {
  if (!vue.recherche) return true;
  return texte.toLowerCase().includes(vue.recherche.toLowerCase());
}
function weekendVisible(we) {
  if (!vue.recherche) return true;
  const q = vue.recherche.toLowerCase();
  if (we.mois.toLowerCase().includes(q) || we.vac.toLowerCase().includes(q)) return true;
  return actesDuWeekend(we).some((a) => a.texte.toLowerCase().includes(q) || NOM[a.qui].toLowerCase().includes(q));
}

function prochainWeekendIso() {
  const auj = isoDe(new Date());
  const futur = CAL.weekends.find((w) => w.jours[4].iso >= auj);
  return (futur || CAL.weekends[CAL.weekends.length - 1]).sam;
}

/* -------------------------------------------------------------- historique */
function instantane() {
  return JSON.stringify({ activites: ETAT.activites, reserves: ETAT.reserves });
}

function amorcerHistorique() {
  HISTORIQUE.pile = [instantane()];
  HISTORIQUE.position = 0;
}

/* Toute modification du planning passe par ici : on applique, on empile, on publie. */
function appliquer(mutation) {
  mutation();
  HISTORIQUE.pile = HISTORIQUE.pile.slice(0, HISTORIQUE.position + 1);
  HISTORIQUE.pile.push(instantane());
  HISTORIQUE.position = HISTORIQUE.pile.length - 1;
  if (HISTORIQUE.pile.length > 100) { HISTORIQUE.pile.shift(); HISTORIQUE.position--; }
  planifierPublication();
  rendreContenu();
  majHistorique();
}

function restaurer(index) {
  const etape = JSON.parse(HISTORIQUE.pile[index]);
  ETAT.activites = etape.activites;
  ETAT.reserves = etape.reserves;
  HISTORIQUE.position = index;
  planifierPublication();
  rendreContenu();
  majHistorique();
}

function annuler() { if (HISTORIQUE.position > 0) restaurer(HISTORIQUE.position - 1); }
function retablir() { if (HISTORIQUE.position < HISTORIQUE.pile.length - 1) restaurer(HISTORIQUE.position + 1); }

function majHistorique() {
  const a = $("#btn-annuler"), r = $("#btn-retablir");
  if (a) a.disabled = HISTORIQUE.position <= 0;
  if (r) r.disabled = HISTORIQUE.position >= HISTORIQUE.pile.length - 1;
}

/* ----------------------------------------------------- Supabase : lecture */
async function charger() {
  const [acts, res] = await Promise.all([
    sb.from("activites").select("id, jour, qui, texte, statut, origine, rang")
      .order("jour").order("rang"),
    sb.from("weekends_reserves").select("samedi"),
  ]);
  if (acts.error || res.error) throw (acts.error || res.error);

  const parJour = {};
  for (const a of acts.data) {
    if (!parJour[a.jour]) parJour[a.jour] = [];
    parJour[a.jour].push({
      id: a.id, qui: a.qui, texte: a.texte, statut: a.statut,
      origine: a.origine, rang: a.rang == null ? parJour[a.jour].length : a.rang,
    });
  }
  for (const liste of Object.values(parJour)) {
    liste.sort((x, y) => x.rang - y.rang);
    liste.forEach((a, i) => { a.rang = i; });
  }
  ETAT.activites = parJour;
  ETAT.reserves = res.data.map((r) => r.samedi).sort();
  etatDistant = instantane();
}

/* ---------------------------------------------------- Supabase : ecriture */
function indexer(activites) {
  const index = {};
  for (const [jour, liste] of Object.entries(activites)) {
    for (const a of liste) index[a.id] = {
      jour, qui: a.qui, texte: a.texte, statut: a.statut,
      origine: a.origine || null, rang: a.rang || 0,
    };
  }
  return index;
}

function memeActivite(a, b) {
  return a.jour === b.jour && a.qui === b.qui && a.texte === b.texte
      && a.statut === b.statut && a.rang === b.rang;
}

let minuteurPoussee = null;
function planifierPoussee() {
  majEtatSauvegarde("attente");
  clearTimeout(minuteurPoussee);
  minuteurPoussee = setTimeout(pousser, 450);
}

async function pousser() {
  if (!sb || !session || etatDistant === null) return;
  if (pousseEnCours) { planifierPoussee(); return; }

  const avant = indexer(JSON.parse(etatDistant).activites);
  const apres = indexer(ETAT.activites);
  const reservesAvant = JSON.parse(etatDistant).reserves;

  const aInserer = [], aModifier = [], aSupprimer = [];
  for (const [id, a] of Object.entries(apres)) {
    if (!avant[id]) aInserer.push({ id, ...a });
    else if (!memeActivite(avant[id], a)) aModifier.push({ id, ...a });
  }
  for (const id of Object.keys(avant)) if (!apres[id]) aSupprimer.push(id);

  const reservesPlus = ETAT.reserves.filter((s) => !reservesAvant.includes(s));
  const reservesMoins = reservesAvant.filter((s) => !ETAT.reserves.includes(s));

  if (!aInserer.length && !aModifier.length && !aSupprimer.length
      && !reservesPlus.length && !reservesMoins.length) { majEtatSauvegarde("ok"); return; }

  pousseEnCours = true;
  majEtatSauvegarde("encours");
  try {
    if (aSupprimer.length) {
      const r = await sb.from("activites").delete().in("id", aSupprimer);
      if (r.error) throw r.error;
    }
    if (aInserer.length || aModifier.length) {
      const r = await sb.from("activites").upsert([...aInserer, ...aModifier]);
      if (r.error) throw r.error;
    }
    if (reservesMoins.length) {
      const r = await sb.from("weekends_reserves").delete().in("samedi", reservesMoins);
      if (r.error) throw r.error;
    }
    if (reservesPlus.length) {
      const r = await sb.from("weekends_reserves").insert(reservesPlus.map((s) => ({ samedi: s })));
      if (r.error) throw r.error;
    }
    etatDistant = instantane();
    ignorerRealtimeJusqua = Date.now() + 1500;
    majEtatSauvegarde("ok");
  } catch (err) {
    console.error("Supabase :", err);
    majEtatSauvegarde("erreur");
    await rechargerDepuisLaBase();
  } finally {
    pousseEnCours = false;
  }
}

/* --------------------------------------------------- Supabase : temps reel */
let minuteurRechargement = null;
function planifierRechargement() {
  if (Date.now() < ignorerRealtimeJusqua) return;
  clearTimeout(minuteurRechargement);
  minuteurRechargement = setTimeout(rechargerDepuisLaBase, 350);
}

async function rechargerDepuisLaBase() {
  if (pousseEnCours) return;
  if (glisse) { rechargementDiffere = true; return; }
  try {
    await charger();
    amorcerHistorique();
    rendreContenu();
    majHistorique();
  } catch (err) {
    console.error("Rechargement :", err);
    majEtatSauvegarde("hors-ligne");
  }
}

function abonner() {
  sb.channel("planning-riethmuller")
    .on("postgres_changes", { event: "*", schema: "public", table: "activites" }, planifierRechargement)
    .on("postgres_changes", { event: "*", schema: "public", table: "weekends_reserves" }, planifierRechargement)
    .subscribe();
}

const planifierPublication = planifierPoussee;

function majEtatSauvegarde(mode) {
  const el = $("#etat-sauvegarde");
  if (!el) return;
  const textes = {
    pret: "", attente: "Modification…", encours: "Enregistrement…", ok: "Enregistré",
    "hors-ligne": "Hors ligne — reconnexion…", erreur: "Échec de l'enregistrement",
  };
  el.textContent = textes[mode] || "";
  el.classList.toggle("actif", mode !== "pret");
}

/* ------------------------------------------------------------------ rendu */
function rendre() {
  const racine = $("#racine");
  racine.innerHTML = gabaritBarre() + `<main class="page" id="contenu"></main>` + gabaritPied();
  brancherBarre();
  rendreContenu();
  majBarre();
  majHistorique();
}

function brancherRaccourcis() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && pressePapier && !document.querySelector(".voile")) {
      pressePapier = null;
      rendreContenu();
      annoncer("Copie annulée.");
      return;
    }
    if (!(e.ctrlKey || e.metaKey)) return;
    const dansUnChamp = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
    const touche = e.key.toLowerCase();
    if (touche === "z" && !dansUnChamp) { e.preventDefault(); e.shiftKey ? retablir() : annuler(); }
    else if (touche === "y" && !dansUnChamp) { e.preventDefault(); retablir(); }
  });
}

function rendreContenu() {
  /* Reconstruire le DOM pendant un glisser detruit l'element deplace : le
     navigateur perd le fil, et Safari se fige. On repousse a la fin du geste. */
  if (glisse) { renduDiffere = true; return; }
  const zone = $("#contenu");
  zone.innerHTML = vue.onglet === "weekends" ? gabaritWeekends() : gabaritMois();
  brancherContenu();
}

function gabaritBarre() {
  const opts = PERSONNES.map((p) => `<option value="${p.id}">${p.nom}</option>`).join("");
  return `<header class="barre"><div class="barre-in">
    <div class="marque">
      <b>Week-ends Riethmuller</b>
      <span>Année scolaire 2026-2027 · ${CAL.meta.nbWeekends} week-ends · zone A &amp; Genève</span>
    </div>
    <div class="onglets" role="tablist">
      <button role="tab" id="onglet-weekends" aria-selected="${vue.onglet === "weekends"}">Week-ends</button>
      <button role="tab" id="onglet-mois" aria-selected="${vue.onglet === "mois"}">Mois</button>
    </div>
    <div class="champ-recherche">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.2-3.2"></path></svg>
      <input type="search" id="recherche" placeholder="Rechercher…" value="${echapper(vue.recherche)}"
             aria-label="Rechercher dans le planning">
    </div>
    <div class="groupe-histo">
      <button class="bouton-icone" id="btn-annuler" title="Annuler (Ctrl+Z)" aria-label="Annuler">↶</button>
      <button class="bouton-icone" id="btn-retablir" title="Rétablir (Ctrl+Maj+Z)" aria-label="Rétablir">↷</button>
    </div>
    <button class="bouton-barre" id="btn-aujourdhui">Aujourd'hui</button>
    <button class="bouton-barre" id="btn-export">Export Excel</button>
    <div class="qui-suis-je">
      <label for="moi" style="font-size:12.5px;text-transform:none;letter-spacing:0;color:inherit;margin:0">Je suis</label>
      <select id="moi"><option value="">—</option>${opts}</select>
    </div>
    <div class="etat-sauvegarde" id="etat-sauvegarde" role="status" aria-live="polite"></div>
  </div></header>`;
}

function gabaritPied() {
  const l = (cls, nom) => `<span><i class="pastille-legende" style="background:var(--${cls})"></i>${nom}</span>`;
  return `<footer class="pied">
    <div class="legende">
      ${PERSONNES.map((p) => l(p.id, p.nom)).join("")}
      <span><i style="background:var(--vac);border:1px solid var(--vac-line)"></i>Vacances scolaires</span>
      <span><i style="background:var(--ferie-bg);border:1px solid var(--ferie-line)"></i>Jour férié ou pont</span>
      <span><i style="background:var(--reserve);border:1px solid var(--reserve-line)"></i>★ Week-end réservé</span>
    </div>
    <p>Colonnes jeudi, vendredi et lundi ouvertes uniquement les jours fériés en France ou à Genève,
    les jours sans classe et les ponts posés. Les activités scoutes de Thomas portent un cadenas :
    ouvrez-les pour les modifier si le programme change.</p>
    <p class="compte">Connecté en tant que <b>${echapper(session?.user?.email || "—")}</b>
      · <button id="btn-deconnexion" class="lien">Se déconnecter</button></p>
  </footer>`;
}

/* --------------------------------------------------------- vue « week-ends » */
function gabaritWeekends() {
  const visibles = CAL.weekends.filter(weekendVisible);
  if (!visibles.length) {
    return `<p class="vide">Aucun week-end ne correspond à « ${echapper(vue.recherche)} ».</p>`;
  }
  let html = "";
  let moisCourant = null;
  for (const we of visibles) {
    if (we.moisCle !== moisCourant) {
      moisCourant = we.moisCle;
      html += bandeauMois(we);
    }
    html += carteWeekend(we);
  }
  return html;
}

function bandeauMois(we) {
  const duMois = CAL.weekends.filter((w) => w.moisCle === we.moisCle);
  const reserves = duMois.filter((w) => estReserve(w.sam));
  const info = reserves.length
    ? `<span class="reserve-mois">★ Réservé : <b>${reserves.map((w) => jjmm(w.sam)).join(", ")}</b></span>`
    : `<span class="reserve-mois manquant">Aucun week-end réservé ce mois-ci</span>`;
  return `<div class="bandeau-mois"><h2>${echapper(we.mois)}</h2>${info}</div>`;
}

function carteWeekend(we) {
  const reserve = estReserve(we.sam);
  const libre = estLibre(we);
  const ouverts = joursOuverts(we);
  const plage = plageLisible(we);
  const classes = ["we", we.vac ? "vacances" : "", libre ? "libre" : "", reserve ? "reserve" : ""]
    .filter(Boolean).join(" ");

  const puces = [];
  if (reserve) puces.push(`<span class="puce reserve">★ Réservé</span>`);
  if (we.vac) puces.push(`<span class="puce vac">${echapper(we.vac)}</span>`);
  if (we.long) puces.push(`<span class="puce long">${ouverts.length} jours</span>`);
  if (scoutDansWeekend(we)) puces.push(`<span class="puce scout">Thomas au scout</span>`);
  if (libre && !reserve) puces.push(`<span class="puce libre">Libre</span>`);

  const cellules = we.jours.map((j) => celluleJour(j)).join("");
  const note = we.note ? `<p class="we-note">${echapper(we.note)}</p>` : "";

  return `<article class="${classes}" data-sam="${we.sam}" id="we-${we.sam}">
    <div class="we-tete">
      <span class="we-dates">${plage}</span>
      ${puces.join("")}
      <span class="we-actions">
        <button class="bouton-reserver" data-reserver="${we.sam}"
          aria-pressed="${reserve}">${reserve ? "Libérer" : "★ Réserver"}</button>
      </span>
    </div>
    ${note}
    <div class="jours">${cellules}</div>
  </article>`;
}

function celluleJour(j) {
  if (!j.ouvert) {
    return `<div class="jour ferme"><div class="jour-tete">
      <span class="jour-date">${echapper(j.label)}</span></div></div>`;
  }
  const ferie = j.ferie ? `<span class="jour-ferie">${echapper(j.ferie)}</span>` : "";
  const liste = actesDe(j.iso);
  const actes = liste.map((a, i) => vignetteActivite(a, j.iso, i, liste.length)).join("");
  const coller = pressePapier
    ? `<button class="coller" data-coller="${j.iso}">Coller « ${echapper(tronquer(pressePapier.texte, 22))} »</button>`
    : "";
  return `<div class="jour" data-jour="${j.iso}" data-depot="${j.iso}">
    <div class="jour-tete"><span class="jour-date">${echapper(j.label)}</span>${ferie}</div>
    <div class="acts">${actes}</div>
    <div class="jour-pied">
      <button class="ajouter" data-ajouter="${j.iso}">+ Ajouter</button>${coller}
    </div>
  </div>`;
}

function vignetteActivite(a, iso, index, total) {
  const ordonnable = total > 1;
  const classes = ["act", a.qui, a.statut === "a_confirmer" ? "a_confirmer" : "",
                   ordonnable ? "ordonnable" : ""].filter(Boolean).join(" ");
  const verrou = a.origine === "scout" ? `<span class="verrou" title="Programme scout">🔒</span>` : "";
  const suffixe = a.statut === "a_confirmer" ? " · à confirmer" : "";
  const ref = `${iso}|${a.id}`;
  return `<div class="${classes}" data-modifier="${ref}" data-glisser="${ref}"
       draggable="true" tabindex="0" role="button"
       aria-label="${echapper(NOM[a.qui] + " : " + a.texte)}">
    <span class="qui">${NOM[a.qui] ? NOM[a.qui][0] : "?"}</span>
    <span class="texte">${echapper(a.texte)}${suffixe}</span>${verrou}
    <span class="act-actions">
      ${ordonnable ? `
      <button draggable="false" data-monter="${ref}" title="Monter"
        aria-label="Monter dans la journée" ${index === 0 ? "disabled" : ""}>↑</button>
      <button draggable="false" data-descendre="${ref}" title="Descendre"
        aria-label="Descendre dans la journée" ${index === total - 1 ? "disabled" : ""}>↓</button>` : ""}
      <button draggable="false" data-copier="${ref}" title="Copier"
        aria-label="Copier l'activité">⧉</button>
      <button draggable="false" data-supprimer="${ref}" title="Supprimer"
        aria-label="Supprimer l'activité">×</button>
    </span>
  </div>`;
}

/* -------------------------------------------------------------- vue « mois » */
function gabaritMois() {
  const [an, mo] = vue.mois.split("-").map(Number);
  const premier = new Date(an, mo - 1, 1);
  const decalage = (premier.getDay() + 6) % 7;
  const debut = new Date(an, mo - 1, 1 - decalage);
  const titre = `${MOIS_NOMS[mo - 1]} ${an}`;

  const moisDispo = [...new Set(CAL.weekends.map((w) => w.moisCle))];
  const idx = moisDispo.indexOf(vue.mois);
  const reservesDuMois = CAL.weekends.filter((w) => w.moisCle === vue.mois && estReserve(w.sam));

  let cases = JOURS_LONGS.map((j) => `<div class="entete">${j.slice(0, 3)}</div>`).join("");
  for (let i = 0; i < 42; i++) {
    const d = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i);
    if (i >= 35 && d.getMonth() !== mo - 1) break;
    cases += caseMois(d, mo);
  }

  const info = reservesDuMois.length
    ? `★ Réservé : <b>${reservesDuMois.map((w) => jjmm(w.sam)).join(", ")}</b>`
    : `<span style="font-style:italic">Aucun week-end réservé ce mois-ci</span>`;

  return `<div class="mois-nav">
      <button id="mois-prec" ${idx <= 0 ? "disabled" : ""} aria-label="Mois précédent">←</button>
      <button id="mois-suiv" ${idx >= moisDispo.length - 1 ? "disabled" : ""} aria-label="Mois suivant">→</button>
      <h2>${titre.charAt(0).toUpperCase() + titre.slice(1)}</h2>
      <span class="reserve-mois" style="margin-left:auto;font-size:12.5px;color:var(--muted)">${info}</span>
    </div>
    <div class="grille-mois">${cases}</div>`;
}

function caseMois(d, moisRef) {
  const iso = isoDe(d);
  const info = CAL.jours[iso];
  const hors = d.getMonth() !== moisRef - 1 || !info;
  const auj = iso === isoDe(new Date());
  const we = info && info.we ? CAL.weekends[info.we - 1] : null;
  const reserve = we ? estReserve(we.sam) : false;

  const classes = ["case-mois",
    hors ? "hors" : (info && info.ouvert ? "" : "semaine"),
    !hors && info && info.vac ? "vacances" : "",
    reserve ? "reserve" : ""].filter(Boolean).join(" ");

  if (hors) {
    return `<div class="${classes}"><span class="num">${d.getDate()}</span></div>`;
  }

  const ferie = info.ferie ? `<span class="marque-ferie">${echapper(info.ferie.split(" ").slice(0, 3).join(" "))}</span>` : "";
  const etoile = reserve ? `<span class="etoile" title="Week-end réservé">★</span>` : "";
  const numero = auj
    ? `<span class="num"><span class="aujourdhui">${d.getDate()}</span>${etoile}</span>`
    : `<span class="num">${d.getDate()}${etoile}</span>`;

  const actes = actesDe(iso)
    .filter((a) => correspond(a.texte) || correspond(NOM[a.qui]))
    .map((a) => `<div class="mini ${a.qui}${a.statut === "a_confirmer" ? " a_confirmer" : ""}"
        data-modifier="${iso}|${a.id}" data-glisser="${iso}|${a.id}" draggable="true" tabindex="0" role="button"
        title="${echapper(NOM[a.qui] + " — " + a.texte)}">${echapper(a.texte)}</div>`).join("");

  const ajout = info.ouvert
    ? `<button class="ajouter" style="font-size:10.5px;padding:1px 7px" data-ajouter="${iso}">+</button>` : "";
  const coller = info.ouvert && pressePapier
    ? `<button class="coller mini-coller" data-coller="${iso}" title="Coller ici">Coller</button>` : "";

  const depot = info.ouvert ? ` data-depot="${iso}"` : "";
  return `<div class="${classes}"${depot}>${numero}${ferie}${actes}${ajout}${coller}</div>`;
}

/* ------------------------------------------------------------------ modale */
let modaleOuverte = null;

function ouvrirModale({ iso, id }) {
  const existante = id ? actesDe(iso).find((a) => a.id === id) : null;
  const info = CAL.jours[iso];
  modaleOuverte = { iso, id, qui: existante ? existante.qui : (vue.moi || "famille") };

  const d = dateDe(iso);
  const titreJour = `${JOURS_LONGS[jourSemaine(iso)]} ${d.getDate()} ${MOIS_NOMS[d.getMonth()]} ${d.getFullYear()}`;
  const contexte = [info && info.ferie ? info.ferie : "", info && info.vac ? info.vac : ""]
    .filter(Boolean).join(" · ");
  const we = info && info.we ? CAL.weekends[info.we - 1] : null;
  const alerte = we && estReserve(we.sam) && !existante
    ? `<span class="alerte-reserve"> · ★ Ce week-end est réservé</span>` : "";

  const pastilles = PERSONNES.map((p) =>
    `<button class="pastille ${p.id}" data-qui="${p.id}"
      aria-pressed="${modaleOuverte.qui === p.id}">${p.nom}</button>`).join("");

  const voile = document.createElement("div");
  voile.className = "voile";
  voile.innerHTML = `<div class="modale" role="dialog" aria-modal="true" aria-label="Activité">
    <header>
      <h3>${existante ? "Modifier l'activité" : "Ajouter une activité"}</h3>
      <p>${titreJour}${contexte ? " · " + echapper(contexte) : ""}${alerte}</p>
    </header>
    <div class="corps">
      <div><label>Pour qui</label><div class="pastilles">${pastilles}</div></div>
      <div><label for="texte-act">Activité</label>
        <textarea id="texte-act" placeholder="Ex. : Match U18 à Annecy, départ 8h">${existante ? echapper(existante.texte) : ""}</textarea></div>
      <label class="interrupteur"><input type="checkbox" id="a-confirmer"
        ${existante && existante.statut === "a_confirmer" ? "checked" : ""}> À confirmer</label>
    </div>
    <footer>
      ${existante ? `<button class="btn danger" id="supprimer">Supprimer</button>` : ""}
      <button class="btn discret" id="annuler">Annuler</button>
      <button class="btn principal" id="valider">${existante ? "Enregistrer" : "Ajouter"}</button>
    </footer>
  </div>`;
  document.body.appendChild(voile);

  const champ = $("#texte-act", voile);
  champ.focus();
  champ.setSelectionRange(champ.value.length, champ.value.length);

  voile.addEventListener("click", (e) => { if (e.target === voile) fermerModale(voile); });
  document.addEventListener("keydown", echapEcoute);

  voile.querySelectorAll("[data-qui]").forEach((b) => b.addEventListener("click", () => {
    modaleOuverte.qui = b.dataset.qui;
    voile.querySelectorAll("[data-qui]").forEach((x) =>
      x.setAttribute("aria-pressed", x.dataset.qui === modaleOuverte.qui));
  }));

  $("#annuler", voile).addEventListener("click", () => fermerModale(voile));
  const supp = $("#supprimer", voile);
  if (supp) supp.addEventListener("click", () => { supprimerActivite(iso, id); fermerModale(voile); });
  $("#valider", voile).addEventListener("click", () => { validerModale(voile); });
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) validerModale(voile);
  });

  function echapEcoute(e) { if (e.key === "Escape") fermerModale(voile); }
  voile._echap = echapEcoute;
}

function fermerModale(voile) {
  document.removeEventListener("keydown", voile._echap);
  voile.remove();
  modaleOuverte = null;
}

function validerModale(voile) {
  const texte = $("#texte-act", voile).value.trim();
  const statut = $("#a-confirmer", voile).checked ? "a_confirmer" : "confirme";
  const { iso, id, qui } = modaleOuverte;
  if (!texte) { if (id) supprimerActivite(iso, id); fermerModale(voile); return; }

  fermerModale(voile);
  appliquer(() => {
    if (!ETAT.activites[iso]) ETAT.activites[iso] = [];
    const liste = ETAT.activites[iso];
    const existante = id ? liste.find((a) => a.id === id) : null;
    if (existante) { existante.qui = qui; existante.texte = texte; existante.statut = statut; }
    else liste.push({ id: idUnique(), qui, texte, statut, rang: liste.length });
    reordonner(iso);
  });
}

function supprimerActivite(iso, id) {
  appliquer(() => {
    ETAT.activites[iso] = actesDe(iso).filter((a) => a.id !== id);
    if (!ETAT.activites[iso].length) delete ETAT.activites[iso];
    else reordonner(iso);
  });
}

function basculerReserve(sam) {
  appliquer(() => {
    if (estReserve(sam)) ETAT.reserves = ETAT.reserves.filter((s) => s !== sam);
    else ETAT.reserves = [...ETAT.reserves, sam].sort();
  });
}

/* Renumerote les activites d'un jour : 0, 1, 2… C'est ce rang qui fait foi. */
function reordonner(iso) {
  const liste = ETAT.activites[iso];
  if (liste) liste.forEach((a, i) => { a.rang = i; });
}

/* Efface les marques visuelles du glisser en cours. */
function nettoyerIndicateurs() {
  document.querySelectorAll(".en-glissement, .survol, .insert-avant, .insert-apres")
    .forEach((x) => x.classList.remove("en-glissement", "survol", "insert-avant", "insert-apres"));
}

/* Fin du geste : on nettoie, puis on rejoue ce qui avait ete mis en attente. */
function finDeGlisser() {
  glisse = null;
  clearTimeout(chronoGlisser);
  nettoyerIndicateurs();

  /* On desarme les deux drapeaux avant d'agir : un rechargement redessine de
     toute facon, mais laisser l'autre arme fausserait le geste suivant. */
  const rechargement = rechargementDiffere;
  const rendu = renduDiffere;
  rechargementDiffere = false;
  renduDiffere = false;

  if (rechargement) rechargerDepuisLaBase();
  else if (rendu) rendreContenu();
}

/* ------------------------------------------------ copier, coller, deplacer */
function copierActivite(iso, id) {
  const a = actesDe(iso).find((x) => x.id === id);
  if (!a) return;
  pressePapier = { qui: a.qui, texte: a.texte, statut: a.statut };
  try { if (navigator.clipboard) navigator.clipboard.writeText(a.texte); } catch (e) { /* refuse */ }
  rendreContenu();
  annoncer(`« ${tronquer(a.texte, 26)} » copié — Coller sur un autre jour, Échap pour arrêter.`);
}

function collerActivite(iso) {
  if (!pressePapier) return;
  const copie = { id: idUnique(), qui: pressePapier.qui, texte: pressePapier.texte, statut: pressePapier.statut };
  appliquer(() => {
    if (!ETAT.activites[iso]) ETAT.activites[iso] = [];
    ETAT.activites[iso].push(copie);
    reordonner(iso);
  });
}

/* Deplace une activite : vers un autre jour, ou a une autre place dans le meme
   jour. `idVoisin` et `avant` designent le point d'insertion ; sans eux,
   l'activite est ajoutee a la fin. Alt enfoncee = duplication. */
function deplacerActivite(isoSource, id, isoCible, dupliquer, idVoisin, avant) {
  if (!isoCible) return;
  if (id === idVoisin && !dupliquer) return;
  if (isoSource === isoCible && !dupliquer && !idVoisin) return;

  const a = actesDe(isoSource).find((x) => x.id === id);
  if (!a) return;

  appliquer(() => {
    const objet = dupliquer
      ? { id: idUnique(), qui: a.qui, texte: a.texte, statut: a.statut }
      : a;

    if (!dupliquer) {
      ETAT.activites[isoSource] = actesDe(isoSource).filter((x) => x.id !== id);
      if (!ETAT.activites[isoSource].length) delete ETAT.activites[isoSource];
    }

    if (!ETAT.activites[isoCible]) ETAT.activites[isoCible] = [];
    const cible = ETAT.activites[isoCible];

    let index = cible.length;
    if (idVoisin) {
      const i = cible.findIndex((x) => x.id === idVoisin);
      if (i >= 0) index = avant ? i : i + 1;
    }
    cible.splice(index, 0, objet);

    reordonner(isoSource);
    reordonner(isoCible);
  });
}

/* Monter / descendre d'un cran — meme resultat que le glisser, mais au doigt. */
function decalerActivite(iso, id, pas) {
  const liste = actesDe(iso);
  const i = liste.findIndex((a) => a.id === id);
  const j = i + pas;
  if (i < 0 || j < 0 || j >= liste.length) return;
  appliquer(() => {
    const liste = ETAT.activites[iso];
    [liste[i], liste[j]] = [liste[j], liste[i]];
    reordonner(iso);
  });
}

function annoncer(message) {
  const el = $("#etat-sauvegarde");
  if (!el) return;
  el.textContent = message;
  clearTimeout(annoncer._t);
  annoncer._t = setTimeout(() => majEtatSauvegarde("ok"), 3200);
}

/* ------------------------------------------------------------------ export */
function exporterExcel() {
  const octets = genererXlsx(CAL, { activites: ETAT.activites, sanctuarises: ETAT.reserves });
  const blob = new Blob([octets], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const lien = document.createElement("a");
  lien.href = url;
  lien.download = "Week-ends_Riethmuller_2026-2027.xlsx";
  document.body.appendChild(lien);
  lien.click();
  lien.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ------------------------------------------------------------- branchements */
function brancherBarre() {
  $("#onglet-weekends").addEventListener("click", () => { vue.onglet = "weekends"; rendre(); });
  $("#onglet-mois").addEventListener("click", () => {
    vue.onglet = "mois";
    if (!vue.mois) vue.mois = weekendParSam(prochainWeekendIso()).moisCle;
    rendre();
  });

  const rech = $("#recherche");
  rech.addEventListener("input", () => {
    vue.recherche = rech.value.trim();
    rendreContenu();
    const r = $("#recherche"); if (document.activeElement !== r) { r.focus(); r.setSelectionRange(r.value.length, r.value.length); }
  });

  $("#btn-annuler").addEventListener("click", annuler);
  $("#btn-retablir").addEventListener("click", retablir);
  $("#btn-aujourdhui").addEventListener("click", allerAujourdhui);
  $("#btn-export").addEventListener("click", exporterExcel);

  const deco = $("#btn-deconnexion");
  if (deco) deco.addEventListener("click", () => sb.auth.signOut());

  const moi = $("#moi");
  moi.value = vue.moi || "";
  moi.addEventListener("change", () => {
    vue.moi = moi.value || null;
    try { localStorage.setItem("planning-moi", moi.value); } catch (e) { /* stockage indisponible */ }
  });
}

function brancherContenu() {
  const zone = $("#contenu");

  zone.querySelectorAll("[data-ajouter]").forEach((b) =>
    b.addEventListener("click", () => ouvrirModale({ iso: b.dataset.ajouter, id: null })));

  zone.querySelectorAll("[data-coller]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); collerActivite(b.dataset.coller); }));

  zone.querySelectorAll("[data-copier]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [iso, id] = b.dataset.copier.split("|");
      copierActivite(iso, id);
    }));

  zone.querySelectorAll("[data-monter]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [iso, id] = b.dataset.monter.split("|");
      decalerActivite(iso, id, -1);
    }));

  zone.querySelectorAll("[data-descendre]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [iso, id] = b.dataset.descendre.split("|");
      decalerActivite(iso, id, 1);
    }));

  zone.querySelectorAll("[data-supprimer]").forEach((b) =>
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      const [iso, id] = b.dataset.supprimer.split("|");
      supprimerActivite(iso, id);
    }));

  zone.querySelectorAll("[data-modifier]").forEach((b) => {
    b.addEventListener("click", (e) => {
      if (e.target.closest(".act-actions")) return;
      const selection = window.getSelection && window.getSelection().toString();
      if (selection && b.contains(window.getSelection().anchorNode)) return;  // l'utilisateur selectionne du texte
      const [iso, id] = b.dataset.modifier.split("|");
      ouvrirModale({ iso, id });
    });
    b.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const [iso, id] = b.dataset.modifier.split("|");
      ouvrirModale({ iso, id });
    });
  });

  zone.querySelectorAll("[data-reserver]").forEach((b) =>
    b.addEventListener("click", () => basculerReserve(b.dataset.reserver)));

  /* --- glisser-deposer : deplacer une activite, ou la dupliquer avec Alt --- */
  zone.querySelectorAll("[data-glisser]").forEach((el) => {
    el.addEventListener("dragstart", (e) => {
      const [iso, id] = el.dataset.glisser.split("|");
      glisse = { iso, id };
      const a = actesDe(iso).find((x) => x.id === id);
      e.dataTransfer.effectAllowed = "copyMove";
      e.dataTransfer.setData("text/plain", a ? a.texte : "");
      el.classList.add("en-glissement");
      /* Si le navigateur oublie de signaler la fin du geste, on se debloque seuls. */
      clearTimeout(chronoGlisser);
      chronoGlisser = setTimeout(finDeGlisser, 30000);
    });

    el.addEventListener("dragend", finDeGlisser);

    /* Deposer sur une activite l'insere juste avant ou juste apres elle :
       c'est ce qui permet de ranger une journee a la main. */
    el.addEventListener("dragover", (e) => {
      if (!glisse) return;
      e.preventDefault();
      e.stopPropagation();
      const [isoEl, idEl] = el.dataset.glisser.split("|");
      if (idEl === glisse.id) return;
      const cadre = el.getBoundingClientRect();
      const avant = e.clientY < cadre.top + cadre.height / 2;
      e.dataTransfer.dropEffect = (e.altKey || e.ctrlKey || e.metaKey) ? "copy" : "move";
      el.classList.toggle("insert-avant", avant);
      el.classList.toggle("insert-apres", !avant);
      const parent = el.closest("[data-depot]");
      if (parent) parent.classList.remove("survol");
    });

    el.addEventListener("dragleave", () => {
      el.classList.remove("insert-avant", "insert-apres");
    });

    el.addEventListener("drop", (e) => {
      if (!glisse) return;
      e.preventDefault();
      e.stopPropagation();
      const avant = el.classList.contains("insert-avant");
      const [isoEl, idEl] = el.dataset.glisser.split("|");
      const dupliquer = e.altKey || e.ctrlKey || e.metaKey;
      const depart = glisse;

      /* Le geste est termine : on relache l'etat avant de toucher au DOM. */
      glisse = null;
      clearTimeout(chronoGlisser);
      nettoyerIndicateurs();

      if (idEl !== depart.id) {
        deplacerActivite(depart.iso, depart.id, isoEl, dupliquer, idEl, avant);
      }
    });
  });

  zone.querySelectorAll("[data-depot]").forEach((cible) => {
    cible.addEventListener("dragover", (e) => {
      if (!glisse) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = (e.altKey || e.ctrlKey || e.metaKey) ? "copy" : "move";
      cible.classList.add("survol");
    });
    cible.addEventListener("dragleave", (e) => {
      if (!cible.contains(e.relatedTarget)) cible.classList.remove("survol");
    });
    cible.addEventListener("drop", (e) => {
      if (!glisse) return;
      e.preventDefault();
      const dupliquer = e.altKey || e.ctrlKey || e.metaKey;
      const depart = glisse;

      glisse = null;
      clearTimeout(chronoGlisser);
      nettoyerIndicateurs();

      deplacerActivite(depart.iso, depart.id, cible.dataset.depot, dupliquer);
    });
  });

  const prec = $("#mois-prec"), suiv = $("#mois-suiv");
  if (prec) prec.addEventListener("click", () => decalerMois(-1));
  if (suiv) suiv.addEventListener("click", () => decalerMois(1));
}

function decalerMois(pas) {
  const moisDispo = [...new Set(CAL.weekends.map((w) => w.moisCle))];
  const i = moisDispo.indexOf(vue.mois) + pas;
  if (i < 0 || i >= moisDispo.length) return;
  vue.mois = moisDispo[i];
  rendreContenu();
}

function allerAujourdhui() {
  const sam = prochainWeekendIso();
  if (vue.onglet === "mois") {
    vue.mois = weekendParSam(sam).moisCle;
    rendreContenu();
    return;
  }
  if (vue.recherche) { vue.recherche = ""; $("#recherche").value = ""; rendreContenu(); }
  const cible = document.getElementById("we-" + sam);
  if (cible) cible.scrollIntoView({ behavior: "smooth", block: "center" });
}

function majBarre() {
  const el = $("#etat-sauvegarde");
  if (el && !navigator.onLine) el.textContent = "Hors ligne";
}

/* --------------------------------------------------------- ecran de connexion */
function rendreConnexion(message) {
  $("#racine").innerHTML = `<div class="accueil">
    <form class="carte-connexion" id="form-connexion">
      <h1>Week-ends Riethmuller</h1>
      <p class="sous">Le planning de la famille, année scolaire 2026-2027.</p>
      <label for="email">Adresse e-mail</label>
      <input type="email" id="email" autocomplete="username" required inputmode="email">
      <label for="mdp">Mot de passe</label>
      <input type="password" id="mdp" autocomplete="current-password" required>
      ${message ? `<p class="erreur">${echapper(message)}</p>` : ""}
      <button class="btn principal" type="submit" id="btn-connexion">Se connecter</button>
    </form>
  </div>`;

  $("#form-connexion").addEventListener("submit", async (e) => {
    e.preventDefault();
    const bouton = $("#btn-connexion");
    bouton.disabled = true;
    bouton.textContent = "Connexion…";
    const { error } = await sb.auth.signInWithPassword({
      email: $("#email").value.trim(),
      password: $("#mdp").value,
    });
    if (error) {
      rendreConnexion("Adresse e-mail ou mot de passe incorrect.");
      $("#email").focus();
    }
  });
  $("#email").focus();
}

/* ------------------------------------------------------------------ depart */
async function apresConnexion() {
  try { vue.moi = localStorage.getItem("planning-moi") || null; } catch (e) { vue.moi = null; }
  vue.mois = weekendParSam(prochainWeekendIso()).moisCle;

  $("#racine").innerHTML = `<p class="vide">Chargement du planning…</p>`;
  try {
    await charger();
  } catch (err) {
    console.error(err);
    $("#racine").innerHTML = `<p class="vide">Impossible de joindre la base de données.
      Vérifiez la connexion, puis rechargez la page.</p>`;
    return;
  }

  amorcerHistorique();
  rendre();
  brancherRaccourcis();
  abonner();
  setTimeout(allerAujourdhui, 60);

  window.addEventListener("online", () => { majEtatSauvegarde("ok"); rechargerDepuisLaBase(); });
  window.addEventListener("offline", () => majEtatSauvegarde("hors-ligne"));
}

async function demarrer() {
  const cfg = window.CONFIG_SUPABASE || {};
  if (!cfg.url || !cfg.cle || cfg.url.includes("VOTRE-PROJET")) {
    $("#racine").innerHTML = `<p class="vide">Configuration manquante : renseignez l'adresse du projet
      et la clé publique dans <code>config.js</code>.</p>`;
    return;
  }

  try {
    CAL = await (await fetch("calendrier.json", { cache: "no-cache" })).json();
  } catch (err) {
    $("#racine").innerHTML = `<p class="vide">Le calendrier n'a pas pu être chargé.</p>`;
    return;
  }
  PERSONNES = CAL.personnes;
  NOM = Object.fromEntries(PERSONNES.map((p) => [p.id, p.nom]));

  sb = window.supabase.createClient(cfg.url, cfg.cle);
  const { data } = await sb.auth.getSession();
  session = data.session;

  sb.auth.onAuthStateChange((evenement, s) => {
    session = s;
    if (s) { if (evenement === "SIGNED_IN") apresConnexion(); }
    else rendreConnexion();
  });

  if (session) apresConnexion(); else rendreConnexion();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* sans cache hors ligne */ });
  }
}

demarrer();
