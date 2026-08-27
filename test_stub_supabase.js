/* Doublure de test du client Supabase — sert uniquement aux vérifications locales.
   Ce fichier n'est PAS déployé : il n'est chargé que par test_local.py. */

(function () {
  const magasin = { activites: [], reserves: [] };
  let connecte = null;
  const abonnes = [];

  fetch("calendrier.json").then((r) => r.json()).then((cal) => {
    let n = 0;
    for (const [jour, lignes] of Object.entries(cal.scout)) {
      for (const texte of lignes) {
        magasin.activites.push({
          id: "seed-" + (n++), jour, qui: "thomas", texte, statut: "confirme", origine: "scout",
        });
      }
    }
  });

  const ok = (data) => Promise.resolve({ data, error: null });

  function table(nom) {
    return {
      select() { return ok(magasin[nom === "activites" ? "activites" : "reserves"].map((x) => ({ ...x }))); },
      insert(lignes) {
        const liste = Array.isArray(lignes) ? lignes : [lignes];
        if (nom === "activites") magasin.activites.push(...liste.map((l) => ({ ...l })));
        else magasin.reserves.push(...liste.map((l) => ({ ...l })));
        return ok(liste);
      },
      upsert(lignes) {
        for (const l of lignes) {
          const i = magasin.activites.findIndex((a) => a.id === l.id);
          if (i >= 0) magasin.activites[i] = { ...l };
          else magasin.activites.push({ ...l });
        }
        return ok(lignes);
      },
      delete() {
        return {
          in(colonne, valeurs) {
            const cle = nom === "activites" ? "activites" : "reserves";
            magasin[cle] = magasin[cle].filter((x) => !valeurs.includes(x[colonne]));
            return ok([]);
          },
        };
      },
    };
  }

  const client = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: connecte } }),
      onAuthStateChange(rappel) { abonnes.push(rappel); return { data: { subscription: {} } }; },
      signInWithPassword({ email, password }) {
        if (password !== "test") return Promise.resolve({ error: { message: "Identifiants invalides" } });
        connecte = { user: { email, id: "utilisateur-test" } };
        abonnes.forEach((f) => f("SIGNED_IN", connecte));
        return Promise.resolve({ data: { session: connecte }, error: null });
      },
      signOut() {
        connecte = null;
        abonnes.forEach((f) => f("SIGNED_OUT", null));
        return Promise.resolve({ error: null });
      },
    },
    from: table,
    channel() {
      const c = { on() { return c; }, subscribe() { return c; } };
      return c;
    },
  };

  window.supabase = { createClient: () => client };
  window.__MAGASIN__ = magasin;
})();
