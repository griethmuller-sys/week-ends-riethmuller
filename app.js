/* Week-ends Riethmuller — application.
   Le squelette du calendrier vient de calendrier.json (fichier statique).
   Les activites et les week-ends reserves vivent dans Supabase, en temps reel. */

let CAL = null;
let ETAT = { activites: {}, reserves: [], conges: [] };
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
let chronoGlisser = null;         // garde-fou si le geste ne se termine jamais
let renduDiffere = false;         // un rendu a ete demande pendant un glisser
let rechargementDiffere = false;  // idem pour un rechargement depuis la base
const HISTORIQUE = { pile: [], position: -1 };
let publicationEnCours = false;
let publicationDemandee = false;

const vue = {
  onglet: "semaine",     // "weekends" | "semaine" | "mois"
  ancre: null,           // jour de reference, conserve d'une vue a l'autre
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

function decaler(iso, n) {
  const d = dateDe(iso);
  d.setDate(d.getDate() + n);
  return isoDe(d);
}
function lundiDe(iso) { return decaler(iso, -jourSemaine(iso)); }
function joursDeLaSemaine(lundi) {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => decaler(lundi, i));
}
function infoJour(iso) { return CAL.jours[iso] || null; }
function dansLAnnee(iso) { return !!CAL.jours[iso]; }
function numeroSemaine(iso) {
  const info = infoJour(iso);
  if (info) return info.sem;
  /* Repli : norme ISO 8601, la semaine 1 est celle du premier jeudi. */
  const d = dateDe(iso);
  const u = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  u.setUTCDate(u.getUTCDate() + 4 - (u.getUTCDay() || 7));
  const an = new Date(Date.UTC(u.getUTCFullYear(), 0, 1));
  return Math.ceil(((u - an) / 86400000 + 1) / 7);
}
function moisCleDe(iso) { return iso.slice(0, 7); }
function moisLisible(iso) {
  const d = dateDe(iso);
  return `${MOIS_NOMS[d.getMonth()]} ${d.getFullYear()}`;
}

function actesDe(iso) { return ETAT.activites[iso] || []; }
function estReserve(sam) { return ETAT.reserves.includes(sam); }
function estConge(iso, qui = "gael") {
  return ETAT.conges.some((c) => c.jour === iso && c.qui === qui);
}

/* Qui ne travaille pas ce jour-la.
     fr / sc  -> Ingrid (institutrice) et Thomas (eleve) sont libres
     ge / pont / conge -> Gael est libre
     vacances scolaires -> Ingrid et Thomas
     week-end -> tout le monde, et on ne l'affiche pas : c'est implicite. */
function statutJour(iso) {
  const info = infoJour(iso) || { vac: "", fr: "", ge: "", sc: "", pont: "" };
  const js = jourSemaine(iso);
  const we = js >= 5;
  const conge = estConge(iso, "gael");
  return {
    we, vac: info.vac, fr: info.fr, ge: info.ge, sc: info.sc, pont: info.pont, conge,
    gael: we || !!info.ge || !!info.pont || conge,
    ingrid: we || !!info.fr || !!info.sc || !!info.vac || estConge(iso, "ingrid"),
    thomas: we || !!info.fr || !!info.sc || !!info.vac || estConge(iso, "thomas"),
  };
}
function tronquer(t, n) { return t.length > n ? t.slice(0, n - 1) + "…" : t; }
function idUnique() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

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


/* -------------------------------------------------------------- historique */
function instantane() {
  return JSON.stringify({
    activites: ETAT.activites, reserves: ETAT.reserves, conges: ETAT.conges,
  });
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
  ETAT.conges = etape.conges || [];
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
  const [acts, res, cgs] = await Promise.all([
    sb.from("activites").select("id, jour, qui, texte, statut, origine, rang")
      .order("jour").order("rang"),
    sb.from("weekends_reserves").select("samedi"),
    sb.from("conges").select("jour, qui"),
  ]);
  if (acts.error || res.error) throw (acts.error || res.error);
  /* La table des conges peut manquer si la migration 02 n'a pas encore ete
     passee : on continue sans, plutot que de bloquer tout le planning. */
  if (cgs.error) console.warn("Table conges absente :", cgs.error.message);

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
  ETAT.conges = (cgs.error ? [] : cgs.data.map((c) => ({ jour: c.jour, qui: c.qui })))
    .sort((a, b) => (a.jour + a.qui).localeCompare(b.jour + b.qui));
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

  const congesAvant = JSON.parse(etatDistant).conges || [];
  const cle = (c) => c.jour + "|" + c.qui;
  const clesAvant = new Set(congesAvant.map(cle));
  const clesApres = new Set(ETAT.conges.map(cle));
  const congesPlus = ETAT.conges.filter((c) => !clesAvant.has(cle(c)));
  const congesMoins = congesAvant.filter((c) => !clesApres.has(cle(c)));

  if (!aInserer.length && !aModifier.length && !aSupprimer.length
      && !reservesPlus.length && !reservesMoins.length
      && !congesPlus.length && !congesMoins.length) { majEtatSauvegarde("ok"); return; }

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
    /* Les conges n'ont pas d'identifiant : la cle est (jour, qui). On supprime
       donc personne par personne, pour ne pas emporter le conge d'un autre
       pose le meme jour. */
    for (const qui of new Set(congesMoins.map((c) => c.qui))) {
      const jours = congesMoins.filter((c) => c.qui === qui).map((c) => c.jour);
      const r = await sb.from("conges").delete().eq("qui", qui).in("jour", jours);
      if (r.error) throw r.error;
    }
    if (congesPlus.length) {
      const r = await sb.from("conges").insert(congesPlus.map((c) => ({ jour: c.jour, qui: c.qui })));
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
    .on("postgres_changes", { event: "*", schema: "public", table: "conges" }, planifierRechargement)
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
  placerQuiSuisJe();
  rendreContenu();
  majBarre();
  majHistorique();
}

/* « Je suis » se regle une fois pour toutes. Sur telephone la barre est
   collante et chaque rangee coute de l'ecran : le selecteur descend donc
   dans le pied de page, aupres de « Connecte en tant que ». */
function placerQuiSuisJe() {
  const bloc = $(".qui-suis-je");
  const pied = document.querySelector(".pied");
  if (!bloc || !pied) return;
  if (window.matchMedia("(max-width: 620px)").matches) {
    bloc.classList.add("dans-le-pied");
    pied.appendChild(bloc);
  }
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
  const gabarits = {
    weekends: gabaritWeekends, semaine: gabaritSemaines, mois: gabaritMois,
  };
  zone.innerHTML = (gabarits[vue.onglet] || gabaritSemaines)();
  brancherContenu();
  allerA(vue.ancre);
}

/* ------------------------------------------------ position dans l'annee
   Chaque bloc de chaque vue porte data-ancre : le lundi de sa semaine, ou
   pour un mois son premier lundi. En changeant de vue on retrouve le bloc
   qui porte la meme ancre, donc le meme moment du calendrier. */
function hauteurBarre() {
  const b = document.querySelector(".barre");
  return b ? b.getBoundingClientRect().height : 0;
}

function allerA(iso, doux = false) {
  if (!iso) return;
  const zone = $("#contenu");
  if (!zone) return;
  const cible = vue.onglet === "mois" ? moisCleDe(iso) : lundiDe(iso);
  const sel = vue.onglet === "mois" ? `[data-moiscle="${cible}"]` : `[data-ancre="${cible}"]`;
  let el = zone.querySelector(sel);
  if (!el) {
    const tous = [...zone.querySelectorAll("[data-ancre]")];
    el = tous.find((x) => x.dataset.ancre >= lundiDe(iso)) || tous[tous.length - 1];
  }
  if (!el) return;
  const avant = el.previousElementSibling;
  const marge = avant && avant.classList.contains("bandeau-mois") ? avant.offsetHeight + 8 : 0;
  const y = window.scrollY + el.getBoundingClientRect().top - hauteurBarre() - marge - 10;
  window.scrollTo({ top: Math.max(0, y), behavior: doux ? "smooth" : "auto" });
}

/* En defilant on retient le premier bloc encore visible : c'est lui qui
   sera repris a la bascule. Le dernier bloc passe au-dessus du bord ferait
   retarder l'ancre d'une periode a chaque changement de vue. */
let minuteurAncre = null;
function surveillerDefilement() {
  window.addEventListener("scroll", () => {
    clearTimeout(minuteurAncre);
    minuteurAncre = setTimeout(() => {
      const zone = $("#contenu");
      if (!zone || glisse) return;
      const bord = hauteurBarre() + 24;
      for (const el of zone.querySelectorAll("[data-ancre]")) {
        if (el.getBoundingClientRect().bottom > bord) { vue.ancre = el.dataset.ancre; return; }
      }
    }, 120);
  }, { passive: true });
}

function gabaritBarre() {
  const opts = PERSONNES.map((p) => `<option value="${p.id}">${p.nom}</option>`).join("");
  return `<header class="barre"><div class="barre-in">
    <div class="marque">
      <b>Week-ends Riethmuller</b>
      <span>Année scolaire 2026-2027 · ${CAL.meta.nbWeekends} week-ends · zone A &amp; Genève</span>
    </div>
    <div class="onglets" role="tablist">
      <button role="tab" id="onglet-weekends" aria-selected="${vue.onglet === "weekends"}">Week-end</button>
      <button role="tab" id="onglet-semaine" aria-selected="${vue.onglet === "semaine"}">Semaine</button>
      <button role="tab" id="onglet-mois" aria-selected="${vue.onglet === "mois"}">Mois</button>
    </div>
    <div class="groupe-nav">
      <button class="bouton-icone" id="btn-prec" title="Période précédente" aria-label="Période précédente">←</button>
      <button class="bouton-icone" id="btn-suiv" title="Période suivante" aria-label="Période suivante">→</button>
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
      <span><i style="background:var(--reserve);border:1px solid var(--reserve-line);border-left:4px solid var(--reserve-vif)"></i>★ Week-end réservé</span>
    </div>
    <p>Colonnes jeudi, vendredi et lundi ouvertes uniquement les jours fériés en France ou à Genève,
    les jours sans classe et les ponts posés. Les activités scoutes de Thomas portent un cadenas :
    ouvrez-les pour les modifier si le programme change.</p>
    <p class="compte">Connecté en tant que <b>${echapper(session?.user?.email || "—")}</b>
      · <button id="btn-deconnexion" class="lien">Se déconnecter</button></p>
  </footer>`;
}

/* ------------------------------------------------------- morceaux partages */

/* Les etiquettes de la journee : ferie France, ferie Geneve, pont, conge. */
function marquesDuJour(st) {
  const m = [];
  if (st.fr && st.ge) m.push(`<span class="marq ferie">FR+GE ${echapper(st.fr)}</span>`);
  else if (st.ge) m.push(`<span class="marq ferie">GE ${echapper(st.ge)}</span>`);
  else if (st.fr) m.push(`<span class="marq ferie">FR ${echapper(st.fr)}</span>`);
  if (st.sc) m.push(`<span class="marq ferie">École ${echapper(st.sc)}</span>`);
  if (st.pont) m.push(`<span class="marq conge">Pont ${echapper(st.pont)}</span>`);
  if (st.conge) m.push(`<span class="marq conge">Congé Gaël</span>`);
  return m.join("");
}

/* Trois pastilles : qui ne travaille pas. Rien le week-end, ou tout le monde
   est libre de toute facon, ni les jours ordinaires ou tout le monde travaille. */
function pastillesLibres(st) {
  if (st.we) return "";
  if (!(st.gael || st.ingrid || st.thomas)) return "";
  const noms = { gael: "Gaël", ingrid: "Ingrid", thomas: "Thomas" };
  const libres = ["gael", "ingrid", "thomas"].filter((p) => st[p]).map((p) => noms[p]);
  const p = (id, lettre) =>
    `<i class="${id}${st[id] ? " on" : ""}" aria-hidden="true">${lettre}</i>`;
  return `<span class="off" title="Libre : ${libres.join(", ")}">
    ${p("gael", "G")}${p("ingrid", "I")}${p("thomas", "T")}
    <span class="lecture-seule">Libre : ${libres.join(", ")}</span>
  </span>`;
}

/* Bouton discret pour poser ou retirer un conge. Inutile un jour ou Gael
   ne travaille pas de toute facon. */
function boutonConge(iso, st) {
  if (st.we || st.ge || st.pont) return "";
  const pose = st.conge;
  return `<button class="marq conge bouton-conge${pose ? " pose" : ""}"
    data-conge="${iso}" aria-pressed="${pose}"
    title="${pose ? "Retirer le congé" : "Poser un congé"}"
    aria-label="${pose ? "Retirer le congé de Gaël" : "Poser un congé pour Gaël"}">C</button>`;
}

/* Un jour complet, en colonne (vue semaine) ou en bande large (vue week-end). */
function celluleJourComplet(iso, opts = {}) {
  const st = statutJour(iso);
  const d = dateDe(iso);
  const sam = st.we ? decaler(iso, jourSemaine(iso) === 5 ? 0 : -1) : null;
  const reserve = sam ? estReserve(sam) : false;

  const liste = actesDe(iso);
  const classes = ["jour",
    st.we ? "we" : "", st.vac ? "vacj" : "", reserve ? "res" : "",
    iso === isoDe(new Date()) ? "aujourdhui" : "",
    liste.length ? "plein" : "", opts.bande ? "bande" : ""].filter(Boolean).join(" ");

  const actes = liste.map((a, i) => vignetteActivite(a, iso, i, liste.length)).join("");
  const marques = marquesDuJour(st);
  const coller = pressePapier
    ? `<button class="coller" data-coller="${iso}">Coller « ${echapper(tronquer(pressePapier.texte, 22))} »</button>`
    : "";

  return `<div class="${classes}" data-jour="${iso}" data-depot="${iso}">
    <div class="jour-tete">
      <b>${JOURS_COURTS[jourSemaine(iso)]}</b><span class="chiffre">${d.getDate()}</span>
      ${pastillesLibres(st)}${boutonConge(iso, st)}
    </div>
    ${marques ? `<div class="marques">${marques}</div>` : ""}
    <div class="acts">${actes}</div>
    <div class="jour-pied">
      <button class="ajouter" data-ajouter="${iso}">+ Ajouter</button>${coller}
    </div>
  </div>`;
}

/* Vue week-end : un jour de semaine ordinaire se reduit a un filet. Ce qui y
   a ete pose depuis la vue semaine reste visible en miniature, sinon il
   disparaitrait completement de cette vue. */
function ligneFilet(iso) {
  const st = statutJour(iso);
  const d = dateDe(iso);
  const petits = actesDe(iso).map((a) =>
    `<span class="mini ${a.qui}" title="${echapper(NOM[a.qui] + " — " + a.texte)}"
       >${echapper(tronquer(a.texte, 34))}</span>`).join("");
  return `<div class="jour-filet" data-jour="${iso}">
    <b>${JOURS_COURTS[jourSemaine(iso)]}</b><span class="chiffre">${d.getDate()}</span>
    ${pastillesLibres(st)}
    ${petits ? `<span class="petits">${petits}</span>` : ""}
  </div>`;
}

function bandeauMoisIso(iso) {
  const cle = moisCleDe(iso);
  const reserves = CAL.weekends.filter((w) => moisCleDe(w.sam) === cle && estReserve(w.sam));
  const info = reserves.length
    ? `<span class="reserve-mois">★ Réservé : <b>${reserves.map((w) => jjmm(w.sam)).join(", ")}</b></span>`
    : `<span class="reserve-mois manquant">Aucun week-end réservé ce mois-ci</span>`;
  const titre = moisLisible(iso);
  return `<div class="bandeau-mois"><h2>${titre.charAt(0).toUpperCase() + titre.slice(1)}</h2>${info}</div>`;
}

/* Titre d'un bloc de semaine : « S37 · 7 – 13 septembre ». */
function enteteSemaine(lundi, jours) {
  const a = dateDe(jours[0]), b = dateDe(jours[jours.length - 1]);
  const plage = a.getMonth() === b.getMonth()
    ? `${jourNombre(a)} – ${jourNombre(b)} ${MOIS_NOMS[b.getMonth()]}`
    : `${jourNombre(a)} ${MOIS_NOMS[a.getMonth()]} – ${jourNombre(b)} ${MOIS_NOMS[b.getMonth()]}`;
  return `<span class="sem-num" title="Semaine ${numeroSemaine(lundi)}">S${numeroSemaine(lundi)}</span>
    <span class="we-dates">${plage}</span>`;
}

/* ----------------------------------------------------------- vue « semaine » */
function semainesVisibles() {
  return CAL.semaines.filter((lundi) => {
    if (!vue.recherche) return true;
    const q = vue.recherche.toLowerCase();
    return joursDeLaSemaine(lundi).some((iso) => {
      const info = infoJour(iso);
      if (info && ((info.vac || "").toLowerCase().includes(q)
                || (info.ferie || "").toLowerCase().includes(q))) return true;
      if (moisLisible(iso).toLowerCase().includes(q)) return true;
      return actesDe(iso).some((a) =>
        a.texte.toLowerCase().includes(q) || NOM[a.qui].toLowerCase().includes(q));
    });
  });
}

function gabaritSemaines() {
  const visibles = semainesVisibles();
  if (!visibles.length) {
    return `<p class="vide">Aucune semaine ne correspond à « ${echapper(vue.recherche)} ».</p>`;
  }
  let html = "", moisCourant = null;
  for (const lundi of visibles) {
    if (moisCleDe(lundi) !== moisCourant) {
      moisCourant = moisCleDe(lundi);
      html += bandeauMoisIso(lundi);
    }
    html += carteSemaine(lundi);
  }
  return html;
}

function carteSemaine(lundi) {
  const jours = joursDeLaSemaine(lundi).filter(dansLAnnee);
  const vac = jours.map((j) => (infoJour(j) || {}).vac).find(Boolean) || "";
  const sam = jours.find((j) => jourSemaine(j) === 5);
  const reserve = sam ? estReserve(sam) : false;
  const scout = jours.some((j) => actesDe(j).some((a) => a.origine === "scout"));

  const puces = [];
  if (reserve) puces.push(`<span class="puce reserve">★ Réservé</span>`);
  if (vac) puces.push(`<span class="puce vac">${echapper(vac)}</span>`);
  if (scout) puces.push(`<span class="puce scout">Thomas au scout</span>`);

  const classes = ["we", "semaine", vac ? "vacances" : "", reserve ? "reserve-we" : ""]
    .filter(Boolean).join(" ");

  return `<article class="${classes}" data-ancre="${lundi}" id="sem-${lundi}">
    <div class="we-tete">
      ${enteteSemaine(lundi, jours)}
      ${puces.join("")}
      ${sam ? `<span class="we-actions">
        <button class="bouton-reserver" data-reserver="${sam}"
          aria-pressed="${reserve}">${reserve ? "Libérer" : "★ Réserver"}</button>
      </span>` : ""}
    </div>
    <div class="grille7">${jours.map((j) => celluleJourComplet(j)).join("")}</div>
  </article>`;
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
      html += bandeauMoisIso(we.sam);
    }
    html += carteWeekend(we);
  }
  return html;
}

function carteWeekend(we) {
  const reserve = estReserve(we.sam);
  const libre = estLibre(we);
  const ouverts = joursOuverts(we);
  const lundi = lundiDe(we.sam);
  const classes = ["we", we.vac ? "vacances" : "", libre ? "libre" : "", reserve ? "reserve" : ""]
    .filter(Boolean).join(" ");

  const puces = [];
  if (reserve) puces.push(`<span class="puce reserve">★ Réservé</span>`);
  if (we.vac) puces.push(`<span class="puce vac">${echapper(we.vac)}</span>`);
  if (we.long) puces.push(`<span class="puce long">${ouverts.length} jours</span>`);
  if (scoutDansWeekend(we)) puces.push(`<span class="puce scout">Thomas au scout</span>`);
  if (libre && !reserve) puces.push(`<span class="puce libre">Libre</span>`);

  /* Les cinq jours empiles : bande large pour le week-end et les feries
     attenants, filet en pointilles pour les jours de semaine ordinaires. */
  const rangs = we.jours.map((j) =>
    j.ouvert ? celluleJourComplet(j.iso, { bande: true }) : ligneFilet(j.iso)).join("");
  const note = we.note ? `<p class="we-note">${echapper(we.note)}</p>` : "";

  return `<article class="${classes}" data-sam="${we.sam}" data-ancre="${lundi}" id="we-${we.sam}">
    <div class="we-tete">
      ${enteteSemaine(lundi, ouverts.map((j) => j.iso))}
      ${puces.join("")}
      <span class="we-actions">
        <button class="bouton-reserver" data-reserver="${we.sam}"
          aria-pressed="${reserve}">${reserve ? "Libérer" : "★ Réserver"}</button>
      </span>
    </div>
    ${note}
    <div class="pile-we">${rangs}</div>
  </article>`;
}

function vignetteActivite(a, iso, index, total) {
  const ordonnable = total > 1;
  const classes = ["act", a.qui, a.statut === "a_confirmer" ? "a_confirmer" : "",
                   ordonnable ? "ordonnable" : ""].filter(Boolean).join(" ");
  const verrou = a.origine === "scout" ? `<span class="verrou" title="Programme scout">🔒</span>` : "";
  const suffixe = a.statut === "a_confirmer" ? " · à confirmer" : "";
  const ref = `${iso}|${a.id}`;
  return `<div class="${classes}" data-modifier="${ref}" data-glisser="${ref}"
       tabindex="0" role="button"
       title="${echapper(NOM[a.qui] + " — " + a.texte + suffixe)}"
       aria-label="${echapper(NOM[a.qui] + " : " + a.texte)}">
    <span class="qui">${NOM[a.qui] ? NOM[a.qui][0] : "?"}</span>
    <span class="texte">${echapper(a.texte)}${suffixe}</span>${verrou}
    <span class="act-actions">
      ${ordonnable ? `
      <button data-monter="${ref}" title="Monter"
        aria-label="Monter dans la journée" ${index === 0 ? "disabled" : ""}>↑</button>
      <button data-descendre="${ref}" title="Descendre"
        aria-label="Descendre dans la journée" ${index === total - 1 ? "disabled" : ""}>↓</button>` : ""}
      <button data-copier="${ref}" title="Copier"
        aria-label="Copier l'activité">⧉</button>
      <button data-supprimer="${ref}" title="Supprimer"
        aria-label="Supprimer l'activité">×</button>
    </span>
  </div>`;
}

/* -------------------------------------------------------------- vue « mois »
   Informative seulement : ni ajout, ni glisser-deposer. Cliquer un jour
   ouvre sa semaine, ce qui evite de chercher ou l'on etait. */
function moisDeLAnnee() {
  const vus = [];
  for (const lundi of CAL.semaines) {
    for (const iso of joursDeLaSemaine(lundi)) {
      const cle = moisCleDe(iso);
      if (dansLAnnee(iso) && !vus.includes(cle)) vus.push(cle);
    }
  }
  return vus.sort();
}

function gabaritMois() {
  return moisDeLAnnee().map(grilleDuMois).join("");
}

function grilleDuMois(moisCle) {
  const [an, mo] = moisCle.split("-").map(Number);
  const premier = new Date(an, mo - 1, 1);
  const debut = isoDe(new Date(an, mo - 1, 1 - ((premier.getDay() + 6) % 7)));
  const fin = new Date(an, mo, 0);
  const dernier = lundiDe(isoDe(fin));

  let lignes = "";
  for (let l = debut; l <= dernier; l = decaler(l, 7)) {
    lignes += `<div class="gouttiere" title="Semaine ${numeroSemaine(l)}">S${numeroSemaine(l)}</div>`;
    lignes += joursDeLaSemaine(l).map((iso) => caseMois(iso, mo)).join("");
  }

  /* Premier lundi du mois : l'ancre, pour que le retour en vue semaine
     ouvre une semaine qui appartient bien a ce mois-ci. */
  const ancre = premier.getDay() === 1 ? isoDe(premier) : decaler(lundiDe(isoDe(premier)), 7);

  return `<section class="bloc-mois" data-moiscle="${moisCle}" data-ancre="${ancre}">
    ${bandeauMoisIso(isoDe(premier))}
    <div class="grille-mois">
      <div class="entete"></div>
      ${JOURS_LONGS.map((j) => `<div class="entete">${j.slice(0, 3)}</div>`).join("")}
      ${lignes}
    </div>
  </section>`;
}

function caseMois(iso, moisRef) {
  const d = dateDe(iso);
  const info = CAL.jours[iso];
  const hors = d.getMonth() !== moisRef - 1 || !info;
  const auj = iso === isoDe(new Date());
  const st = info ? statutJour(iso) : null;
  const we = info && info.we ? CAL.weekends[info.we - 1] : null;
  const reserve = we ? estReserve(we.sam) : false;

  const classes = ["case-mois",
    hors ? "hors" : (st && st.we ? "" : "semaine"),
    !hors && info && info.vac ? "vacances" : "",
    reserve ? "reserve" : "",
    auj ? "auj" : ""].filter(Boolean).join(" ");

  if (hors) {
    return `<div class="${classes}"><span class="num">${d.getDate()}</span></div>`;
  }

  /* Le prefixe FR / GE passe en premier : c'est lui qui doit survivre a la
     troncature, puisque c'est lui qui dit qui est concerne. */
  const fer = (st.fr && st.ge) ? `FR+GE ${st.fr}`
            : st.ge ? `GE ${st.ge}`
            : st.fr ? `FR ${st.fr}`
            : st.sc ? `École ${st.sc}`
            : st.pont ? `Pont ${st.pont}` : "";
  const ferie = fer ? `<span class="marque-ferie">${echapper(fer)}</span>` : "";
  const etoile = reserve ? `<span class="etoile" title="Week-end réservé">★</span>` : "";
  const pointConge = st.conge
    ? `<span class="pt-conge" title="Congé de Gaël"></span>` : "";
  const numero = auj
    ? `<span class="num"><span class="aujourdhui">${d.getDate()}</span>${etoile}${pointConge}</span>`
    : `<span class="num">${d.getDate()}${etoile}${pointConge}</span>`;

  const actes = actesDe(iso)
    .filter((a) => correspond(a.texte) || correspond(NOM[a.qui]))
    .map((a) => `<span class="mini ${a.qui}${a.statut === "a_confirmer" ? " a_confirmer" : ""}"
        title="${echapper(NOM[a.qui] + " — " + a.texte)}">${echapper(a.texte)}</span>`).join("");

  return `<div class="${classes}" data-va="${iso}" role="button" tabindex="0"
    title="Voir la semaine du ${jjmm(iso)}">${numero}${ferie}${actes}</div>`;
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

function basculerConge(iso, qui = "gael") {
  const pose = estConge(iso, qui);
  appliquer(() => {
    ETAT.conges = pose
      ? ETAT.conges.filter((c) => !(c.jour === iso && c.qui === qui))
      : [...ETAT.conges, { jour: iso, qui }]
          .sort((a, b) => (a.jour + a.qui).localeCompare(b.jour + b.qui));
  });
  annoncer(pose ? `Congé retiré le ${jjmm(iso)}.` : `Congé posé le ${jjmm(iso)}.`);
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

/* Rejoue ce qui a ete mis en attente pendant le geste. On desarme les deux
   drapeaux avant d'agir : un rechargement redessine de toute facon, mais
   laisser l'autre arme fausserait le geste suivant. */
function viderDifferes() {
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


/* ====================================================================== */
/*  Glisser-deposer au pointeur                                           */
/*                                                                        */
/*  Le glisser-deposer HTML5 est ecarte : Safari le prend en defaut et    */
/*  fige la page. On suit donc le pointeur nous-memes, ce qui donne un    */
/*  comportement identique dans tous les navigateurs.                     */
/*  Souris et stylet : le geste demarre des que le pointeur bouge.        */
/*  Au doigt : appui long, pour ne pas confondre avec un defilement.      */
/* ====================================================================== */

/* Horodatage plutot qu'un drapeau : apres un glisser, la page est redessinee et
   le clic qui suit vise un element disparu. Un drapeau ne serait jamais consomme
   et avalerait le clic suivant ; un horodatage expire tout seul. */
let finDuGeste = 0;

const APPUI_LONG = 420;        // millisecondes avant qu'un appui devienne un glisser
const TOLERANCE_DOIGT = 12;    // au-dela, c'est un defilement, pas un appui

const TIRAGE = {
  element: null, iso: null, id: null, pointerId: null, tactile: false,
  x0: 0, y0: 0, x: 0, y: 0, decalageX: 0, decalageY: 0,
  fantome: null, cible: null, avant: false, jour: null, actif: false,
  attente: null, boucle: null,
};

function preparerTirage(e, el) {
  if (e.pointerType === "mouse" && e.button !== 0) return;
  if (e.target.closest(".act-actions")) return;

  const [iso, id] = el.dataset.glisser.split("|");
  const tactile = e.pointerType === "touch";
  Object.assign(TIRAGE, {
    element: el, iso, id, pointerId: e.pointerId, tactile,
    x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY,
    cible: null, avant: false, jour: null, actif: false,
  });

  window.addEventListener("pointermove", surDeplacement);
  window.addEventListener("pointerup", surRelachement);
  window.addEventListener("pointercancel", abandonnerTirage);
  window.addEventListener("keydown", echapTirage);

  /* Au doigt, seul un appui immobile declenche le glisser : sinon on laisse la
     page defiler normalement. Le listener touchmove n'est pas passif, faute de
     quoi il serait impossible d'arreter ce defilement une fois le geste engage. */
  if (tactile) {
    window.addEventListener("touchmove", bloquerDefilement, { passive: false });
    TIRAGE.attente = setTimeout(() => {
      TIRAGE.attente = null;
      demarrerTirage();
      placerFantome(TIRAGE.x, TIRAGE.y);
      viserDestination(TIRAGE.x, TIRAGE.y);
    }, APPUI_LONG);
  }
}

function bloquerDefilement(e) {
  if (TIRAGE.actif) e.preventDefault();
}

function demarrerTirage() {
  TIRAGE.actif = true;
  glisse = { iso: TIRAGE.iso, id: TIRAGE.id };      // gele les rendus pendant le geste

  const cadre = TIRAGE.element.getBoundingClientRect();
  TIRAGE.decalageX = TIRAGE.x0 - cadre.left;
  TIRAGE.decalageY = TIRAGE.y0 - cadre.top;

  const fantome = TIRAGE.element.cloneNode(true);
  fantome.classList.add("fantome");
  if (TIRAGE.tactile) fantome.classList.add("fantome-doigt");
  fantome.classList.remove("insert-avant", "insert-apres");
  fantome.style.width = cadre.width + "px";
  document.body.appendChild(fantome);
  TIRAGE.fantome = fantome;

  TIRAGE.element.classList.add("en-glissement");
  document.body.classList.add("glisser-en-cours");

  clearTimeout(chronoGlisser);
  chronoGlisser = setTimeout(abandonnerTirage, 30000);

  cancelAnimationFrame(TIRAGE.boucle);
  TIRAGE.boucle = requestAnimationFrame(boucleDefilement);
}

function placerFantome(x, y) {
  /* Au doigt, la vignette est remontee : sinon la main cache ce qu'on deplace. */
  const remontee = TIRAGE.tactile ? 28 : 0;
  TIRAGE.fantome.style.transform =
    `translate3d(${Math.round(x - TIRAGE.decalageX)}px, `
    + `${Math.round(y - TIRAGE.decalageY - remontee)}px, 0)`;
}

/* On ne touche au DOM que si la destination a reellement change : sans cette
   precaution, chaque mouvement de souris redessinerait la page. */
function viserDestination(x, y) {
  const sous = document.elementFromPoint(x, y);
  const vignette = sous ? sous.closest("[data-glisser]") : null;
  let cible = null, avant = false, jour = null;

  if (vignette && vignette !== TIRAGE.element) {
    const cadre = vignette.getBoundingClientRect();
    cible = vignette;
    avant = y < cadre.top + cadre.height / 2;
  } else if (!vignette) {
    jour = sous ? sous.closest("[data-depot]") : null;
  }

  if (cible === TIRAGE.cible && avant === TIRAGE.avant && jour === TIRAGE.jour) return;

  if (TIRAGE.cible) TIRAGE.cible.classList.remove("insert-avant", "insert-apres");
  if (TIRAGE.jour) TIRAGE.jour.classList.remove("survol");

  if (cible) {
    cible.classList.add(avant ? "insert-avant" : "insert-apres");
    cible.classList.remove(avant ? "insert-apres" : "insert-avant");
  }
  if (jour) jour.classList.add("survol");

  TIRAGE.cible = cible;
  TIRAGE.avant = avant;
  TIRAGE.jour = jour;
}

/* Fait defiler la page tant que le pointeur reste pres d'un bord. Une boucle
   continue plutot qu'un appel par mouvement : au doigt, on s'immobilise souvent
   en bas de l'ecran en attendant que la page monte. */
function boucleDefilement() {
  if (!TIRAGE.actif) return;
  const marge = TIRAGE.tactile ? 110 : 80;
  const vitesse = 14;
  const y = TIRAGE.y;
  let pas = 0;

  if (y < marge) pas = -vitesse * Math.min(1, (marge - y) / marge + 0.3);
  else if (y > window.innerHeight - marge) {
    pas = vitesse * Math.min(1, (y - (window.innerHeight - marge)) / marge + 0.3);
  }

  if (pas) {
    const avant = window.scrollY;
    window.scrollBy(0, pas);
    /* La page a bouge sous le pointeur : la destination visee change aussi. */
    if (window.scrollY !== avant) viserDestination(TIRAGE.x, TIRAGE.y);
  }
  TIRAGE.boucle = requestAnimationFrame(boucleDefilement);
}

function surDeplacement(e) {
  if (e.pointerId !== TIRAGE.pointerId) return;
  TIRAGE.x = e.clientX;
  TIRAGE.y = e.clientY;

  if (!TIRAGE.actif) {
    const distance = Math.hypot(e.clientX - TIRAGE.x0, e.clientY - TIRAGE.y0);
    if (TIRAGE.tactile) {
      /* Le doigt a bouge avant la fin de l'appui long : c'est un defilement. */
      if (distance > TOLERANCE_DOIGT) abandonnerTirage();
      return;
    }
    if (distance < 6) return;                       // simple clic, pas un glisser
    demarrerTirage();
  }

  e.preventDefault();
  placerFantome(e.clientX, e.clientY);
  viserDestination(e.clientX, e.clientY);
}

function rangerTirage() {
  window.removeEventListener("pointermove", surDeplacement);
  window.removeEventListener("pointerup", surRelachement);
  window.removeEventListener("pointercancel", abandonnerTirage);
  window.removeEventListener("keydown", echapTirage);
  window.removeEventListener("touchmove", bloquerDefilement, { passive: false });
  clearTimeout(chronoGlisser);
  clearTimeout(TIRAGE.attente);
  cancelAnimationFrame(TIRAGE.boucle);
  TIRAGE.attente = null;
  TIRAGE.boucle = null;

  if (TIRAGE.fantome) TIRAGE.fantome.remove();
  document.body.classList.remove("glisser-en-cours");
  nettoyerIndicateurs();

  TIRAGE.element = null;
  TIRAGE.fantome = null;
  TIRAGE.actif = false;
  glisse = null;
}

function surRelachement(e) {
  if (e.pointerId !== TIRAGE.pointerId) return;

  const actif = TIRAGE.actif;
  const depart = { iso: TIRAGE.iso, id: TIRAGE.id };
  const cible = TIRAGE.cible;
  const jour = TIRAGE.jour;
  const avant = TIRAGE.avant;
  const dupliquer = e.altKey || e.ctrlKey || e.metaKey;

  rangerTirage();

  if (actif) {
    finDuGeste = Date.now();                        // le clic qui suit n'ouvre pas la fiche
    if (cible) {
      const [isoCible, idCible] = cible.dataset.glisser.split("|");
      if (idCible !== depart.id) {
        deplacerActivite(depart.iso, depart.id, isoCible, dupliquer, idCible, avant);
      }
    } else if (jour) {
      deplacerActivite(depart.iso, depart.id, jour.dataset.depot, dupliquer);
    }
  }

  viderDifferes();
}

function abandonnerTirage() {
  rangerTirage();
  viderDifferes();
}

function echapTirage(e) {
  if (e.key === "Escape") abandonnerTirage();
}

/* ------------------------------------------------------------- branchements */
function brancherBarre() {
  const changerVue = (nom) => {
    vue.onglet = nom;
    try { localStorage.setItem("planning-vue", nom); } catch (e) { /* stockage indisponible */ }
    rendre();
  };
  $("#onglet-weekends").addEventListener("click", () => changerVue("weekends"));
  $("#onglet-semaine").addEventListener("click", () => changerVue("semaine"));
  $("#onglet-mois").addEventListener("click", () => changerVue("mois"));

  $("#btn-prec").addEventListener("click", () => sauterPeriode(-1));
  $("#btn-suiv").addEventListener("click", () => sauterPeriode(1));

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
      if (Date.now() - finDuGeste < 300) return;
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

  zone.querySelectorAll("[data-conge]").forEach((b) =>
    b.addEventListener("click", (e) => { e.stopPropagation(); basculerConge(b.dataset.conge); }));

  /* Vue mois : lecture seule, mais cliquer un jour ouvre sa semaine. */
  zone.querySelectorAll("[data-va]").forEach((c) => {
    const ouvrir = () => {
      vue.ancre = c.dataset.va;
      vue.onglet = "semaine";
      rendre();
      annoncer(`Semaine du ${jjmm(c.dataset.va)}.`);
    };
    c.addEventListener("click", ouvrir);
    c.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); ouvrir(); }
    });
  });

  /* Le glisser-deposer est gere au pointeur (voir plus bas), il suffit ici
     d'armer chaque vignette. */
  zone.querySelectorAll("[data-glisser]").forEach((el) => {
    el.addEventListener("pointerdown", (e) => preparerTirage(e, el));
  });

  /* La navigation par mois est passee dans la barre (boutons ← →), commune
     aux trois vues : plus rien a brancher ici. */
}

/* Une periode = une semaine, ou un mois en vue mois. */
function sauterPeriode(pas) {
  const base = vue.ancre || premierJourUtile();
  if (vue.onglet === "mois") {
    const d = dateDe(base);
    const cible = new Date(d.getFullYear(), d.getMonth() + pas, 1);
    const lundi = cible.getDay() === 1 ? isoDe(cible) : decaler(lundiDe(isoDe(cible)), 7);
    vue.ancre = lundi;
  } else {
    vue.ancre = decaler(lundiDe(base), 7 * pas);
  }
  allerA(vue.ancre, true);
}

function premierJourUtile() {
  const auj = isoDe(new Date());
  return CAL.semaines.find((l) => decaler(l, 6) >= auj) || CAL.semaines[0];
}

function allerAujourdhui() {
  if (vue.recherche) {
    vue.recherche = "";
    const r = $("#recherche"); if (r) r.value = "";
    rendreContenu();
  }
  vue.ancre = premierJourUtile();
  allerA(vue.ancre, true);
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
  try {
    const memorisee = localStorage.getItem("planning-vue");
    if (["weekends", "semaine", "mois"].includes(memorisee)) vue.onglet = memorisee;
  } catch (e) { /* stockage indisponible */ }

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
  vue.ancre = premierJourUtile();
  rendre();
  brancherRaccourcis();
  surveillerDefilement();
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
