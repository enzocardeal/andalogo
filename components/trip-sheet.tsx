"use client";

import { useEffect, useState } from "react";
import { LineBadge } from "@/components/line-badge";
import { CloseButton, Sheet } from "@/components/stop-sheet";
import type { TripView } from "@/lib/map-view";
import type { Trip, TripLeg, TripPlace } from "@/lib/router/trips";
import { strings } from "@/lib/strings";
import { planTrip } from "@/lib/trip-router";

const CLOCK = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const LOCATION_TIMEOUT_MS = 10_000;

type TripSheetProps = {
  trip: TripView;
  pickingOrigin: boolean;
  onPickOrigin: () => void;
  onUseMyLocation: () => void;
  onTime: (at: number | null) => void;
  onShow: (trip: Trip | null) => void;
  onClose: () => void;
};

type Result = { key: string; status: "planning" | "done" | "failed" | "location"; trips: Trip[] };

function clock(ms: number): string {
  return CLOCK.format(new Date(ms));
}

function minutes(ms: number): number {
  return Math.max(1, Math.round(ms / 60_000));
}

function localInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function currentPosition(): Promise<TripPlace> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("no geolocation"));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => resolve({ id: null, name: strings.trip.myLocation, lat: coords.latitude, lon: coords.longitude }),
      reject,
      { enableHighAccuracy: true, timeout: LOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
  });
}

export function TripSheet({ trip, pickingOrigin, onPickOrigin, onUseMyLocation, onTime, onShow, onClose }: TripSheetProps) {
  const key = JSON.stringify([trip.from, trip.to, trip.at]);
  const [result, setResult] = useState<Result | null>(null);
  const [selected, setSelected] = useState<{ key: string; index: number } | null>(null);
  const current = result?.key === key ? result : null;
  const chosen = selected?.key === key && current ? (current.trips[selected.index] ?? null) : null;

  useEffect(() => {
    let cancelled = false;
    setResult({ key, status: "planning", trips: [] });
    (async () => {
      let origin: TripPlace;
      try {
        origin = trip.from ? { id: null, name: trip.from.label, lat: trip.from.lat, lon: trip.from.lon } : await currentPosition();
      } catch {
        if (!cancelled) {
          setResult({ key, status: "location", trips: [] });
        }
        return;
      }
      try {
        const destination = { id: null, name: trip.to.label, lat: trip.to.lat, lon: trip.to.lon };
        const trips = await planTrip(origin, destination, new Date(trip.at ?? Date.now()));
        if (!cancelled) {
          setResult({ key, status: "done", trips });
        }
      } catch (error) {
        console.error("trip planning failed:", error);
        if (!cancelled) {
          setResult({ key, status: "failed", trips: [] });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // The search reruns only when the trip itself changes, not on every new trip object.
  }, [key]);

  useEffect(() => {
    onShow(chosen);
  }, [chosen, onShow]);

  return (
    <Sheet>
      <header className="flex items-start justify-between gap-2 px-4 pt-4 pb-2">
        <div className="flex min-w-0 flex-col">
          <span className="text-sm text-neutral-500 dark:text-neutral-400">{strings.trip.title}</span>
          <h2 className="truncate text-lg font-semibold">{trip.to.label}</h2>
        </div>
        <CloseButton label={strings.trip.close} onClick={onClose} />
      </header>
      <div key={chosen ? "detail" : "list"} className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4">
        {chosen ? (
          <TripDetail trip={chosen} onBack={() => setSelected(null)} />
        ) : (
          <>
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="min-w-0 truncate">
                <span className="text-neutral-500 dark:text-neutral-400">{strings.trip.from}: </span>
                {trip.from?.label ?? strings.trip.myLocation}
              </span>
              <span className="flex shrink-0 gap-2">
                {trip.from && (
                  <button type="button" onClick={onUseMyLocation} className="min-h-9 font-medium text-blue-700 dark:text-blue-400">
                    {strings.trip.myLocation}
                  </button>
                )}
                <button type="button" onClick={onPickOrigin} className="min-h-9 font-medium text-blue-700 dark:text-blue-400">
                  {strings.trip.change}
                </button>
              </span>
            </div>
            {pickingOrigin && <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.trip.pickOrigin}</p>}
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <button
                type="button"
                onClick={() => onTime(null)}
                aria-pressed={trip.at === null}
                className={`min-h-9 rounded-full px-3 font-medium ${trip.at === null ? "bg-neutral-900 text-white dark:bg-white dark:text-neutral-900" : "border border-neutral-300 dark:border-neutral-700"}`}
              >
                {strings.trip.now}
              </button>
              <label className="flex items-center gap-2">
                <span className="text-neutral-500 dark:text-neutral-400">{strings.trip.leaveAt}</span>
                <input
                  type="datetime-local"
                  value={trip.at === null ? "" : localInput(trip.at)}
                  onChange={(event) => onTime(event.target.value ? new Date(event.target.value).getTime() : null)}
                  className="min-h-9 rounded-md border border-neutral-300 bg-transparent px-2 dark:border-neutral-700"
                />
              </label>
            </div>
            <TripList result={current} onSelect={(index) => setSelected({ key, index })} />
          </>
        )}
      </div>
    </Sheet>
  );
}

function TripList({ result, onSelect }: { result: Result | null; onSelect: (index: number) => void }) {
  if (!result || result.status === "planning") {
    return <p className="text-sm text-neutral-500 dark:text-neutral-400">{strings.trip.planning}</p>;
  }
  if (result.status === "location") {
    return <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.trip.locationFailed}</p>;
  }
  if (result.status === "failed") {
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {strings.trip.failed}
      </p>
    );
  }
  if (result.trips.length === 0) {
    return <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.trip.none}</p>;
  }
  return (
    <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
      {result.trips.map((trip, index) => (
        <li key={index}>
          <button type="button" onClick={() => onSelect(index)} className="flex w-full flex-col gap-2 py-3 text-left">
            <span className="flex items-baseline justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {clock(trip.depart)} → {clock(trip.arrive)}
              </span>
              <span className="text-sm text-neutral-600 tabular-nums dark:text-neutral-400">
                {minutes(trip.arrive - trip.depart)} {strings.trip.minutes}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1 text-sm">
              {trip.legs.map((leg, legIndex) => (
                <span key={legIndex} className="flex items-center gap-1">
                  {legIndex > 0 && <span className="text-neutral-400">›</span>}
                  {leg.kind === "walk" ? (
                    <span className="text-neutral-600 tabular-nums dark:text-neutral-400">🚶 {minutes(leg.arrive - leg.depart)}</span>
                  ) : (
                    <LineBadge line={leg.line} />
                  )}
                </span>
              ))}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function TripDetail({ trip, onBack }: { trip: Trip; onBack: () => void }) {
  return (
    <>
      <button type="button" onClick={onBack} className="min-h-9 self-start font-medium text-blue-700 dark:text-blue-400">
        ‹ {strings.trip.back}
      </button>
      <p className="font-semibold tabular-nums">
        {clock(trip.depart)} → {clock(trip.arrive)} · {minutes(trip.arrive - trip.depart)} {strings.trip.minutes}
      </p>
      <ol className="flex flex-col gap-3">
        {trip.legs.map((leg, index) => (
          <li key={index}>
            <LegDetail leg={leg} last={index === trip.legs.length - 1} />
          </li>
        ))}
      </ol>
    </>
  );
}

function LegDetail({ leg, last }: { leg: TripLeg; last: boolean }) {
  if (leg.kind === "walk") {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        🚶 {strings.trip.walk} {minutes(leg.arrive - leg.depart)} {strings.trip.minutes} {strings.trip.to}{" "}
        {last ? strings.trip.destination : leg.to.name}
      </p>
    );
  }
  const wait = leg.depart - leg.ready;
  return (
    <div className="flex flex-col gap-1">
      <span className="flex min-w-0 items-center gap-2">
        <LineBadge line={leg.line} />
        <span className="truncate">{leg.headsign}</span>
      </span>
      {leg.alternatives.length > 0 && (
        <span className="text-xs text-neutral-500 dark:text-neutral-400">
          {strings.trip.or} {leg.alternatives.map((line) => line.short_name).join(", ")}
        </span>
      )}
      <span className="text-sm">
        {strings.trip.board} {leg.from.name} · <span className="tabular-nums">{clock(leg.depart)}</span>
        {wait >= 60_000 && (
          <span className="text-neutral-500 dark:text-neutral-400">
            {" "}
            ({strings.trip.wait} ~{minutes(wait)} {strings.trip.minutes})
          </span>
        )}
      </span>
      <span className="text-sm">
        {strings.trip.alight} {leg.to.name} · <span className="tabular-nums">{clock(leg.arrive)}</span>
      </span>
    </div>
  );
}
