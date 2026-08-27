/* Service worker — met en cache la coquille de l'application.
   Les données (Supabase) passent toujours par le réseau : ce cache sert à
   ouvrir la page instantanément, et à afficher quelque chose hors connexion. */

const CACHE = "riethmuller-v1";
const COQUILLE = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "xlsxgen.js",
  "config.js",
  "calendrier.json",
  "vendor/supabase.js",
  "manifest.webmanifest",
  "icones/icone-192.png",
  "icones/icone-512.png",
  "icones/icone-180.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(COQUILLE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((noms) => Promise.all(noms.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.origin !== self.location.origin) return;   // Supabase, polices : réseau direct

  // Réseau d'abord, cache en secours : on garde la version fraîche quand elle existe.
  e.respondWith(
    fetch(e.request)
      .then((reponse) => {
        const copie = reponse.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copie)).catch(() => {});
        return reponse;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
  );
});
