import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { fetchListStatuses } from '@/lib/listStatusCache';
import { ALL_STATUSES, STATUS_COLORS, isClosedStatus, sortStatusesWithClosedAndKycAtEnd, CustomCircleDot, CustomCircleDotted } from '@/lib/taskTokens';
import { tasksApi } from '@/api';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';
import { Check, ChevronDown, CheckCircle2 } from 'lucide-react';

interface Props {
  taskId: string;
  currentStatus: string;
  listId?: string;
  onStatusChanged?: (newStatus: string) => void;
  disabled?: boolean;
}

const getStatusColor = (status: string, customList?: any[]) => {
  if (!status) return '#3b82f6';
  const custom = (customList || []).find((s) => (s.name || s.status || s.title || '').toUpperCase() === status.toUpperCase());
  if (custom?.color) return custom.color;
  return STATUS_COLORS[status.toUpperCase()] ? '#3b82f6' : '#3b82f6';
};

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

export const TaskWorkflowStatusDropdown: React.FC<Props> = ({
  taskId,
  currentStatus = 'PENDING',
  listId,
  onStatusChanged,
  disabled = false,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [listStatuses, setListStatuses] = useState<any[]>([]);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const initialPosRef = useRef<{ top: number; left: number } | null>(null);

  const currentUser = useAppStore((s) => s.currentUser);

  // Load list statuses
  useEffect(() => {
    let mounted = true;
    if (listId) {
      fetchListStatuses(listId).then((res) => {
        if (mounted && Array.isArray(res) && res.length > 0) {
          setListStatuses(res);
        }
      }).catch(() => {});
    }
    return () => {
      mounted = false;
    };
  }, [listId]);

  // Position portal dropdown & handle scroll limit with smooth fade
  useEffect(() => {
    if (!isOpen || !triggerRef.current) return;

    const trigger = triggerRef.current;
    const initialRect = trigger.getBoundingClientRect();
    initialPosRef.current = { top: initialRect.top, left: initialRect.left };

    const dropdownWidth = 190;
    const dropdownHeight = 240;

    const calcPos = (rect: DOMRect) => {
      let top = rect.bottom + 4;
      if (top + dropdownHeight > window.innerHeight - 10) {
        top = Math.max(10, rect.top - dropdownHeight - 4);
      }

      let left = rect.left;
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

  const orderedStatuses = React.useMemo(() => {
    const raw = listStatuses.length > 0
      ? listStatuses.map((s: any) => s.name || s.status || s.title || '')
      : ALL_STATUSES;
    return sortStatusesWithClosedAndKycAtEnd(raw);
  }, [listStatuses]);

  const handleSelectStatus = async (newStatus: string) => {
    if (newStatus.toUpperCase() === (currentStatus || '').toUpperCase()) {
      setIsOpen(false);
      return;
    }

    try {
      await tasksApi.updateTask(taskId, {
        status: newStatus,
        userId: currentUser?.id,
      });
      toast.success(`Status updated to ${newStatus}`);
      onStatusChanged?.(newStatus);
      window.dispatchEvent(new CustomEvent('task:updated', { detail: { id: taskId, status: newStatus } }));
      window.dispatchEvent(new CustomEvent('task_map:updated'));
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status');
    } finally {
      setIsOpen(false);
    }
  };

  const currentStatusClean = (currentStatus || 'In progress').trim();
  const isClosed = isClosedStatus(currentStatusClean);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={(e) => {
          e.stopPropagation();
          setIsOpen(!isOpen);
        }}
        className="w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-md text-[11px] font-medium bg-zinc-900 hover:bg-zinc-800 text-zinc-200 border border-zinc-800/80 hover:border-zinc-700 transition-all cursor-pointer select-none"
      >
        <span className="flex items-center gap-1.5 truncate">
          {isClosed ? (
            <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
          ) : currentStatusClean.toUpperCase() === 'KYC' ? (
            <CustomCircleDotted className="size-3 text-emerald-600 shrink-0" />
          ) : (
            <CustomCircleDot className="size-3 text-[#0099ff] shrink-0" />
          )}
          <span className="truncate">{currentStatusClean}</span>
        </span>
        <ChevronDown className="size-3 text-zinc-500 shrink-0" />
      </button>

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
            className="w-48 max-h-64 overflow-y-auto custom-scrollbar p-1.5 bg-popover border border-zinc-700/80 rounded-xl shadow-2xl flex flex-col gap-0.5 text-zinc-200 animate-in fade-in zoom-in-95 duration-100"
          >
            <div className="px-2 py-1 text-[10px] font-bold text-zinc-500 uppercase tracking-wider">
              Workflow Status
            </div>

            {orderedStatuses.map((st: string) => {
              const isSelected = st.toUpperCase() === (currentStatus || '').toUpperCase();
              const isCl = isClosedStatus(st);

              return (
                <button
                  key={st}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSelectStatus(st);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-colors ${
                    isSelected
                      ? 'bg-blue-500/15 text-blue-400 font-semibold'
                      : 'text-zinc-300 hover:bg-zinc-800 hover:text-white'
                  }`}
                >
                  <span className="flex items-center gap-2 truncate">
                    {isCl ? (
                      <CheckCircle2 className="size-3 text-emerald-500 shrink-0" />
                    ) : st.toUpperCase() === 'KYC' ? (
                      <CustomCircleDotted className="size-3 text-emerald-600 shrink-0" />
                    ) : (
                      <CustomCircleDot className="size-3 text-[#0099ff] shrink-0" />
                    )}
                    <span className="truncate">{st}</span>
                  </span>
                  {isSelected && <Check className="size-3.5 text-blue-400 shrink-0" />}
                </button>
              );
            })}
          </div>,
          document.body
        )}
    </>
  );
};

