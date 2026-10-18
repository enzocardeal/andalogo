create table public.feed_versions (
  feed text primary key check (feed in ('sptrans', 'artesp')),
  sha256 text not null,
  stops_file text not null,
  loaded_at timestamptz not null default now()
);

create table public.routes (
  id text primary key,
  feed text not null check (feed in ('sptrans', 'artesp')),
  short_name text not null,
  long_name text not null,
  mode text not null check (mode in ('bus', 'metro', 'cptm', 'emtu')),
  color text,
  text_color text
);

create index routes_feed on public.routes (feed);

create table public.stops (
  id text primary key,
  feed text not null check (feed in ('sptrans', 'artesp')),
  gtfs_stop_id text not null,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  mode text not null check (mode in ('bus', 'metro', 'cptm', 'emtu')),
  color text
);

create index stops_feed on public.stops (feed);

create table public.stop_routes (
  stop_id text not null references public.stops (id) on delete cascade,
  route_id text not null references public.routes (id) on delete cascade,
  direction_id smallint not null check (direction_id in (0, 1)),
  headsign text not null,
  primary key (stop_id, route_id, direction_id)
);

create index stop_routes_route on public.stop_routes (route_id);

create table public.headways (
  route_id text not null references public.routes (id) on delete cascade,
  direction_id smallint not null check (direction_id in (0, 1)),
  day_type text not null check (day_type in ('weekday', 'saturday', 'sunday')),
  start_min integer not null check (start_min >= 0),
  end_min integer not null check (end_min > start_min),
  headway_s integer not null check (headway_s > 0)
);

create index headways_route on public.headways (route_id, direction_id, day_type);

alter table public.feed_versions enable row level security;
alter table public.feed_versions force row level security;
alter table public.routes enable row level security;
alter table public.routes force row level security;
alter table public.stops enable row level security;
alter table public.stops force row level security;
alter table public.stop_routes enable row level security;
alter table public.stop_routes force row level security;
alter table public.headways enable row level security;
alter table public.headways force row level security;

revoke all on table public.feed_versions, public.routes, public.stops, public.stop_routes, public.headways
  from anon, authenticated;
grant select on table public.feed_versions, public.routes, public.stops, public.stop_routes, public.headways
  to authenticated;

create policy feed_versions_select on public.feed_versions for select to authenticated using (true);
create policy routes_select on public.routes for select to authenticated using (true);
create policy stops_select on public.stops for select to authenticated using (true);
create policy stop_routes_select on public.stop_routes for select to authenticated using (true);
create policy headways_select on public.headways for select to authenticated using (true);

create function public.get_stop(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::integer * 60 + extract(minute from ts)::integer as minute,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as today,
      case extract(isodow from ts - interval '1 day') when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end
        as yesterday
    from local_time
  ),
  lines as (
    select
      r.id as route_id,
      r.short_name,
      r.long_name,
      r.mode,
      r.color,
      r.text_color,
      sr.direction_id,
      sr.headsign,
      (select round(1 / sum(1.0 / h.headway_s))::integer
         from public.headways h
        where h.route_id = sr.route_id
          and h.direction_id = sr.direction_id
          and ((h.day_type = c.today and c.minute >= h.start_min and c.minute < h.end_min)
            or (h.day_type = c.yesterday and c.minute + 1440 >= h.start_min and c.minute + 1440 < h.end_min)))
        as headway_s
    from public.stop_routes sr
    join public.routes r on r.id = sr.route_id
    cross join clock c
    where sr.stop_id = p_stop_id
  )
  select jsonb_build_object(
    'id', s.id,
    'name', s.name,
    'mode', s.mode,
    'lat', s.lat,
    'lon', s.lon,
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(l) order by l.headway_s is null, l.short_name, l.direction_id) from lines l),
      '[]'::jsonb))
  from public.stops s
  where s.id = p_stop_id
$$;

revoke execute on function public.get_stop from public, anon;
grant execute on function public.get_stop to authenticated;
