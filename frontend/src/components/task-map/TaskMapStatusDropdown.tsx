import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { TaskMapOption, taskMapApi } from '@/api/taskMap';
import { Check, Search, Pencil, Plus, Trash2, X, ChevronDown, AlertTriangle } from 'lucide-react';
import { toast } from '@/lib/toast';
import { useAppStore } from '@/lib/store';

interface Props {
  selectedStatuses: string[];
  options: TaskMapOption[];
  onToggleStatus: (statusLabel: string) => void;
  onOptionsUpdated?: () => void;
  readOnly?: boolean;
}

/** True once the trigger is scrolled out of view of a scrolling ancestor (e.g. a TaskMap column or board). */
function isScrolledOutOfView(el: HTMLElement) {
  const rect = el.getBoundingClientRect();
  for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
    const { overflowX, overflowY } = getComputedStyle(p);
    if (!/(auto|scroll|hidden|clip)/.test(overflowX + overflowY)) continue;
    const box = p.getBoundingClientRect();
    if (rect.bottom <= box.top || rect.top >= box.bottom || rect.right <= box.left || rect.left >= box.right) return true;
  }
  return false;
}

export const TaskMapStatusDropdown: React.FC<Props> = ({
  selectedStatuses = [],
  options = [],
  onToggleStatus,
  onOptionsUpdated,
  readOnly = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [isEditMode, setIsEditMode] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newColor, setNewColor] = useState('#3b82f6');
  const [deleteWarning, setDeleteWarning] = useState<{ id: string; inUseCount: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const initialPosRef = useRef<{ top: number; left: number } | null>(null);

  const currentUser = useAppStore((s) => s.currentUser);
  const isAdmin = currentUser?.systemRole === 'ADMIN';

  // Calculate coordinates on open & handle scroll limit with smooth fade
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const initialRect = trigger.getBoundingClientRect();
    initialPosRef.current = { top: initialRect.top, left: initialRect.left };

    const dropdownWidth = 260;
    const dropdownHeight = 320;

    const calcPos = (rect: DOMRect) => {
      let top = rect.bottom + 4;
      if (top + dropdownHeight > window.innerHeight - 10) {
        top = Math.max(10, rect.top - dropdownHeight - 4);
      }

      let left = rect.right - dropdownWidth;
      if (left < 10) {
        left = Math.max(10, rect.left);
      }
      if (left + dropdownWidth > window.innerWidth - 10) {
        left = Math.max(10, window.innerWidth - dropdownWidth - 10);
      }
      return { top, left };
    };

    // Calculate initial coordinates for mount
    const initPos = calcPos(initialRect);
    setCoords(initPos);

    let rafId: number | null = null;

    const handleScrollOrUpdate = (isResize = false) => {
      if (!triggerRef.current) return;
      const curTrigger = triggerRef.current;
      const dropdown = dropdownRef.current;

      // Auto-dismiss if trigger scrolled completely out of view of its container
      if (isScrolledOutOfView(curTrigger)) {
        setIsOpen(false);
        setIsEditMode(false);
        return;
      }

      const curRect = curTrigger.getBoundingClientRect();

      if (initialPosRef.current && !isResize) {
        const deltaY = Math.abs(curRect.top - initialPosRef.current.top);
        const deltaX = Math.abs(curRect.left - initialPosRef.current.left);
        const maxDelta = Math.max(deltaX, deltaY);

        // Limit reached: automatically dismiss when scrolled >= 60px
        if (maxDelta >= 60) {
          setIsOpen(false);
          setIsEditMode(false);
          return;
        }

        // Smooth fade: fully visible 0-20px, linear fade between 20px and 60px
        const opacity = maxDelta <= 20 ? 1 : Math.max(0, 1 - (maxDelta - 20) / 40);
        if (dropdown) {
          dropdown.style.opacity = `${opacity}`;
          dropdown.style.pointerEvents = opacity < 0.2 ? 'none' : 'auto';
        }
      }

      // Reposition directly on DOM node to prevent main-thread layout thrashing and React re-renders
      const { top, left } = calcPos(curRect);
      if (dropdown) {
        dropdown.style.top = `${top}px`;
        dropdown.style.left = `${left}px`;
      }
    };

    const onScroll = () => {
      if (rafId !== null) return;
      rafId = requestAnimationFrame(() => {
        rafId = null;
        handleScrollOrUpdate(false);
      });
    };

    const onResize = () => {
      handleScrollOrUpdate(true);
    };

    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onScroll, true);

    const handleClickOutside = (e: MouseEvent) => {
      if (
        triggerRef.current &&
        !triggerRef.current.contains(e.target as Node) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        setIsEditMode(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll, true);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  const filteredOptions = options.filter((opt) =>
    opt.label.toLowerCase().includes(search.toLowerCase())
  );

  const handleCreateOption = async () => {
    if (!newLabel.trim()) return;
    try {
      await taskMapApi.upsertOption({
        label: newLabel.trim(),
        color: newColor,
        order: options.length,
      });
      setNewLabel('');
      toast.success('Status option added');
      if (onOptionsUpdated) onOptionsUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create option');
    }
  };

  const handleDeleteOption = async (id: string, force = false) => {
    try {
      const res = await taskMapApi.deleteOption(id, force);
      if (!res.success && res.inUseCount) {
        setDeleteWarning({ id, inUseCount: res.inUseCount });
        return;
      }
      setDeleteWarning(null);
      toast.success('Option deleted');
      if (onOptionsUpdated) onOptionsUpdated();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete option');
    }
  };

  const primaryStatus = selectedStatuses[0];
  const primaryOpt = primaryStatus ? options.find((o) => o.label.toLowerCase() === primaryStatus.toLowerCase()) : null;

  return (
    <>
      {/* Trigger Button: matches Image 2 spreadsheet pill with dropdown chevron */}
      <button
        ref={triggerRef}
        type="button"
        disabled={readOnly}
        onClick={(e) => {
          e.stopPropagation();
          if (!readOnly) setIsOpen(!isOpen);
        }}
        className={`w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-md text-[11px] font-semibold transition-all cursor-pointer select-none shadow-sm ${
          selectedStatuses.length === 0
            ? 'border border-dashed border-zinc-700/80 bg-[#111216] text-zinc-400 hover:border-zinc-500 hover:text-zinc-200'
            : 'border border-transparent'
        }`}
        style={
          primaryOpt
            ? { backgroundColor: primaryOpt.color, color: primaryOpt.textColor || '#ffffff' }
            : selectedStatuses.length > 0
            ? { backgroundColor: '#3f3f46', color: '#ffffff' }
            : {}
        }
      >
        <span className="truncate">
          {selectedStatuses.length === 0 ? 'Set status' : selectedStatuses[0]}
        </span>
        <div className="flex items-center gap-1 shrink-0 ml-1">
          {selectedStatuses.length > 1 && (
            <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-black/30">
              +{selectedStatuses.length - 1}
            </span>
          )}
          <ChevronDown className="size-3 opacity-80" />
        </div>
      </button>

      {/* Popover Dropdown portalled directly to document.body with maximum z-index */}
      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={dropdownRef}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              zIndex: 999999,
              transition: 'opacity 75ms ease-out',
            }}
            className="w-64 max-h-80 overflow-y-auto custom-scrollbar p-2 bg-[#18181c] border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            {/* Search Box */}
            <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded-lg text-xs mb-2">
              <Search className="size-3 text-zinc-500 shrink-0" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search statuses..."
                className="w-full bg-transparent text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none"
                autoFocus
              />
              {search && (
                <button type="button" onClick={() => setSearch('')} className="text-zinc-500 hover:text-zinc-300">
                  <X className="size-3" />
                </button>
              )}
            </div>

            {/* Warning when deleting */}
            {deleteWarning && (
              <div className="p-2 mb-2 rounded bg-amber-950/60 border border-amber-600/50 text-amber-200 text-xs">
                <p className="text-[11px] mb-1 font-semibold">
                  In use by {deleteWarning.inUseCount} tasks. Delete anyway?
                </p>
                <div className="flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() => setDeleteWarning(null)}
                    className="px-2 py-0.5 text-[10px] rounded hover:bg-zinc-800 text-zinc-400"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteOption(deleteWarning.id, true)}
                    className="px-2 py-0.5 text-[10px] rounded bg-red-600 text-white font-bold"
                  >
                    Delete
                  </button>
                </div>
              </div>
            )}

            {/* Status Options Chips List */}
            <div className="space-y-1 mb-2">
              {filteredOptions.length === 0 ? (
                <p className="text-xs text-zinc-500 p-2 italic text-center">No matching status</p>
              ) : (
                filteredOptions.map((opt) => {
                  const isSelected = selectedStatuses.includes(opt.label);
                  return (
                    <div
                      key={opt.id}
                      onClick={() => !isEditMode && onToggleStatus(opt.label)}
                      className={`flex items-center justify-between p-1.5 rounded-lg text-xs cursor-pointer transition-colors ${
                        isSelected ? 'bg-zinc-800/80 font-medium' : 'hover:bg-zinc-800/40'
                      }`}
                    >
                      <span
                        style={{ backgroundColor: opt.color, color: opt.textColor || '#ffffff' }}
                        className="px-2 py-0.5 rounded-md text-[10px] font-bold tracking-wide truncate max-w-[180px]"
                      >
                        {opt.label}
                      </span>

                      {isEditMode ? (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteOption(opt.id, false);
                          }}
                          className="text-red-400 hover:text-red-300 p-1"
                          title="Delete option"
                        >
                          <Trash2 className="size-3" />
                        </button>
                      ) : (
                        isSelected && <Check className="size-3.5 text-blue-400 shrink-0" />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {/* Admin Edit Controls */}
            {isAdmin && (
              <div className="border-t border-zinc-800/80 pt-2 mt-auto">
                {isEditMode ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="Option label..."
                        className="flex-1 bg-zinc-900 px-2 py-1 text-xs rounded border border-zinc-800 text-zinc-100 placeholder-zinc-500 focus:outline-none"
                      />
                      <input
                        type="color"
                        value={newColor}
                        onChange={(e) => setNewColor(e.target.value)}
                        className="size-5 bg-transparent border-none cursor-pointer rounded"
                      />
                      <button
                        type="button"
                        onClick={handleCreateOption}
                        className="p-1 rounded bg-blue-600 hover:bg-blue-500 text-white"
                      >
                        <Plus className="size-3" />
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => setIsEditMode(false)}
                      className="w-full text-center text-[10px] text-zinc-400 hover:text-zinc-200 py-0.5"
                    >
                      Done Editing
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => setIsEditMode(true)}
                    className="flex items-center gap-1.5 text-xs text-zinc-400 hover:text-white px-2 py-1 rounded hover:bg-zinc-800 w-full"
                  >
                    <Pencil className="size-3 text-zinc-500" />
                    <span>Edit Options</span>
                  </button>
                )}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
};
