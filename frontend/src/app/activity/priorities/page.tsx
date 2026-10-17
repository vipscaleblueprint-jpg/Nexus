'use client';

import { useEffect, useState } from 'react';
import { useAppStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';
import DocPage from '@/app/docs/[id]/page';

// ---------------------------------------------------------------------------
// localStorage key that caches the daily-rollover doc ID across sessions.
// IMPORTANT: useState must always initialise to null (server-safe) — we read
// localStorage only inside useEffect so the server and client render the same
// initial HTML and avoid a React hydration mismatch.
// ---------------------------------------------------------------------------
const DAILY_ROLLOVER_DOC_CACHE_KEY = 'nexus_daily_rollover_doc_id';

function getCachedDocId(): string | null {
  try {
    return localStorage.getItem(DAILY_ROLLOVER_DOC_CACHE_KEY);
  } catch {
    return null;
  }
}

function setCachedDocId(id: string): void {
  try {
    localStorage.setItem(DAILY_ROLLOVER_DOC_CACHE_KEY, id);
  } catch {}
}

export default function PrioritiesPage() {
  const { allDocs, loadSpaces, loadingSpaces, hasLoadedSpaces, hydrateFromCache } = useAppStore();

  // Always null on first render (matches server HTML) — populated from
  // localStorage in useEffect below after hydration completes.
  const [docId, setDocId] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // ── Step 1: Read localStorage after hydration (client-only) ──
  useEffect(() => {
    const cached = getCachedDocId();
    if (cached) setDocId(cached);
    setHydrated(true);

    // Hydrate the Zustand store from its own localStorage cache
    hydrateFromCache();

    // Only hit the API when spaces haven't been loaded yet
    if (!hasLoadedSpaces && !loadingSpaces) {
      loadSpaces();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 2: Whenever allDocs resolves, update & persist the docId ──
  useEffect(() => {
    if (!allDocs?.length) return;

    const latest = allDocs
      .filter((d: any) => d.doc.isDailyRollover === true)
      .sort(
        (a: any, b: any) =>
          new Date(b.doc.createdAt || 0).getTime() -
          new Date(a.doc.createdAt || 0).getTime()
      )[0];

    if (latest?.doc?.id) {
      setDocId((prev) => {
        // Only update state when the ID actually changed to avoid re-renders
        if (prev !== latest.doc.id) return latest.doc.id;
        return prev;
      });
      setCachedDocId(latest.doc.id);
    }
  }, [allDocs]);

  // ── Case 1: Not yet hydrated — show spinner (matches server render) ──
  if (!hydrated) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-background text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin mb-4 text-indigo-500" />
        <p className="text-sm">Loading your journal...</p>
      </div>
    );
  }

  // ── Case 2: Hydrated and we have a docId (from cache or store) ──
  if (docId) {
    return <DocPage docId={docId} />;
  }

  // ── Case 3: Hydrated, no cache, still waiting for spaces to load ──
  if (!hasLoadedSpaces || loadingSpaces) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-background text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin mb-4 text-indigo-500" />
        <p className="text-sm">Loading your journal...</p>
      </div>
    );
  }

  // ── Case 4: Spaces loaded but no daily rollover doc found ──
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-background text-zinc-400">
      <Loader2 className="w-6 h-6 animate-spin mb-4" />
      <p>Waiting for daily rollover worker to initialize priorities...</p>
    </div>
  );
}
