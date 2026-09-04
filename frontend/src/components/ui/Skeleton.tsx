'use client';

export function Skeleton({ className = '' }: { className?: string }) {
  return (
    <div
      className={`animate-pulse rounded-lg bg-zinc-800/60 border border-zinc-700/30 ${className}`}
    />
  );
}

export function CardSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 space-y-3 shadow-lg">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Skeleton className="w-8 h-8 rounded-lg" />
          <Skeleton className="w-32 h-4" />
        </div>
        <Skeleton className="w-12 h-4 rounded-full" />
      </div>
      <Skeleton className="w-full h-3" />
      <Skeleton className="w-3/4 h-3" />
      <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between">
        <Skeleton className="w-20 h-3" />
        <Skeleton className="w-16 h-3" />
      </div>
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="p-6 space-y-6 animate-pulse">
      {/* Top Banner Skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="w-48 h-7" />
          <Skeleton className="w-72 h-4" />
        </div>
        <Skeleton className="w-28 h-9 rounded-lg" />
      </div>

      {/* Metrics Row Skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 space-y-2">
            <Skeleton className="w-20 h-3" />
            <Skeleton className="w-12 h-6" />
          </div>
        ))}
      </div>

      {/* Main Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <CardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
