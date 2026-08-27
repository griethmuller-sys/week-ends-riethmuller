-- =====================================================================
--  Week-ends Riethmuller — programme scout de Thomas (EEF, groupe Sinaï)
--  27 dates, saison 2026-2027. À lancer après schema.sql.
--  Relançable : les lignes déjà présentes sont ignorées.
-- =====================================================================

insert into public.activites (id, jour, qui, texte, statut, origine) values
  ('5f0ef95c-abf8-5081-912b-f86cf96bd406', date '2026-09-12', 'thomas', 'Découverte du scoutisme · réunion parents 16h', 'confirme', 'scout'),
  ('8af7aa33-f5a3-5ecb-9a66-9939a9d08059', date '2026-09-12', 'thomas', 'Soirée HP + chefs éclais', 'confirme', 'scout'),
  ('84f4980b-5dbf-5961-ba8f-180cf030c753', date '2026-09-13', 'thomas', 'Suite HP et chefs éclais', 'confirme', 'scout'),
  ('c1b597fa-8f29-5b9a-a81a-154c547c66f8', date '2026-09-19', 'thomas', 'AG des EEF à Allex (19-20/09)', 'confirme', 'scout'),
  ('e9c2777c-4560-5615-ba9a-645dc0e1af45', date '2026-09-20', 'thomas', 'AG des EEF à Allex (suite)', 'confirme', 'scout'),
  ('b84e9054-1380-5954-b014-c8543581c4b8', date '2026-10-03', 'thomas', 'Week-end de rentrée', 'confirme', 'scout'),
  ('d39c0c4b-223a-5ff5-9ed8-67e37790d1ff', date '2026-10-04', 'thomas', 'Week-end de rentrée (suite)', 'confirme', 'scout'),
  ('94bbc42a-9466-561b-b333-52fb4af1d0ce', date '2026-10-24', 'thomas', 'Camp de formation Mafeking (24-31/10)', 'confirme', 'scout'),
  ('994069d0-52a6-554b-9680-5e92ad81138e', date '2026-10-25', 'thomas', 'Camp Mafeking (en cours)', 'confirme', 'scout'),
  ('f26d0521-1923-5698-8b01-0bbe6b742a01', date '2026-10-31', 'thomas', 'Fin du camp Mafeking', 'confirme', 'scout'),
  ('bd27d9ed-c716-5ec9-a7fd-2c5176d65a6d', date '2026-10-31', 'thomas', 'WE de formation chefs loups et éclais', 'confirme', 'scout'),
  ('c5918805-6391-574b-994b-cf2d6e5463b3', date '2026-11-01', 'thomas', 'WE de formation chefs (suite)', 'confirme', 'scout'),
  ('4da55b55-71b6-5418-bb03-6034ce824ee9', date '2026-11-07', 'thomas', 'Sortie à la journée', 'confirme', 'scout'),
  ('d9061902-891a-5afb-90f6-f919fac43a78', date '2026-11-28', 'thomas', 'Sortie à la journée', 'confirme', 'scout'),
  ('595d06b7-34b0-5a88-a72d-91e67e8a2311', date '2026-12-12', 'thomas', 'Sortie à la journée', 'confirme', 'scout'),
  ('f903a16b-3267-5a17-b5f8-3b2bc6a2d945', date '2027-01-16', 'thomas', 'Week-end d''hiver à la montagne', 'confirme', 'scout'),
  ('aa98b86c-6116-5db6-80e3-5b8ef02b6a51', date '2027-01-17', 'thomas', 'Week-end d''hiver (suite)', 'confirme', 'scout'),
  ('a6599d7e-f1dd-5777-a636-37280190cd94', date '2027-01-30', 'thomas', 'Week-end Oasis, tous les chefs EEF', 'confirme', 'scout'),
  ('8402dcbe-1927-58a1-bc68-6cbc61cd493f', date '2027-01-30', 'thomas', '(commence le ven. 29/01)', 'confirme', 'scout'),
  ('445963f9-13bb-5887-b0fe-f9b54223bd74', date '2027-01-31', 'thomas', 'Week-end Oasis (suite)', 'confirme', 'scout'),
  ('da606762-7fa9-5b97-a554-c4be17629e55', date '2027-02-06', 'thomas', 'Sortie à la journée', 'confirme', 'scout'),
  ('ed335069-760a-5ff6-a4b0-7c62f19a63f3', date '2027-03-06', 'thomas', 'Sortie à la journée', 'confirme', 'scout'),
  ('7a508904-fd56-55f5-b575-10972f9216ca', date '2027-03-20', 'thomas', 'WE de préparation du camp d''été', 'confirme', 'scout'),
  ('e8a4b5ad-34b5-5331-bd29-3f25ec91f64a', date '2027-03-21', 'thomas', 'WE de préparation (suite)', 'confirme', 'scout'),
  ('e0fe9e7a-1eea-58be-949b-75eab9f3c240', date '2027-04-03', 'thomas', 'Activité sponsorisée', 'confirme', 'scout'),
  ('5f9501df-8000-5063-8024-246072e86efa', date '2027-05-01', 'thomas', 'Week-end', 'confirme', 'scout'),
  ('d233962e-6123-5240-8a14-2b62c853f30f', date '2027-05-02', 'thomas', 'Week-end (suite)', 'confirme', 'scout'),
  ('864aec1d-0005-5edc-8f20-4e02e83e50dc', date '2027-05-22', 'thomas', 'Sortie service', 'confirme', 'scout'),
  ('6e45524e-f8f7-5a95-b78f-12240cff5dec', date '2027-05-22', 'thomas', 'Réunion de chaîne 18h à l''ECE', 'confirme', 'scout'),
  ('47b40828-3ff2-50eb-bcc9-5dbc8ee0553d', date '2027-06-05', 'thomas', 'Préparation du matériel du camp d''été', 'confirme', 'scout'),
  ('5bf336f7-902e-5b3a-b0f0-fc1240b80af5', date '2027-06-12', 'thomas', 'Sortie de clôture, avec les parents en fin de sortie', 'confirme', 'scout')
on conflict (id) do nothing;
