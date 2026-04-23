export default function ListingCardSkeleton() {
  return (
    <div className="panel clip-corner overflow-hidden">
      <div className="aspect-[4/3] animate-pulse bg-[var(--bg-panel-hi)]" />
      <div className="space-y-2 p-3.5 pb-4">
        <div className="h-4 w-3/4 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
        <div className="h-4 w-1/2 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
        <div className="mt-1 h-5 w-1/3 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
        <div className="mt-2 h-3 w-2/3 animate-pulse rounded bg-[var(--bg-panel-hi)]" />
      </div>
    </div>
  );
}
