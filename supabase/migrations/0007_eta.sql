alter table public.route_patterns
  add column stop_offsets_m integer[],
  add column run_time_s integer;

create function public.get_stop_eta(p_stop_id text)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'route_id', p.route_id,
      'direction_id', p.direction_id,
      'polyline', p.polyline,
      'stop_offsets_m', p.stop_offsets_m,
      'stop_indexes', i.indexes,
      'run_time_s', p.run_time_s,
      'circular', not exists (
        select 1 from public.route_patterns o where o.route_id = p.route_id and o.direction_id <> p.direction_id))
    order by p.route_id, p.direction_id), '[]'::jsonb)
  from public.stop_routes sr
  join public.routes r on r.id = sr.route_id
  join public.route_patterns p on p.route_id = sr.route_id and p.direction_id = sr.direction_id
  cross join lateral (
    select array_agg(o.ord - 1 order by o.ord) as indexes
    from unnest(p.stop_ids) with ordinality as o (stop_id, ord)
    where o.stop_id = p_stop_id
  ) i
  where sr.stop_id = p_stop_id
    and r.feed = 'sptrans'
    and r.mode = 'bus'
    and p.stop_offsets_m is not null
    and i.indexes is not null
$$;

revoke execute on function public.get_stop_eta from public, anon;
grant execute on function public.get_stop_eta to authenticated;
