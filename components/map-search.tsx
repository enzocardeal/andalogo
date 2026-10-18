"use client";

import { useEffect, useRef, useState } from "react";
import { LineBadge } from "@/components/line-badge";
import type { Point } from "@/lib/geo";
import { MIN_PLACE_QUERY, type Place } from "@/lib/places";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { SearchResult } from "@/lib/transit";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;
const PLACE_DEBOUNCE_MS = 350;

type Found = { query: string; result: SearchResult | null };

type FoundPlaces = { query: string; places: Place[] | null };

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
  const biasRef = useRef(bias);
  const term = query.trim();
  useEffect(() => {
    biasRef.current = bias;
  });

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
      const params = new URLSearchParams({ q: term });
      const center = biasRef.current();
      if (center) {
        params.set("lat", center.lat.toFixed(4));
        params.set("lon", center.lon.toFixed(4));
      }
      let places: Place[] | null = null;
      try {
        const response = await fetch(`/api/places?${params}`, { cache: "no-store" });
        places = response.ok ? ((await response.json()) as { places: Place[] }).places : null;
      } catch (error) {
        console.error("places failed:", error);
      }
      if (!cancelled) {
        setFoundPlaces({ query: term, places });
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

  function choose(pick: () => void) {
    setQuery("");
    setFound(null);
    setFoundPlaces(null);
    pick();
  }

  return (
    <div className="absolute inset-x-3 top-[calc(env(safe-area-inset-top)+0.75rem)] z-10 flex flex-col gap-2">
      <div className="flex items-center rounded-full bg-white dark:bg-neutral-900 shadow-md">
        <input
          id="map-search"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Escape" && setQuery("")}
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
      {(current || currentPlaces) && (
        <div className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg bg-white dark:bg-neutral-900 p-2 shadow-md">
          <SearchResults
            found={current}
            places={currentPlaces}
            placesExpected={placesExpected}
            onRoute={(id) => choose(() => onRoute(id))}
            onStop={(id) => choose(() => onStop(id))}
            onPlace={(place) => choose(() => onPlace(place))}
          />
        </div>
      )}
    </div>
  );
}

type SearchResultsProps = {
  found: Found | null;
  places: FoundPlaces | null;
  placesExpected: boolean;
  onRoute: (routeId: string) => void;
  onStop: (stopId: string) => void;
  onPlace: (place: Place) => void;
};

function SearchResults({ found, places, placesExpected, onRoute, onStop, onPlace }: SearchResultsProps) {
  const routes = found?.result?.routes ?? [];
  const stops = found?.result?.stops ?? [];
  const placeList = places?.places ?? [];
  const placesFailed = places !== null && places.places === null;
  const settled = Boolean(found?.result) && (!placesExpected || (places !== null && !placesFailed));
  if (settled && routes.length === 0 && stops.length === 0 && placeList.length === 0) {
    return <p className="p-2 text-sm text-neutral-600 dark:text-neutral-400">{strings.search.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      {found && !found.result && <p role="alert" className="p-2 text-sm text-red-700 dark:text-red-400">{strings.search.failed}</p>}
      {routes.length > 0 && (
        <section>
          <h3 className="px-2 text-xs font-semibold tracking-wide text-neutral-500 dark:text-neutral-400 uppercase">{strings.search.lines}</h3>
          <ul>
            {routes.map((route) => (
              <li key={route.id}>
                <button
                  type="button"
                  onClick={() => onRoute(route.id)}
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
                  onClick={() => onStop(stop.id)}
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
                  onClick={() => onPlace(place)}
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
    </div>
  );
}
