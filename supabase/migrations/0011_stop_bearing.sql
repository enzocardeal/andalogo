alter table public.stops add column bearing smallint check (bearing between 0 and 359);
