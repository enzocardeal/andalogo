create or replace function public.get_stop(p_stop_id text, p_at timestamptz default now())
returns jsonb language sql stable security invoker set search_path = '' as $$
  with local_time as (
    select p_at at time zone 'America/Sao_Paulo' as ts
  ),
  clock as (
    select
      extract(hour from ts)::integer * 60 + extract(minute from ts)::integer as minute,
      extract(hour from ts)::integer * 3600 + extract(minute from ts)::integer * 60
        + floor(extract(second from ts))::integer as second,
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
        as headway_s,
      case
        when exists (
          select 1 from public.timetable_patterns tp
          where tp.route_id = sr.route_id and tp.direction_id = sr.direction_id)
        then coalesce(
          (select array_agg(next.wait_s order by next.wait_s)
             from (
               select t.start_s + st.offset_s - service.shift_s - c.second as wait_s
                 from public.timetable_stops st
                 join public.timetable_patterns tp on tp.id = st.pattern_id
                 join public.timetable_trips t on t.pattern_id = tp.id
                 cross join lateral (values (c.today, 0), (c.yesterday, 86400)) as service (day_type, shift_s)
                where st.stop_id = sr.stop_id
                  and tp.route_id = sr.route_id
                  and tp.direction_id = sr.direction_id
                  and t.day_type = service.day_type
                  and t.start_s + st.offset_s - service.shift_s - c.second >= 0
                order by wait_s
                limit 4
             ) next),
          '{}'::integer[])
      end as departures
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
    'favorite', exists (select 1 from public.favorites f where f.user_id = auth.uid() and f.stop_id = s.id),
    'lines', coalesce(
      (select jsonb_agg(to_jsonb(l)
                order by l.headway_s is null and coalesce(cardinality(l.departures), 0) = 0,
                         coalesce(l.departures[1], l.headway_s),
                         l.short_name,
                         l.direction_id)
         from lines l),
      '[]'::jsonb))
  from public.stops s
  where s.id = p_stop_id
$$;
