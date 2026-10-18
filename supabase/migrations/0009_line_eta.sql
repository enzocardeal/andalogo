create function public.get_line_eta(p_route_id text, p_direction_id integer, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::smallint as hour,
      case extract(isodow from ts) when 6 then 'saturday' when 7 then 'sunday' else 'weekday' end as day_type
    from local_time
  )
  select jsonb_build_object(
      'route_id', p.route_id,
      'direction_id', p.direction_id,
      'polyline', p.polyline,
      'stop_offsets_m', p.stop_offsets_m,
      'run_time_s', p.run_time_s,
      'circular', not exists (
        select 1 from public.route_patterns o where o.route_id = p.route_id and o.direction_id <> p.direction_id),
      'paces', e.pace_s_per_km,
      'samples', e.samples)
  from clock c
  cross join public.route_patterns p
  join public.routes r on r.id = p.route_id
  left join public.eta_paces e
    on e.route_id = p.route_id
   and e.direction_id = p.direction_id
   and e.day_type = c.day_type
   and e.hour = c.hour
   and e.stops_key = md5(array_to_string(p.stop_ids, ','))
  where p.route_id = p_route_id
    and p.direction_id = p_direction_id
    and r.feed = 'sptrans'
    and r.mode = 'bus'
    and p.stop_offsets_m is not null
$$;

revoke execute on function public.get_line_eta from public, anon;
grant execute on function public.get_line_eta to authenticated;
