export default function ListingCardSkeleton() {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm overflow-hidden">
      <div className="aspect-[4/3] bg-zinc-200 animate-pulse" />
      <div className="p-3 space-y-2">
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-3/4" />
        <div className="h-4 bg-zinc-200 rounded animate-pulse w-1/2" />
        <div className="h-5 bg-zinc-200 rounded animate-pulse w-1/3 mt-1" />
        <div className="h-3 bg-zinc-200 rounded animate-pulse w-2/3 mt-2" />
      </div>
    </div>
  );
}
