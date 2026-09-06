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

export function ListRowSkeleton() {
  return (
    <div className="grid grid-cols-[1fr_140px_120px_100px] px-4 py-3 border-b border-zinc-800/60 items-center gap-4">
      <div className="flex items-center gap-2.5">
        <Skeleton className="w-4 h-4 rounded" />
        <Skeleton className="w-48 h-4" />
      </div>
      <div className="flex items-center gap-2">
        <Skeleton className="w-5 h-5 rounded-full" />
        <Skeleton className="w-20 h-3" />
      </div>
      <Skeleton className="w-16 h-3" />
      <Skeleton className="w-14 h-4 rounded" />
    </div>
  );
}

export function ListSkeleton() {
  return (
    <div className="w-full h-full flex flex-col px-6 py-6 space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="w-36 h-3" />
        <div className="flex items-center gap-3">
          <Skeleton className="w-9 h-9 rounded-lg" />
          <Skeleton className="w-56 h-6" />
          <Skeleton className="w-20 h-5 rounded-full" />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-4 border-b border-zinc-800 pb-3">
        <Skeleton className="w-24 h-5" />
        <Skeleton className="w-20 h-5" />
      </div>

      {/* Table Rows Skeleton */}
      <div className="border border-zinc-800 rounded-lg overflow-hidden bg-zinc-900/30 space-y-1">
        <div className="grid grid-cols-[1fr_140px_120px_100px] bg-zinc-900/80 px-4 py-2.5">
          <Skeleton className="w-16 h-3" />
          <Skeleton className="w-16 h-3" />
          <Skeleton className="w-16 h-3" />
          <Skeleton className="w-16 h-3" />
        </div>
        {[1, 2, 3, 4, 5].map((i) => (
          <ListRowSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}

export function DocSkeleton() {
  return (
    <div className="flex h-full w-full bg-[#0d0d0d] overflow-hidden font-sans select-none">
      {/* Sub-Sidebar Skeleton */}
      <aside className="w-60 shrink-0 bg-[#141414] border-r border-zinc-800/60 p-4 flex flex-col h-full space-y-4">
        <div className="pb-3 border-b border-zinc-800/60 space-y-2">
          <Skeleton className="w-16 h-3" />
          <Skeleton className="w-36 h-5" />
        </div>
        <div className="flex justify-between items-center px-1">
          <Skeleton className="w-12 h-3" />
          <Skeleton className="w-4 h-3" />
        </div>
        <div className="space-y-2 flex-1">
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-1.5" style={{ paddingLeft: `${(i % 2) * 12 + 8}px` }}>
              <Skeleton className="w-3.5 h-3.5 rounded shrink-0" />
              <Skeleton className="w-28 h-3.5" />
            </div>
          ))}
        </div>
      </aside>

      {/* Main Viewport Skeleton */}
      <main className="flex-1 overflow-y-auto bg-[#0d0d0d] p-8">
        <div className="max-w-4xl mx-auto space-y-6">
          {/* Top Actions Bar */}
          <div className="flex justify-between items-center pb-3 border-b border-zinc-800/40">
            <Skeleton className="w-32 h-4" />
            <div className="flex gap-3">
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-4 h-4 rounded" />
              <Skeleton className="w-4 h-4 rounded" />
            </div>
          </div>

          {/* Title & Metadata */}
          <div className="space-y-3">
            <Skeleton className="w-64 h-9 rounded-md" />
            <div className="flex items-center gap-2">
              <Skeleton className="w-5 h-5 rounded-full" />
              <Skeleton className="w-20 h-3" />
              <Skeleton className="w-36 h-3" />
            </div>
          </div>

          {/* Content Lines Skeleton */}
          <div className="space-y-6 pt-4">
            <div className="space-y-3">
              <Skeleton className="w-56 h-6 rounded" />
              <div className="space-y-2">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div key={i} className="flex items-center justify-between py-1 px-2">
                    <div className="flex items-center gap-3 flex-1">
                      <Skeleton className="w-4 h-4 rounded-full shrink-0" />
                      <Skeleton className={`h-4 rounded ${i % 2 === 0 ? 'w-80' : 'w-60'}`} />
                      <Skeleton className="w-14 h-4 rounded shrink-0" />
                      <Skeleton className="w-4 h-4 rounded-full shrink-0" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Skeleton className="w-44 h-6 rounded" />
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="flex items-center justify-between py-1 px-2">
                    <div className="flex items-center gap-3 flex-1">
                      <Skeleton className="w-4 h-4 rounded-full shrink-0" />
                      <Skeleton className={`h-4 rounded ${i % 2 === 0 ? 'w-72' : 'w-52'}`} />
                      <Skeleton className="w-14 h-4 rounded shrink-0" />
                      <Skeleton className="w-4 h-4 rounded-full shrink-0" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export function BoardSkeleton() {
  return (
    <div className="flex gap-4 overflow-x-auto p-6">
      {[1, 2, 3, 4].map((col) => (
        <div key={col} className="w-72 shrink-0 bg-zinc-900/50 border border-zinc-800 rounded-xl p-3 space-y-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <Skeleton className="w-28 h-4" />
            <Skeleton className="w-6 h-6 rounded-full" />
          </div>
          {[1, 2, 3].map((card) => (
            <div key={card} className="p-3 bg-zinc-800/40 rounded-lg space-y-2 border border-zinc-700/30">
              <Skeleton className="w-full h-4" />
              <Skeleton className="w-3/4 h-3" />
              <div className="flex justify-between items-center pt-2">
                <Skeleton className="w-6 h-6 rounded-full" />
                <Skeleton className="w-12 h-3" />
              </div>
            </div>
          ))}
        </div>
      ))}
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

export function MemberSkeleton() {
  return (
    <div className="p-4 rounded-xl bg-[#18181c] border border-zinc-800/80 space-y-3 flex flex-col items-center text-center">
      <Skeleton className="w-14 h-14 rounded-full" />
      <Skeleton className="w-28 h-4 mt-1" />
      <Skeleton className="w-36 h-3" />
      <Skeleton className="w-16 h-5 rounded-full mt-2" />
    </div>
  );
}

export function SettingsSkeleton() {
  return (
    <div className="max-w-4xl mx-auto p-6 space-y-8 animate-pulse">
      <div className="space-y-2">
        <Skeleton className="w-44 h-7" />
        <Skeleton className="w-72 h-4" />
      </div>
      <div className="p-6 rounded-xl bg-[#18181c] border border-zinc-800/80 space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="w-16 h-16 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="w-32 h-4" />
            <Skeleton className="w-48 h-3" />
          </div>
        </div>
        <div className="space-y-4">
          <Skeleton className="w-full h-10 rounded-lg" />
          <Skeleton className="w-full h-10 rounded-lg" />
          <Skeleton className="w-32 h-9 rounded-lg" />
        </div>
      </div>
    </div>
  );
}

export function SidebarSkeleton() {
  return (
    <div className="space-y-2 px-3 py-2">
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="flex items-center gap-2.5 px-2 py-2">
          <Skeleton className="w-4 h-4 rounded" />
          <Skeleton className="w-28 h-3.5" />
        </div>
      ))}
    </div>
  );
}
