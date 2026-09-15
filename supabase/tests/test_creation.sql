\pset tuples_only on
\pset border 0
set role authenticated;
select public.essai_creation('11111111-1111-1111-1111-111111111111', 'administrateur');
select public.essai_creation('22222222-2222-2222-2222-222222222222', 'concepteur');
select public.essai_creation('33333333-3333-3333-3333-333333333333', 'FORMATEUR');
select public.essai_creation('44444444-4444-4444-4444-444444444444', 'responsable');
select public.essai_creation('55555555-5555-5555-5555-555555555555', 'apprenant');
select public.essai_creation('66666666-6666-6666-6666-666666666666', 'formateur hors organisation');
reset role;
