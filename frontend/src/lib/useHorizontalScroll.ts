import { useEffect, RefObject } from 'react';

/**
 * Enables smooth horizontal scrolling using the mouse scroll wheel.
 * - If Shift is held, or if native horizontal scroll (trackpad/tilt-wheel) is used, scrolls horizontally.
 * - If scrolling vertically over an element that has vertical overflow and room to scroll in that direction,
 *   allows normal vertical scrolling within that column/queue.
 * - Otherwise (over headers, gaps, board background, non-overflowing columns, or when reaching the top/bottom),
 *   redirects the vertical mouse wheel scroll to horizontal scrolling.
 */
export function useHorizontalScroll(ref: RefObject<HTMLElement | null>, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      // If the board itself doesn't have horizontal overflow, let the default behavior happen
      if (el.scrollWidth <= el.clientWidth) {
        return;
      }

      // If user holds Shift, force horizontal scroll using deltaY
      if (e.shiftKey) {
        if (e.deltaY !== 0) {
          e.preventDefault();
          let delta = e.deltaY;
          if (e.deltaMode === 1) delta *= 33;
          else if (e.deltaMode === 2) delta *= 100;
          el.scrollLeft += delta * 1.5;
        }
        return;
      }

      // If native horizontal scroll (trackpad or tilt wheel) is dominant, let browser handle it natively
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        return;
      }

      if (e.deltaY === 0) return;

      // Don't intercept if wheeling inside an open popover, dropdown, or dialog menu
      const targetEl = e.target as HTMLElement | null;
      if (targetEl?.closest('[role="dialog"], [role="menu"], [data-radix-popper-content-wrapper], .dropdown-menu, [data-state="open"]')) {
        return;
      }

      // Check if cursor is over an element that has vertical overflow and can still scroll in this direction
      let target = targetEl;
      let canScrollVertically = false;

      while (target && target !== el) {
        const style = window.getComputedStyle(target);
        const isScrollable =
          (style.overflowY === 'auto' || style.overflowY === 'scroll') &&
          target.scrollHeight > target.clientHeight;

        if (isScrollable) {
          const canScrollDown = e.deltaY > 0 && (target.scrollHeight - target.clientHeight - target.scrollTop > 1);
          const canScrollUp = e.deltaY < 0 && target.scrollTop > 1;
          if (canScrollDown || canScrollUp) {
            canScrollVertically = true;
            break;
          }
        }
        target = target.parentElement;
      }

      if (!canScrollVertically) {
        e.preventDefault();
        let delta = e.deltaY;
        if (e.deltaMode === 1) delta *= 33;
        else if (e.deltaMode === 2) delta *= 100;
        el.scrollLeft += delta * 1.5;
      }
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
    };
  }, [ref, enabled]);
}
