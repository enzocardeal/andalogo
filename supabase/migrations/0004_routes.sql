create extension if not exists unaccent with schema extensions;

create table public.route_patterns (
  route_id text not null references public.routes (id) on delete cascade,
  direction_id smallint not null check (direction_id in (0, 1)),
  headsign text not null,
  polyline text not null,
  stop_ids text[] not null,
  primary key (route_id, direction_id)
);

alter table public.route_patterns enable row level security;
alter table public.route_patterns force row level security;
revoke all on table public.route_patterns from anon, authenticated;
grant select on table public.route_patterns to authenticated;

create policy route_patterns_select on public.route_patterns for select to authenticated using (true);

create function public.get_route(p_route_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'id', r.id,
    'short_name', r.short_name,
    'long_name', r.long_name,
    'mode', r.mode,
    'color', r.color,
    'text_color', r.text_color,
    'patterns', coalesce(
      (select jsonb_agg(
         jsonb_build_object(
           'direction_id', p.direction_id,
           'headsign', p.headsign,
           'polyline', p.polyline,
           'stops', coalesce(
             (select jsonb_agg(jsonb_build_object('id', s.id, 'name', s.name, 'lat', s.lat, 'lon', s.lon) order by o.ord)
                from unnest(p.stop_ids) with ordinality as o (stop_id, ord)
                join public.stops s on s.id = o.stop_id),
             '[]'::jsonb))
         order by p.direction_id)
         from public.route_patterns p
        where p.route_id = r.id),
      '[]'::jsonb))
  from public.routes r
  where r.id = p_route_id
$$;

create function public.normalize_search(p_text text)
returns text language sql immutable set search_path = '' as $$
  select extensions.unaccent('extensions.unaccent'::regdictionary, lower(btrim(p_text)))
$$;

create function public.search(p_query text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  with q as (
    select
      public.normalize_search(p_query) as term,
      replace(replace(replace(public.normalize_search(p_query), '\', '\\'), '%', '\%'), '_', '\_') as pattern
  ),
  found_routes as (
    select
      r.id, r.short_name, r.long_name, r.mode, r.color, r.text_color,
      row_number() over (
        order by public.normalize_search(r.short_name) like q.pattern || '%' desc, r.short_name) as rank
    from public.routes r, q
    where length(q.term) >= 2
      and (public.normalize_search(r.short_name) like q.pattern || '%'
        or public.normalize_search(r.long_name) like '%' || q.pattern || '%')
    order by rank
    limit 20
  ),
  found_stops as (
    select
      s.id, s.name, s.mode, s.lat, s.lon,
      row_number() over (
        order by s.mode = 'bus', public.normalize_search(s.name) like q.pattern || '%' desc, s.name) as rank
    from public.stops s, q
    where length(q.term) >= 2
      and public.normalize_search(s.name) like '%' || q.pattern || '%'
    order by rank
    limit 20
  )
  select jsonb_build_object(
    'routes', coalesce((select jsonb_agg(to_jsonb(found_routes) - 'rank' order by rank) from found_routes), '[]'::jsonb),
    'stops', coalesce((select jsonb_agg(to_jsonb(found_stops) - 'rank' order by rank) from found_stops), '[]'::jsonb))
$$;

revoke execute on function public.get_route, public.search, public.normalize_search from public, anon;
grant execute on function public.get_route, public.search, public.normalize_search to authenticated;
