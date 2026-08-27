/* ---------------------------------------------------------------------
   Coordonnées du projet Supabase.

   À récupérer dans Supabase → Project Settings → Data API :
     • url : « Project URL »        (https://xxxxxxxx.supabase.co)
     • cle : « anon public » key    (une longue chaîne commençant par ey…)

   Cette clé est publique par conception : elle ne donne accès qu'à ce que
   les policies RLS autorisent, c'est-à-dire rien tant qu'on n'est pas
   connecté avec un des comptes de la famille. Elle peut donc figurer ici
   sans risque, dans un dépôt même public.
--------------------------------------------------------------------- */

window.CONFIG_SUPABASE = {
  url: "https://tmklqjybzdhqnzlpiiuf.supabase.co",
  cle: "sb_publishable_sZSi0Yq-U7cjL3IxbxL18Q_wXpfS9JZ",
};
