"use client";

import { useEffect, useState } from "react";
import { LineBadge } from "@/components/line-badge";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/client";
import type { SearchResult } from "@/lib/transit";

const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

type Found = { query: string; result: SearchResult | null };

type MapSearchProps = {
  onRoute: (routeId: string) => void;
  onStop: (stopId: string) => void;
};

export function MapSearch({ onRoute, onStop }: MapSearchProps) {
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const term = query.trim();

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

  const current = term.length >= MIN_QUERY_LENGTH && found?.query === term ? found : null;

  function choose(pick: () => void) {
    setQuery("");
    setFound(null);
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
      {current && (
        <div className="max-h-[50dvh] overflow-y-auto overscroll-contain rounded-lg bg-white dark:bg-neutral-900 p-2 shadow-md">
          <SearchResults found={current} onRoute={(id) => choose(() => onRoute(id))} onStop={(id) => choose(() => onStop(id))} />
        </div>
      )}
    </div>
  );
}

function SearchResults({ found, onRoute, onStop }: { found: Found } & MapSearchProps) {
  if (!found.result) {
    return <p role="alert" className="p-2 text-sm text-red-700 dark:text-red-400">{strings.search.failed}</p>;
  }
  const { routes, stops } = found.result;
  if (routes.length === 0 && stops.length === 0) {
    return <p className="p-2 text-sm text-neutral-600 dark:text-neutral-400">{strings.search.empty}</p>;
  }
  return (
    <div className="flex flex-col gap-2">
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
    </div>
  );
}
