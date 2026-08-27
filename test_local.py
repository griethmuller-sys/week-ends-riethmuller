#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Vérifie l'application Supabase en local, avec une doublure du client."""

import http.server
import socketserver
import sys
import threading
from playwright.sync_api import sync_playwright

PORT = 8731
resultats = []
erreurs = []


def verifier(nom, obtenu, attendu):
    resultats.append((obtenu == attendu, f"{nom} : {obtenu} (attendu {attendu})"))


# page de test : meme chose que index.html, avec la doublure a la place du vrai client
page = open("index.html", encoding="utf-8").read()
page = page.replace('<script src="vendor/supabase.js"></script>',
                    '<script src="test_stub_supabase.js"></script>')
page = page.replace('<script src="config.js"></script>',
                    '<script>window.CONFIG_SUPABASE={url:"https://test.supabase.co",cle:"cle-test"};</script>')
open("test_page.html", "w", encoding="utf-8").write(page)


class Silencieux(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


serveur = socketserver.TCPServer(("127.0.0.1", PORT), Silencieux)
threading.Thread(target=serveur.serve_forever, daemon=True).start()

with sync_playwright() as p:
    nav = p.chromium.launch(executable_path="/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
                            args=["--no-sandbox"])
    ctx = nav.new_context(viewport={"width": 1440, "height": 1000})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: erreurs.append("pageerror: %s" % e))
    pg.on("console", lambda m: erreurs.append("console: %s" % m.text)
          if m.type == "error" and "font" not in m.text.lower() else None)

    pg.goto(f"http://127.0.0.1:{PORT}/test_page.html")
    pg.wait_for_timeout(700)

    # 1. ecran de connexion
    verifier("écran de connexion affiché", pg.is_visible("#form-connexion"), True)
    pg.screenshot(path="cap-connexion.png")

    # 2. mauvais mot de passe
    pg.fill("#email", "gael@example.com")
    pg.fill("#mdp", "faux")
    pg.click("#btn-connexion")
    pg.wait_for_timeout(400)
    verifier("message d'erreur sur mauvais mot de passe", pg.is_visible(".erreur"), True)

    # 3. connexion
    pg.fill("#email", "gael@example.com")
    pg.fill("#mdp", "test")
    pg.click("#btn-connexion")
    pg.wait_for_timeout(1200)
    verifier("planning affiché après connexion", pg.is_visible(".we"), True)
    verifier("programme scout chargé depuis la base",
             pg.evaluate("Object.keys(ETAT.activites).length"), 27)

    # 4. ajout -> doit arriver dans la base
    pg.click('[data-ajouter="2026-09-05"]')
    pg.wait_for_timeout(250)
    pg.click('[data-qui="gael"]')
    pg.fill("#texte-act", "Squash 10h — Ferney")
    pg.click("#valider")
    pg.wait_for_timeout(900)
    verifier("activité écrite en base",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.jour === '2026-09-05').length"), 1)
    verifier("identifiant au format uuid",
             pg.evaluate("/^[0-9a-f-]{36}$/.test(ETAT.activites['2026-09-05'][0].id)"), True)

    # 5. modification -> mise a jour en base, pas de doublon
    pg.click('[data-modifier^="2026-09-05|"]')
    pg.wait_for_timeout(250)
    pg.fill("#texte-act", "Squash 11h — Ferney")
    pg.click("#valider")
    pg.wait_for_timeout(900)
    verifier("pas de doublon après modification",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.jour === '2026-09-05').length"), 1)
    verifier("texte mis à jour en base",
             pg.evaluate("__MAGASIN__.activites.find(a => a.jour === '2026-09-05').texte"),
             "Squash 11h — Ferney")

    # 6. glisser-deposer -> le jour change en base
    pg.drag_and_drop('[data-glisser^="2026-09-05|"]', '[data-depot="2026-09-06"]')
    pg.wait_for_timeout(900)
    verifier("déplacement : jour mis à jour en base",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.jour === '2026-09-06' && a.qui === 'gael').length"), 1)
    verifier("déplacement : ancien jour vidé",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.jour === '2026-09-05').length"), 0)

    # 7. reservation d'un week-end
    pg.click('[data-reserver="2026-09-26"]')
    pg.wait_for_timeout(900)
    verifier("week-end réservé écrit en base",
             pg.evaluate("__MAGASIN__.reserves.map(r => r.samedi).includes('2026-09-26')"), True)
    pg.click('[data-reserver="2026-09-26"]')
    pg.wait_for_timeout(900)
    verifier("libération du week-end en base", pg.evaluate("__MAGASIN__.reserves.length"), 0)

    # 8. suppression
    pg.hover('[data-modifier^="2026-09-06|"]')
    pg.click('[data-supprimer^="2026-09-06|"]')
    pg.wait_for_timeout(900)
    verifier("suppression répercutée en base",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.qui === 'gael').length"), 0)

    # 9. annuler -> reecrit en base
    pg.click("#btn-annuler")
    pg.wait_for_timeout(900)
    verifier("annulation réécrite en base",
             pg.evaluate("__MAGASIN__.activites.filter(a => a.qui === 'gael').length"), 1)

    # 10. export Excel
    with pg.expect_download() as tel:
        pg.click("#btn-export")
    fichier = tel.value
    verifier("export Excel téléchargé", fichier.suggested_filename.endswith(".xlsx"), True)

    pg.screenshot(path="cap-app-supabase.png")

    # 11. deconnexion
    pg.click("#btn-deconnexion")
    pg.wait_for_timeout(600)
    verifier("retour à l'écran de connexion", pg.is_visible("#form-connexion"), True)

    ctx.close()
    nav.close()

serveur.shutdown()

for ok, ligne in resultats:
    print(("  OK  " if ok else "ECHEC ") + ligne)
if erreurs:
    print("\n--- messages ---")
    for e in dict.fromkeys(erreurs):
        print(" ", e)
sys.exit(0 if all(ok for ok, _ in resultats) else 1)
