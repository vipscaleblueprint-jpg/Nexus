'use client';

import { useRef, useState } from 'react';
import { X, FileText, FileCode, Hash, Printer, Layers, BookOpen, File, Scissors } from 'lucide-react';
import { IMPORT_ACCEPT, type ImportKind } from './docTransfer';

export type ExportScope = 'page' | 'doc';
export type ExportFormat = 'pdf' | 'html' | 'markdown' | 'print';

interface DocTransferPanelProps {
  onClose: () => void;
  onExport: (scope: ExportScope, format: ExportFormat) => Promise<void> | void;
  onImport: (kind: ImportKind, files: File[]) => Promise<string>;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-[11px] font-medium text-zinc-500 mt-3 mb-1 px-2">{children}</div>;
}

function Row({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-zinc-300 hover:bg-zinc-800/60 hover:text-zinc-100 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-default"
    >
      <span className="text-zinc-500">{icon}</span>
      {label}
    </button>
  );
}

function Radio({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={checked} onClick={onClick} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
      <span className={`w-3.5 h-3.5 rounded-full border flex items-center justify-center ${checked ? 'border-indigo-500' : 'border-zinc-600'}`}>
        {checked && <span className="w-2 h-2 rounded-full bg-indigo-500" />}
      </span>
      {label}
    </button>
  );
}

export function DocTransferPanel({ onClose, onExport, onImport }: DocTransferPanelProps) {
  const [scope, setScope] = useState<ExportScope>('page');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingKindRef = useRef<ImportKind | null>(null);

  const iconClass = 'w-3.5 h-3.5';

  const runExport = async (format: ExportFormat) => {
    setBusy(true);
    setStatus(null);
    try {
      await onExport(scope, format);
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : 'Export failed' });
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = (kind: ImportKind) => {
    const input = fileInputRef.current;
    if (!input) return;
    pendingKindRef.current = kind;
    input.accept = IMPORT_ACCEPT[kind];
    input.value = '';
    input.click();
  };

  const handleFiles = async (files: FileList | null) => {
    const kind = pendingKindRef.current;
    if (!files || files.length === 0 || !kind) return;
    setBusy(true);
    setStatus(null);
    try {
      const message = await onImport(kind, Array.from(files));
      setStatus({ tone: 'ok', text: message });
    } catch (err) {
      setStatus({ tone: 'error', text: err instanceof Error ? err.message : 'Import failed' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <aside className="w-72 shrink-0 h-full bg-card border-l border-zinc-800/60 flex flex-col select-none">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800/60">
        <h3 className="text-sm font-semibold text-zinc-200">Export</h3>
        <button onClick={onClose} className="p-1 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors cursor-pointer" title="Close">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="px-2 pt-3 pb-3 border-b border-zinc-800/60">
          <div role="radiogroup" className="flex items-center gap-6 px-2">
            <Radio checked={scope === 'page'} label="This page" onClick={() => setScope('page')} />
            <Radio checked={scope === 'doc'} label="Entire Doc" onClick={() => setScope('doc')} />
          </div>

          <SectionLabel>Export as</SectionLabel>
          <Row icon={<FileText className={iconClass} />} label="PDF" onClick={() => runExport('pdf')} disabled={busy} />
          <Row icon={<FileCode className={iconClass} />} label="HTML" onClick={() => runExport('html')} disabled={busy} />
          <Row icon={<Hash className={iconClass} />} label="Markdown" onClick={() => runExport('markdown')} disabled={busy} />
          <Row icon={<Printer className={iconClass} />} label="Print" onClick={() => runExport('print')} disabled={busy} />
        </div>

        <div className="px-2 pt-3 pb-4">
          <h3 className="text-sm font-semibold text-zinc-200 px-2">Import</h3>
          <p className="text-[11px] text-zinc-500 px-2 mt-0.5">Each file becomes a new page in this doc.</p>

          <SectionLabel>From another tool</SectionLabel>
          <Row icon={<Layers className={iconClass} />} label="Confluence (.html export)" onClick={() => pickFiles('confluence')} disabled={busy} />
          <Row icon={<BookOpen className={iconClass} />} label="Notion (.md / .html export)" onClick={() => pickFiles('notion')} disabled={busy} />

          <SectionLabel>Files</SectionLabel>
          <Row icon={<File className={iconClass} />} label="Document files (.txt, .md, .html)" onClick={() => pickFiles('document')} disabled={busy} />
          <Row icon={<FileCode className={iconClass} />} label="HTML" onClick={() => pickFiles('html')} disabled={busy} />
          <Row icon={<Scissors className={iconClass} />} label="HTML with Page Splitting" onClick={() => pickFiles('html-split')} disabled={busy} />
          <Row icon={<Hash className={iconClass} />} label="Markdown" onClick={() => pickFiles('markdown')} disabled={busy} />

          {(busy || status) && (
            <p className={`text-[11px] px-2 mt-3 ${busy ? 'text-zinc-400' : status?.tone === 'error' ? 'text-red-400' : 'text-emerald-400'}`}>
              {busy ? 'Working…' : status?.text}
            </p>
          )}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => handleFiles(e.target.files)}
      />
    </aside>
  );
}
