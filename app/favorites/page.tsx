import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { moveFavorite, removeFavorite } from "@/app/favorites/actions";
import { signOut } from "@/app/auth/actions";
import { EmptyState } from "@/components/empty-state";
import { LineBadge } from "@/components/line-badge";
import { ListSkeleton } from "@/components/skeleton";
import { LineSummary } from "@/components/line-summary";
import { mapHref } from "@/lib/map-view";
import { strings } from "@/lib/strings";
import { createClient } from "@/lib/supabase/server";
import type { Favorite } from "@/lib/transit";
import { LogoutButton } from "../logout-button";

const LINES_PER_FAVORITE = 4;

export default function FavoritesPage() {
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-6 px-4 py-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-3xl font-semibold">{strings.app.name}</h1>
        <form action={signOut}>
          <LogoutButton />
        </form>
      </div>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{strings.favorites.title}</h2>
        <Suspense fallback={<ListSkeleton />}>
          <Favorites />
        </Suspense>
      </section>
    </main>
  );
}

async function Favorites() {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_favorites");
  if (error) {
    throw error;
  }
  const favorites = (data ?? []) as Favorite[];
  if (favorites.length === 0) {
    return <EmptyState title={strings.favorites.empty} hint={strings.favorites.emptyHint} />;
  }

  return (
    <ul className="flex flex-col gap-3">
      {favorites.map((favorite, index) => (
        <li key={favorite.stop_id} className="flex flex-col rounded-lg border border-neutral-200 dark:border-neutral-800">
          <FavoriteCard favorite={favorite} />
          <div className="flex border-t border-neutral-200 dark:border-neutral-800 text-sm font-medium text-neutral-600 dark:text-neutral-400">
            <FavoriteButton action={moveFavorite} stopId={favorite.stop_id} delta="-1" disabled={index === 0}>
              ↑ <span className="sr-only">{strings.favorites.moveUp}</span>
            </FavoriteButton>
            <FavoriteButton
              action={moveFavorite}
              stopId={favorite.stop_id}
              delta="1"
              disabled={index === favorites.length - 1}
            >
              ↓ <span className="sr-only">{strings.favorites.moveDown}</span>
            </FavoriteButton>
            <FavoriteButton action={removeFavorite} stopId={favorite.stop_id}>
              {strings.favorites.remove}
            </FavoriteButton>
          </div>
        </li>
      ))}
    </ul>
  );
}

function FavoriteCard({ favorite }: { favorite: Favorite }) {
  const { stop } = favorite;
  if (!stop) {
    return <p className="p-3 text-neutral-500 dark:text-neutral-400">{strings.favorites.removedStop}</p>;
  }
  const hidden = stop.lines.length - LINES_PER_FAVORITE;
  const now = new Date();
  return (
    <Link href={mapHref({ stop: stop.id, route: null, dir: 0 })} className="flex flex-col gap-2 p-3">
      <span className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium">{stop.name}</span>
        <span className="shrink-0 text-sm text-neutral-500 dark:text-neutral-400">{strings.modes[stop.mode]}</span>
      </span>
      <ul className="flex flex-col gap-1.5">
        {stop.lines.slice(0, LINES_PER_FAVORITE).map((line) => (
          <li key={`${line.route_id}:${line.direction_id}`} className="flex items-center gap-2 text-sm">
            <LineBadge line={line} />
            <LineSummary line={line} now={now} />
          </li>
        ))}
      </ul>
      {hidden > 0 && (
        <span className="text-sm text-neutral-500 dark:text-neutral-400">
          +{hidden} {strings.favorites.moreLines}
        </span>
      )}
    </Link>
  );
}

function FavoriteButton({
  action,
  stopId,
  delta,
  disabled = false,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  stopId: string;
  delta?: string;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <form action={action} className="flex flex-1 border-l border-neutral-200 dark:border-neutral-800 first:border-l-0">
      <input type="hidden" name="stopId" value={stopId} />
      {delta && <input type="hidden" name="delta" value={delta} />}
      <button type="submit" disabled={disabled} className="min-h-11 flex-1 disabled:opacity-30">
        {children}
      </button>
    </form>
  );
}
