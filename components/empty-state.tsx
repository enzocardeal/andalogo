type EmptyStateProps = {
  title: string;
  hint?: string;
};

export function EmptyState({ title, hint }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed border-neutral-300 dark:border-neutral-700 px-4 py-8 text-center">
      <p className="font-medium text-neutral-700 dark:text-neutral-300">{title}</p>
      {hint && <p className="text-sm text-neutral-500 dark:text-neutral-400">{hint}</p>}
    </div>
  );
}
