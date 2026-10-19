import { strings } from "@/lib/strings";

export function DirectionsButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mt-2 min-h-9 self-start rounded-full border border-blue-600 px-3 text-sm font-medium text-blue-700 dark:border-blue-400 dark:text-blue-400"
    >
      {strings.trip.directions}
    </button>
  );
}
