"use client";

import { useEffect, useState } from "react";
import { LineBadge } from "@/components/line-badge";
import { CloseButton, Sheet } from "@/components/stop-sheet";
import type { TripView } from "@/lib/map-view";
import type { BoardingChoice, Trip, TripLeg, TripPlace } from "@/lib/router/trips";
import { strings } from "@/lib/strings";
import { boardingChoices, planTrip } from "@/lib/trip-router";

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

type Result = { key: string; status: "planning" | "done" | "failed" | "location"; trips: Trip[]; origin?: TripPlace };

type Picking = { trip: Trip; leg: number; status: "loading" | "done" | "failed"; options: BoardingChoice[] };

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
  const [edited, setEdited] = useState<{ key: string; index: number; trip: Trip } | null>(null);
  const [picking, setPicking] = useState<Picking | null>(null);
  const current = result?.key === key ? result : null;
  const planned = selected?.key === key && current ? (current.trips[selected.index] ?? null) : null;
  const chosen = planned && edited?.key === key && edited.index === selected?.index ? edited.trip : planned;
  const shownPicking = chosen && picking?.trip === chosen ? picking : null;
  const destination: TripPlace = { id: null, name: trip.to.label, lat: trip.to.lat, lon: trip.to.lon };

  function pickBoarding(origin: TripPlace, shown: Trip, leg: number) {
    const same = (now: Picking) => now.trip === shown && now.leg === leg;
    setPicking({ trip: shown, leg, status: "loading", options: [] });
    boardingChoices(origin, destination, shown, leg).then(
      (options) => setPicking((now) => (now && same(now) ? { ...now, status: "done", options } : now)),
      (error) => {
        console.error("boarding options failed:", error);
        setPicking((now) => (now && same(now) ? { ...now, status: "failed" } : now));
      },
    );
  }

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
        const to = { id: null, name: trip.to.label, lat: trip.to.lat, lon: trip.to.lon };
        const trips = await planTrip(origin, to, new Date(trip.at ?? Date.now()));
        if (!cancelled) {
          setResult({ key, status: "done", trips, origin });
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
      <div
        key={chosen ? (shownPicking ? "boarding" : "detail") : "list"}
        className="flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain px-4 pb-4"
      >
        {shownPicking && selected ? (
          <BoardingList
            picking={shownPicking}
            onChoose={(choice) => {
              setEdited({ key, index: selected.index, trip: choice });
              setPicking(null);
            }}
            onCancel={() => setPicking(null)}
          />
        ) : chosen ? (
          <TripDetail
            trip={chosen}
            onBack={() => {
              setSelected(null);
              setEdited(null);
            }}
            onBoarding={current?.origin ? (leg) => pickBoarding(current.origin!, chosen, leg) : undefined}
          />
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
          <button type="button" onClick={() => onSelect(index)} className="flex w-full flex-col items-stretch gap-2 py-3 text-left">
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

function TripDetail({ trip, onBack, onBoarding }: { trip: Trip; onBack: () => void; onBoarding?: (leg: number) => void }) {
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
            <LegDetail leg={leg} last={index === trip.legs.length - 1} onBoarding={onBoarding && (() => onBoarding(index))} />
          </li>
        ))}
      </ol>
    </>
  );
}

function LegDetail({ leg, last, onBoarding }: { leg: TripLeg; last: boolean; onBoarding?: () => void }) {
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
      {onBoarding && (
        <button type="button" onClick={onBoarding} className="min-h-9 self-start text-sm font-medium text-blue-700 dark:text-blue-400">
          {strings.trip.otherStops}
        </button>
      )}
    </div>
  );
}

function BoardingList({ picking, onChoose, onCancel }: { picking: Picking; onChoose: (trip: Trip) => void; onCancel: () => void }) {
  const leg = picking.trip.legs[picking.leg];
  if (leg?.kind !== "ride") {
    return null;
  }
  return (
    <>
      <button type="button" onClick={onCancel} className="min-h-9 self-start font-medium text-blue-700 dark:text-blue-400">
        ‹ {strings.trip.journey}
      </button>
      <p className="flex items-center gap-2 font-semibold">
        {strings.trip.boardWhere} <LineBadge line={leg.line} />
      </p>
      {picking.status === "loading" ? (
        <p className="text-sm text-neutral-500 dark:text-neutral-400">{strings.trip.loadingStops}</p>
      ) : picking.status === "failed" ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {strings.trip.stopsFailed}
        </p>
      ) : picking.options.length <= 1 ? (
        <p className="text-sm text-neutral-600 dark:text-neutral-400">{strings.trip.noOtherStops}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-neutral-200 dark:divide-neutral-800">
          {picking.options.map((option, index) => (
            <li key={index}>
              <BoardingRow option={option} line={leg.line.id} arrive={picking.trip.arrive} onChoose={onChoose} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function BoardingRow({
  option,
  line,
  arrive,
  onChoose,
}: {
  option: BoardingChoice;
  line: string;
  arrive: number;
  onChoose: (trip: Trip) => void;
}) {
  const ride = option.trip.legs.findIndex((leg) => leg.kind === "ride" && leg.line.id === line && leg.from.id === option.stop.id);
  const before = option.trip.legs.slice(0, ride);
  const rides = before.flatMap((leg) => (leg.kind === "ride" ? [leg] : []));
  const walk = before.reduce((sum, leg) => sum + leg.arrive - leg.depart, 0);
  const delta = Math.round((option.trip.arrive - arrive) / 60_000);
  return (
    <button type="button" onClick={() => onChoose(option.trip)} className="flex w-full flex-col items-stretch gap-1 py-3 text-left">
      <span className="flex items-baseline justify-between gap-2">
        <span className={`min-w-0 truncate ${option.current ? "font-semibold" : ""}`}>{option.stop.name}</span>
        <span className="shrink-0 text-sm tabular-nums">
          {strings.trip.arrive} {clock(option.trip.arrive)}
        </span>
      </span>
      <span className="flex items-center justify-between gap-2 text-sm text-neutral-600 dark:text-neutral-400">
        <span className="flex flex-wrap items-center gap-1">
          {rides.length > 0
            ? rides.map((leg, index) => <LineBadge key={index} line={leg.line} />)
            : `🚶 ${minutes(walk)} ${strings.trip.minutes}`}
        </span>
        <span className="shrink-0 tabular-nums">
          {option.current
            ? strings.trip.current
            : delta === 0
              ? strings.trip.sameTime
              : `${delta > 0 ? "+" : "−"}${Math.abs(delta)} ${strings.trip.minutes}`}
        </span>
      </span>
    </button>
  );
}
