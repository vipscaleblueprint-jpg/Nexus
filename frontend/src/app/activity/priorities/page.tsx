'use client';

import { useAppStore } from '@/lib/store';
import { Loader2 } from 'lucide-react';
import DocPage from '@/app/docs/[id]/page';

export default function PrioritiesPage() {
  const { allDocs } = useAppStore();
  const priorityDoc = allDocs.find((d: any) => d.doc.isDailyRollover === true);

  if (!priorityDoc) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 h-full bg-[#0E0E10] text-zinc-400">
        <Loader2 className="w-6 h-6 animate-spin mb-4" />
        <p>Waiting for daily rollover worker to initialize priorities...</p>
      </div>
    );
  }

  // Literally render the exact same DocPage component, just passing the ID manually
  // This satisfies the requirement of "not creating a new one" and "just using the docs design".
  return <DocPage docId={priorityDoc.doc.id} />;
}
