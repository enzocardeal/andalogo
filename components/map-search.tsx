"use client";

import { useEffect, useRef, useState } from "react";
import { LineBadge } from "@/components/line-badge";
import type { Point } from "@/lib/geo";
import { MIN_PLACE_QUERY, type Place } from "@/lib/places";
import {
  addRecent,
  loadRecent,
  matchRecent,
  recentKey,
  saveRecent,
  type RecentRoute,
  type RecentSearch,
  type RecentStop,
} from "@/lib/recent-searches";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { SearchResult } from "@/lib/transit";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const PLACE_DEBOUNCE_MS = 350;

type Found = { query: string; result: SearchResult | null };

type FoundPlaces = { query: string; places: Place[] | null; full: boolean };

async function fetchPlaces(term: string, center: Point | null, full: boolean): Promise<Place[] | null> {
  const params = new URLSearchParams({ q: term });
  if (center) {
    params.set("lat", center.lat.toFixed(4));
    params.set("lon", center.lon.toFixed(4));
  }
  if (full) {
    params.set("full", "1");
  }
  try {
    const response = await fetch(`/api/places?${params}`, { cache: "no-store" });
    return response.ok ? ((await response.json()) as { places: Place[] }).places : null;
  } catch (error) {
    console.error("places failed:", error);
    return null;
  }
}

type MapSearchProps = {
  onRoute: (routeId: string) => void;
  onStop: (stopId: string) => void;
  onPlace: (place: Place) => void;
  bias: () => Point | null;
};

export function MapSearch({ onRoute, onStop, onPlace, bias }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [foundPlaces, setFoundPlaces] = useState<FoundPlaces | null>(null);
  const [searchingMore, setSearchingMore] = useState<string | null>(null);
  const [recent, setRecent] = useState<RecentSearch[]>([]);
  const [focused, setFocused] = useState(false);
  const biasRef = useRef(bias);
  const inputRef = useRef<HTMLInputElement>(null);
  const term = query.trim();
  useEffect(() => {
    biasRef.current = bias;
  });

  useEffect(() => {
    setRecent(loadRecent());
  }, []);

  useEffect(() => {
    if (term.length < MIN_QUERY_LENGTH) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      createClient()
        .rpc("search", { p_query: term })
        .then(({ data, error }) => {
          if (error) {
            console.error("search failed:", error.message);
          }
          if (!cancelled) {
            setFound({ query: term, result: error ? null : (data as SearchResult) });
          }
        });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    if (term.length < MIN_PLACE_QUERY) {
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      const places = await fetchPlaces(term, biasRef.current(), false);
      if (!cancelled) {
        setFoundPlaces((previous) => (previous?.query === term && previous.full ? previous : { query: term, places, full: false }));
      }
    }, PLACE_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  const current = term.length >= MIN_QUERY_LENGTH && found?.query === term ? found : null;
  const currentPlaces = term.length >= MIN_PLACE_QUERY && foundPlaces?.query === term ? foundPlaces : null;
  const placesExpected = term.length >= MIN_PLACE_QUERY;

  function choose(entry: RecentSearch) {
    const next = addRecent(recent, entry);
    setRecent(next);
    saveRecent(next);
    setQuery("");
    setFound(null);
    setFoundPlaces(null);
    inputRef.current?.blur();
    if (entry.kind === "route") {
      onRoute(entry.route.id);
    } else if (entry.kind === "stop") {
      onStop(entry.stop.id);
    } else {
      onPlace(entry.place);
    }
  }

  function clearRecent() {
    setRecent([]);
    saveRecent([]);
  }

  const recentMatches = term ? matchRecent(recent, term) : [];
  const showRecent = focused && !term && recent.length > 0;

  async function searchMore() {
    if (!placesExpected || searchingMore === term) {
      return;
    }
    setSearchingMore(term);
    const places = await fetchPlaces(term, biasRef.current(), true);
    setFoundPlaces({ query: term, places, full: true });
    setSearchingMore((pending) => (pending === term ? null : pending));
  }

  return (
    <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 flex flex-col gap-2">
      <div className="flex items-center rounded-full bg-white dark:bg-neutral-900 shadow-md">
        <input
          ref={inputRef}
          id="map-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setQuery("");
            } else if (event.key === "Enter") {
              event.currentTarget.blur();
              searchMore();
            }
          }}
          aria-label={strings.search.label}
          placeholder={strings.search.placeholder}
          autoComplete="off"
          enterKeyHint="search"
          className="min-h-11 min-w-0 flex-1 rounded-full bg-transparent px-4 outline-none [&::-webkit-search-cancel-button]:appearance-none"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label={strings.search.clear}
            className="flex size-11 shrink-0 items-center justify-center text-xl text-neutral-500 dark:text-neutral-400"
          >
            ×
          </button>
        )}
      </div>
      {showRecent && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg bg-white dark:bg-neutral-900 p-2 shadow-md"
        >
          <RecentSection entries={recent} onPick={choose} onClear={clearRecent} />
        </div>
      )}
      {(current || currentPlaces || searchingMore === term || recentMatches.length > 0) && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg bg-white dark:bg-neutral-900 p-2 shadow-md"
        >
          <SearchResults
            recent={recentMatches}
            found={current}
            places={currentPlaces}
            placesExpected={placesExpected}
            canSearchMore={placesExpected && !currentPlaces?.full}
            searchingMore={searchingMore === term}
            onSearchMore={searchMore}
            onPick={choose}
          />
        </div>
      )}
    </div>
  );
}

function RecentRow({ entry, onPick }: { entry: RecentSearch; onPick: (entry: RecentSearch) => void }) {
  if (entry.kind === "route") {
    return (
      <button type="button" onClick={() => onPick(entry)} className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left">
        <LineBadge line={entry.route} />
        <span className="truncate text-sm">{entry.route.long_name}</span>
      </button>
    );
  }
  if (entry.kind === "stop") {
    return (
      <button type="button" onClick={() => onPick(entry)} className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 text-left">
        <span className="truncate text-sm">{entry.stop.name}</span>
        <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{strings.modes[entry.stop.mode]}</span>
      </button>
    );
  }
  return (
    <button type="button" onClick={() => onPick(entry)} className="flex min-h-11 w-full flex-col justify-center rounded px-2 text-left">
      <span className="truncate text-sm">{entry.place.name}</span>
      {entry.place.detail && <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{entry.place.detail}</span>}
    </button>
  );
}

function RecentSection({ entries, onPick, onClear }: { entries: RecentSearch[]; onPick: (entry: RecentSearch) => void; onClear?: () => void }) {
  return (
    <section>
      <div className="flex items-center justify-between px-2">
        <h3 className="text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">{strings.search.recent}</h3>
        {onClear && (
          <button type="button" onClick={onClear} className="min-h-9 text-xs font-medium text-blue-700 dark:text-blue-400">
            {strings.search.clearRecent}
          </button>
        )}
      </div>
      <ul>
        {entries.map((entry) => (
          <li key={recentKey(entry)}>
            <RecentRow entry={entry} onPick={onPick} />
          </li>
        ))}
      </ul>
    </section>
  );
}

type SearchResultsProps = {
  recent: RecentSearch[];
  found: Found | null;
  places: FoundPlaces | null;
  placesExpected: boolean;
  canSearchMore: boolean;
  searchingMore: boolean;
  onSearchMore: () => void;
  onPick: (entry: RecentSearch) => void;
};

function SearchResults({
  recent,
  found,
  places,
  placesExpected,
  canSearchMore,
  searchingMore,
  onSearchMore,
  onPick,
}: SearchResultsProps) {
  const shown = new Set(recent.map(recentKey));
  const asRoute = (route: RecentRoute): RecentSearch => ({ kind: "route", route });
  const asStop = (stop: RecentStop): RecentSearch => ({ kind: "stop", stop });
  const asPlace = (place: Place): RecentSearch => ({ kind: "place", place });
  const routes = (found?.result?.routes ?? []).filter((route) => !shown.has(recentKey(asRoute(route))));
  const stops = (found?.result?.stops ?? []).filter((stop) => !shown.has(recentKey(asStop(stop))));
  const placeList = (places?.places ?? []).filter((place) => !shown.has(recentKey(asPlace(place))));
  const placesFailed = places !== null && places.places === null;
  const settled = Boolean(found?.result) && (!placesExpected || (places !== null && !placesFailed));
  const empty = settled && recent.length === 0 && routes.length === 0 && stops.length === 0 && placeList.length === 0;
  return (
    <div className="flex flex-col gap-2">
      {recent.length > 0 && <RecentSection entries={recent} onPick={onPick} />}
      {empty && <p className="p-2 text-sm text-neutral-600 dark:text-neutral-400">{strings.search.empty}</p>}
      {found && !found.result && <p role="alert" className="p-2 text-sm text-red-700 dark:text-red-400">{strings.search.failed}</p>}
      {routes.length > 0 && (
        <section>
          <h3 className="px-2 text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">{strings.search.lines}</h3>
          <ul>
            {routes.map((route) => (
              <li key={route.id}>
                <button
                  type="button"
                  onClick={() =>
                    onPick(
                      asRoute({
                        id: route.id,
                        short_name: route.short_name,
                        long_name: route.long_name,
                        mode: route.mode,
                        color: route.color,
                        text_color: route.text_color,
                      }),
                    )
                  }
                  className="flex min-h-11 w-full items-center gap-2 rounded px-2 text-left"
                >
                  <LineBadge line={route} />
                  <span className="truncate text-sm">{route.long_name}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {stops.length > 0 && (
        <section>
          <h3 className="px-2 text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">{strings.search.stops}</h3>
          <ul>
            {stops.map((stop) => (
              <li key={stop.id}>
                <button
                  type="button"
                  onClick={() => onPick(asStop({ id: stop.id, name: stop.name, mode: stop.mode }))}
                  className="flex min-h-11 w-full items-center justify-between gap-2 rounded px-2 text-left"
                >
                  <span className="truncate text-sm">{stop.name}</span>
                  <span className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400">{strings.modes[stop.mode]}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {placeList.length > 0 && (
        <section>
          <h3 className="px-2 text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">{strings.search.places}</h3>
          <ul>
            {placeList.map((place) => (
              <li key={place.id}>
                <button
                  type="button"
                  onClick={() => onPick(asPlace(place))}
                  className="flex min-h-11 w-full flex-col justify-center rounded px-2 text-left"
                >
                  <span className="truncate text-sm">{place.name}</span>
                  {place.detail && <span className="truncate text-xs text-neutral-500 dark:text-neutral-400">{place.detail}</span>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {placesFailed && (
        <p className="p-2 text-xs text-neutral-500 dark:text-neutral-400">{strings.search.placesFailed}</p>
      )}
      {canSearchMore && (
        <button
          type="button"
          onClick={onSearchMore}
          disabled={searchingMore}
          className="min-h-11 rounded px-2 text-left text-sm font-medium text-blue-700 disabled:text-neutral-500 dark:text-blue-400"
        >
          {searchingMore ? strings.search.searching : strings.search.morePlaces}
        </button>
      )}
    </div>
  );
}
