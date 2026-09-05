'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { authApi, spacesApi } from '@/api';
import { useAppStore } from '@/lib/store';
import {
  FileText,
  ChevronRight,
  ChevronDown,
  Plus,
  Loader2,
  FileCode,
} from 'lucide-react';

function PageTreeNode({ page, depth = 0 }: { page: any; depth?: number }) {
  const [open, setOpen] = useState(true);
  const hasChildren = page.subpages && page.subpages.length > 0;

  return (
    <div>
      <div
        className="flex items-center gap-1.5 px-3 py-2 rounded-lg hover:bg-zinc-800/60 cursor-pointer group transition-colors"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
        onClick={() => setOpen(!open)}
      >
        <div className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
          {hasChildren ? (
            open ? (
              <ChevronDown className="w-3 h-3 text-zinc-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-zinc-500" />
            )
          ) : (
            <span className="w-1 h-1 rounded-full bg-zinc-600 inline-block" />
          )}
        </div>
        <FileCode className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
        <span className="text-sm text-zinc-200 truncate">{page.title}</span>
        {page.content && (
          <span className="text-[10px] text-zinc-600 ml-auto shrink-0 opacity-0 group-hover:opacity-100">
            {page.content.length > 0 ? `${Math.ceil(page.content.length / 200)} min read` : 'Empty'}
          </span>
        )}
      </div>

      {/* Page content preview */}
      {open && page.content && (
        <div
          className="mx-3 mb-1 px-3 py-2 bg-zinc-900/40 border border-zinc-800/60 rounded-lg"
          style={{ marginLeft: `${12 + depth * 16 + 20}px` }}
        >
          <p className="text-xs text-zinc-500 leading-relaxed line-clamp-3 whitespace-pre-wrap">
            {page.content || <span className="italic">Empty page</span>}
          </p>
        </div>
      )}

      {/* Subpages */}
      {open && hasChildren && (
        <div>
          {page.subpages.map((sub: any) => (
            <PageTreeNode key={sub.id} page={sub} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DocPage() {
  const { id } = useParams<{ id: string }>();
  const { currentUser, setCurrentUser } = useAppStore();
  const [doc, setDoc] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!currentUser) {
        try {
          const { user } = await authApi.getMe();
          if (!cancelled && user) setCurrentUser(user);
        } catch {}
      }

      try {
        const docRes = await spacesApi.getDoc(id);
        if (!cancelled) {
          setDoc(docRes.doc);
        }
      } catch (e: any) {
        if (!cancelled) setError(e.message || 'Failed to load document');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, currentUser, setCurrentUser]);

  const breadcrumb = [doc?.space?.name, doc?.folder?.name, doc?.title]
    .filter(Boolean)
    .join(' / ');

  const totalPages = doc?.pages?.reduce(
    (acc: number, p: any) => acc + 1 + (p.subpages?.length ?? 0),
    0
  ) ?? 0;

  return (
    <>
      {loading ? (
            <div className="flex items-center justify-center h-full">
              <Loader2 className="w-6 h-6 animate-spin text-zinc-500" />
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full text-red-400 text-sm">{error}</div>
          ) : (
            <div className="max-w-3xl mx-auto px-6 py-6">
              {/* Header */}
              <div className="mb-8">
                <p className="text-[11px] text-zinc-500 mb-2">{breadcrumb}</p>
                <div className="flex items-center gap-3 mb-1">
                  <div className="p-2 rounded-lg bg-purple-500/15">
                    <FileText className="w-5 h-5 text-purple-400" />
                  </div>
                  <h1 className="text-2xl font-semibold text-zinc-100">{doc?.title}</h1>
                </div>
                <div className="flex items-center gap-3 ml-1 text-[11px] text-zinc-500">
                  <span>{totalPages} page{totalPages !== 1 ? 's' : ''}</span>
                  {doc?.docDate && (
                    <>
                      <span>·</span>
                      <span>{new Date(doc.docDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Pages */}
              {doc?.pages?.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-zinc-600">
                  <FileText className="w-10 h-10 mb-3 opacity-40" />
                  <p className="text-sm font-medium">No pages yet</p>
                  <p className="text-xs mt-1">Add pages to this document from the sidebar</p>
                </div>
              ) : (
                <div className="border border-zinc-800 rounded-xl overflow-hidden bg-zinc-900/30">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-zinc-800 bg-zinc-900/60">
                    <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">Pages</span>
                    <button className="flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors">
                      <Plus className="w-3 h-3" />
                      Add Page
                    </button>
                  </div>
                  <div className="py-1">
                    {doc?.pages?.map((page: any) => (
                      <PageTreeNode key={page.id} page={page} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
    </>
  );
}
