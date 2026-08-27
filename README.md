# Week-ends Riethmuller

Le planning des week-ends de la famille, année scolaire 2026-2027 : 44 week-ends du
samedi 5 septembre 2026 au dimanche 4 juillet 2027, jours fériés français et genevois,
ponts posés, vacances scolaires de la zone A, et le programme scout de Thomas.

Trois comptes, une base de données partagée, mise à jour en temps réel sur tous les
écrans ouverts. Installable sur l'écran d'accueil des iPhones.

---

## Ce qu'il faut avant de commencer

- Un compte **Supabase** (gratuit) — la base de données et les comptes.
- Un compte **Vercel** (gratuit) — l'hébergement de la page.
- Une dizaine de minutes.

Aucune ligne de code à écrire : il n'y a qu'un fichier à remplir, `config.js`.

---

## Étape 1 — La base de données (Supabase)

**1.1** Sur [supabase.com](https://supabase.com), créer un projet. Choisir la région
**Frankfurt** ou **Paris** : c'est la plus proche, donc la plus rapide. Noter le mot de
passe de la base que Supabase demande — il ne sert pas ici, mais il est irrécupérable.

**1.2** Ouvrir **SQL Editor → New query**, coller tout le contenu de
`supabase/schema.sql`, puis **Run**. Cela crée les deux tables, les règles d'accès et
le temps réel.

**1.3** Nouvelle requête, coller `supabase/seed_scout.sql`, puis **Run**. Les 31 lignes
du programme scout de Thomas sont insérées. Les deux scripts sont relançables sans
risque de doublon.

**1.4** Aller dans **Authentication → Sign In / Providers → Email** et **désactiver
« Allow new users to sign up »**. Personne d'autre ne pourra créer de compte.

**1.5** Toujours dans **Authentication → Users**, cliquer **Add user → Create new user**
trois fois, une par personne. Cocher **Auto Confirm User** pour éviter l'e-mail de
confirmation. Choisir un mot de passe pour chacun — les iPhones le retiendront dans le
trousseau après la première connexion.

**1.6** Dans **Project Settings → Data API**, copier :

- **Project URL** — de la forme `https://xxxxxxxxxxxx.supabase.co`
- la clé **anon public** — une longue chaîne commençant par `ey…`

---

## Étape 2 — Renseigner `config.js`

Ouvrir `config.js` et remplacer les deux valeurs par celles copiées à l'étape 1.6 :

```js
window.CONFIG_SUPABASE = {
  url: "https://xxxxxxxxxxxx.supabase.co",
  cle: "eyJhbGciOi...",
};
```

Cette clé est publique par conception. Elle ne donne accès à rien tant qu'on n'est pas
connecté avec un des trois comptes : c'est la base de données qui refuse, pas la page.
Le dépôt peut donc être public sans souci.

---

## Étape 3 — Mettre en ligne (Vercel)

Le plus simple, sans Git : sur [vercel.com/new](https://vercel.com/new), choisir
l'import d'un dossier et **déposer le dossier du projet**. Vercel détecte un site
statique, il n'y a rien à configurer — ni framework, ni commande de build, ni variable
d'environnement.

Avec Git, c'est identique : pousser le dossier sur GitHub, puis **Add New → Project**
et sélectionner le dépôt. Chaque `git push` redéploiera ensuite tout seul.

Vercel donne une adresse en `.vercel.app`. Pour un nom plus simple à retenir, un
domaine peut être ajouté dans **Settings → Domains**.

---

## Étape 4 — Installer sur les iPhones

Sur chaque téléphone, ouvrir l'adresse **dans Safari** (pas Chrome : iOS réserve
l'installation à Safari), puis bouton **Partager → Sur l'écran d'accueil**.

L'icône apparaît comme celle d'une application, la page s'ouvre en plein écran sans
barre d'adresse, et la connexion reste active — plus besoin de saisir le mot de passe à
chaque fois.

Sur ordinateur, un simple favori suffit.

---

## Au quotidien

**Saisir.** Cliquer « + Ajouter » sur un jour, choisir la personne, écrire. Le menu
« Je suis » en haut mémorise qui vous êtes sur cet appareil et présélectionne votre
couleur.

**Corriger.** Survoler une activité fait apparaître ⧉ pour copier et × pour supprimer.
La glisser sur un autre jour la déplace ; en maintenant **Alt** pendant le dépôt, elle
est dupliquée.

**Revenir en arrière.** Les boutons ↶ ↷ en haut, ou Ctrl+Z / Ctrl+Maj+Z. L'historique
vaut pour l'onglet ouvert.

**Réserver un week-end.** Le bouton ★ dans l'en-tête d'un week-end le marque comme
gardé libre. Chaque mois affiche s'il en a un, ou signale qu'il n'en a pas.

**Sortir en Excel.** Le bouton « Export Excel » reconstruit le classeur complet, mise en
forme comprise, à partir du contenu du moment.

Tout ce que l'un enregistre apparaît sur les écrans des autres en une seconde environ.
Deux personnes qui modifient deux activités différentes ne se gênent pas ; sur une même
activité, la dernière modification l'emporte.

---

## À savoir

**Le sommeil des projets gratuits.** Supabase met en pause un projet resté une semaine
sans activité. Les données sont conservées, mais il faut le réveiller depuis le tableau
de bord. Un usage familial hebdomadaire suffit à l'éviter ; après de longues vacances,
prévoir ce réveil.

**Hors connexion.** La page s'ouvre et s'affiche sans réseau grâce au cache, mais les
modifications ont besoin de la connexion pour partir. Un bandeau le signale.

**Les activités scoutes** portent un cadenas : c'est un repère visuel, pas un verrou.
Elles restent modifiables si le programme change.

---

## Structure du projet

```
index.html               la page
app.js                   l'application : vues, saisie, historique, Supabase
styles.css               l'apparence, thèmes clair et sombre
xlsxgen.js               génération du fichier Excel dans le navigateur
calendrier.json          le squelette : 44 week-ends, fériés, vacances, programme scout
config.js                l'adresse et la clé Supabase          ← seul fichier à remplir
vendor/supabase.js       le client Supabase, embarqué (aucun CDN à l'exécution)
manifest.webmanifest     l'installation sur l'écran d'accueil
sw.js                    le cache hors connexion
icones/                  les icônes de l'application
supabase/schema.sql      les tables, les règles d'accès, le temps réel
supabase/seed_scout.sql  le programme scout de Thomas
vercel.json              en-têtes HTTP
test_local.py            vérification locale, non déployée
test_stub_supabase.js    doublure de Supabase pour ces tests, non déployée
```

`calendrier.json` est produit à partir d'un script Python qui fait référence pour les
dates (fériés France et Genève, vacances zone A de l'académie de Grenoble, ponts posés,
programme scout). Pour l'année suivante, ce fichier est à régénérer — le reste ne bouge
pas.
