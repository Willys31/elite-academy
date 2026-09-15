-- Jeu d'essai : une organisation, un membre par rôle.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'admin@ea.ci'),
  ('22222222-2222-2222-2222-222222222222', 'designer@ea.ci'),
  ('33333333-3333-3333-3333-333333333333', 'formateur@ea.ci'),
  ('44444444-4444-4444-4444-444444444444', 'manager@ea.ci'),
  ('55555555-5555-5555-5555-555555555555', 'apprenant@ea.ci'),
  ('66666666-6666-6666-6666-666666666666', 'formateur-autre@ea.ci')
on conflict (id) do nothing;

-- Les profils sont créés par trigger sur auth.users en production ; ici
-- on les insère à la main puisque le trigger vit côté Supabase.
insert into public.profiles (id, email, full_name)
select id, email, split_part(email, '@', 1) from auth.users
on conflict (id) do nothing;

insert into public.organizations (id, name, type)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'Elite Experience', 'centre_formation')
on conflict (id) do nothing;

insert into public.organization_members (organization_id, user_id, role, status) values
  ('aaaaaaaa-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'admin',    'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '22222222-2222-2222-2222-222222222222', 'designer', 'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '33333333-3333-3333-3333-333333333333', 'trainer',  'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '44444444-4444-4444-4444-444444444444', 'manager',  'active'),
  ('aaaaaaaa-0000-0000-0000-000000000001', '55555555-5555-5555-5555-555555555555', 'learner',  'active')
on conflict do nothing;
