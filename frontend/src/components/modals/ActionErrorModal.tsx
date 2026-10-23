'use client';

import React, { useState } from 'react';
import { AlertCircle, X, Copy, Check, RefreshCw, ChevronDown, ChevronUp, Terminal, HelpCircle } from 'lucide-react';

export interface ActionErrorInfo {
  title: string;
  action: string;
  message: string;
  statusCode?: number | string;
  technicalDetails?: string;
  context?: Record<string, any>;
  troubleshooting?: string[];
  onRetry?: () => void | Promise<void>;
}

interface ActionErrorModalProps {
  isOpen: boolean;
  onClose: () => void;
  error: ActionErrorInfo | null;
}

export function ActionErrorModal({ isOpen, onClose, error }: ActionErrorModalProps) {
  const [copied, setCopied] = useState(false);
  const [showTechnicalDetails, setShowTechnicalDetails] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);

  if (!isOpen || !error) return null;

  const handleCopy = () => {
    const payload = {
      title: error.title,
      action: error.action,
      message: error.message,
      statusCode: error.statusCode,
      context: error.context,
      technicalDetails: error.technicalDetails,
      timestamp: new Date().toISOString(),
    };

    navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRetry = async () => {
    if (!error.onRetry) return;
    try {
      setIsRetrying(true);
      await error.onRetry();
      onClose();
    } catch (err) {
      console.error('Retry failed:', err);
    } finally {
      setIsRetrying(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[100005] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="w-full max-w-lg bg-[#141518] border border-red-950/60 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8),0_0_30px_rgba(239,68,68,0.1)] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-red-950/50 bg-gradient-to-r from-red-950/30 via-zinc-900/50 to-zinc-900/40">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 shrink-0">
              <AlertCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                {error.title || 'Action Failed'}
                {error.statusCode && (
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded-full bg-red-500/15 border border-red-500/30 text-red-400">
                    HTTP {error.statusCode}
                  </span>
                )}
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                Target Action: <span className="text-zinc-200 font-medium">{error.action}</span>
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-md text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex flex-col gap-4 text-sm max-h-[70vh] overflow-y-auto custom-scrollbar">
          {/* Main Error Message Box */}
          <div className="p-3.5 rounded-lg bg-red-950/20 border border-red-900/30 text-red-200 text-xs leading-relaxed font-mono break-words">
            <div className="font-semibold text-red-400 uppercase tracking-wider text-[10px] mb-1">
              Error Message
            </div>
            {error.message || 'An unexpected error occurred while executing this action.'}
          </div>

          {/* Context Details */}
          {error.context && Object.keys(error.context).length > 0 && (
            <div className="flex flex-col gap-1.5 p-3 rounded-lg bg-zinc-900/60 border border-zinc-800 text-xs">
              <span className="text-[10px] uppercase font-semibold text-zinc-400 tracking-wider">
                Context Parameters
              </span>
              <div className="grid grid-cols-2 gap-2 mt-1">
                {Object.entries(error.context).map(([key, val]) => (
                  <div key={key} className="flex flex-col bg-zinc-950/50 p-2 rounded border border-zinc-800/80">
                    <span className="text-[10px] text-zinc-500 uppercase">{key}</span>
                    <span className="font-mono text-zinc-300 truncate" title={String(val)}>
                      {String(val || '—')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Troubleshooting Hints */}
          {error.troubleshooting && error.troubleshooting.length > 0 && (
            <div className="flex flex-col gap-2 p-3.5 rounded-lg bg-zinc-900/40 border border-zinc-800/80 text-xs">
              <div className="flex items-center gap-1.5 text-zinc-300 font-semibold text-[11px] uppercase tracking-wide">
                <HelpCircle className="w-3.5 h-3.5 text-indigo-400" />
                Troubleshooting & Causes
              </div>
              <ul className="flex flex-col gap-1.5 pl-4 list-disc text-zinc-400 text-xs leading-relaxed">
                {error.troubleshooting.map((hint, idx) => (
                  <li key={idx} className="marker:text-zinc-600">
                    {hint}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Technical Details Toggle */}
          {error.technicalDetails && (
            <div className="flex flex-col border border-zinc-800/90 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setShowTechnicalDetails(prev => !prev)}
                className="flex items-center justify-between px-3 py-2 bg-zinc-900/70 hover:bg-zinc-900 text-xs text-zinc-300 font-medium transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Terminal className="w-3.5 h-3.5 text-zinc-400" />
                  <span>Technical Diagnostics & Stack</span>
                </div>
                {showTechnicalDetails ? (
                  <ChevronUp className="w-4 h-4 text-zinc-400" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-zinc-400" />
                )}
              </button>
              {showTechnicalDetails && (
                <div className="p-3 bg-zinc-950/80 font-mono text-[11px] text-zinc-400 overflow-x-auto whitespace-pre-wrap max-h-40 custom-scrollbar border-t border-zinc-800/60">
                  {error.technicalDetails}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-5 py-3 border-t border-zinc-800 bg-zinc-900/50">
          <button
            type="button"
            onClick={handleCopy}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-300 hover:text-white bg-zinc-800/80 hover:bg-zinc-700/80 transition-colors border border-zinc-700/50"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied Details</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-zinc-400" />
                <span>Copy Error Report</span>
              </>
            )}
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 text-xs font-semibold text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
            >
              Close
            </button>
            {error.onRetry && (
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying}
                className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-white bg-red-600 hover:bg-red-500 rounded-lg transition-colors shadow-sm disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>{isRetrying ? 'Retrying…' : 'Retry'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
