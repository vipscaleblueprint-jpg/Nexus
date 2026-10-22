import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  X,
  Plus,
  Clock,
  Smile,
  Dog,
  Pizza,
  Trophy,
  Plane,
  Lightbulb,
  Heart,
  Flag,
} from 'lucide-react';
import { EmojiItem } from '@/lib/emojiData';
import { emojisApi } from '@/api/emojis';

export interface EmojiPickerProps {
  /** Triggered when an emoji is selected */
  onSelect: (emoji: string) => void;
  /** Triggered to close the picker */
  onClose: () => void;
  /** Anchor element to position the picker relative to */
  anchorEl?: HTMLElement | null;
  /** Optional custom position if anchorEl is not provided */
  position?: { top: number; left: number };
  /** Preferred placement */
  placement?: 'top' | 'bottom' | 'auto';
  /** Title or label at top */
  title?: string;
  /** Show quick reactions bar at top (kept for API compatibility) */
  showQuickReactions?: boolean;
}

/**
 * =========================================================================
 * CUSTOM SKIN TONE HOVER LABEL
 * You can manually edit the string below to change what the "Dark" skin tone
 * transitions into on hover!
 * =========================================================================
 */
export const DARK_TONE_HOVER_CUSTOM_LABEL = 'Nigga';

const FREQUENTLY_USED_STORAGE_KEY = 'nexus_frequently_used_emojis';
const DEFAULT_FREQUENTLY_USED = [
  '🤣', '👍', '✅', '🔥', '😃', '😘', '😍', '😆', '😜', '😅',
  '😂', '😱', '😔', '😒', '😩', '😭', '😎', '❤️'
];

function getInitialFrequentlyUsed(): string[] {
  if (typeof window === 'undefined') return DEFAULT_FREQUENTLY_USED;
  try {
    const raw = localStorage.getItem(FREQUENTLY_USED_STORAGE_KEY);
    if (!raw) return DEFAULT_FREQUENTLY_USED;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed;
  } catch {
    // fallback
  }
  return DEFAULT_FREQUENTLY_USED;
}

function recordFrequentlyUsed(emoji: string) {
  if (typeof window === 'undefined') return;
  try {
    const current = getInitialFrequentlyUsed();
    const updated = [emoji, ...current.filter((e) => e !== emoji)].slice(0, 20);
    localStorage.setItem(FREQUENTLY_USED_STORAGE_KEY, JSON.stringify(updated));
  } catch {
    // ignore
  }
}

const SKIN_TONES = [
  { emoji: '✋', label: 'Default', modifier: '' },
  { emoji: '✋🏻', label: 'Light', modifier: '\u{1F3FB}' },
  { emoji: '✋🏼', label: 'Medium-Light', modifier: '\u{1F3FC}' },
  { emoji: '✋🏽', label: 'Medium', modifier: '\u{1F3FD}' },
  { emoji: '✋🏾', label: 'Medium-Dark', modifier: '\u{1F3FE}' },
  { emoji: '✋🏿', label: 'Dark', modifier: '\u{1F3FF}' },
];

const SKIN_TONE_STORAGE_KEY = 'nexus_emoji_skin_tone';

function getInitialSkinTone(): typeof SKIN_TONES[number] {
  if (typeof window === 'undefined') return SKIN_TONES[0];
  try {
    const saved = localStorage.getItem(SKIN_TONE_STORAGE_KEY);
    if (saved) {
      const match = SKIN_TONES.find((t) => t.label === saved);
      if (match) return match;
    }
  } catch {
    // fallback
  }
  return SKIN_TONES[0];
}

const SKIN_TONE_BASE_SET = new Set([
  '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞',
  '🫰', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️',
  '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲',
  '🤝', '🙏', '✍️', '💅', '🤳', '💪', '👂', '👃', '👶', '🧒',
  '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵',
  '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷',
  '👮', '🕵️', '💂', '👷', '🤴', '👸', '👳', '👲', '🧕', '🤵',
  '👰', '🤰', '🤱', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝',
  '🧞', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🧗',
  '🧘', '🛀', '🛌', '🏋️', '🤸', '⛹️', '🤺', '🤾', '🏌️', '🏇',
  '🏄', '🏊', '🤽', '🚣'
]);

function applySkinTone(emoji: string, modifier: string): string {
  const stripped = emoji.replace(/[\u{1F3FB}-\u{1F3FF}]/gu, '');
  if (!modifier) return stripped;

  const clean = stripped.replace(/\uFE0F/gu, '');
  if (SKIN_TONE_BASE_SET.has(stripped) || SKIN_TONE_BASE_SET.has(clean) || SKIN_TONE_BASE_SET.has(emoji)) {
    return clean + modifier;
  }
  return emoji;
}

interface CategorySection {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  sourceCategories?: string[];
}

const CATEGORIES: CategorySection[] = [
  { id: 'frequently_used', label: 'Frequently Used', icon: Clock },
  { id: 'smiles_people', label: 'Smiles & People', icon: Smile, sourceCategories: ['Smileys & Emotion', 'People & Body'] },
  { id: 'animals_nature', label: 'Animals & Nature', icon: Dog, sourceCategories: ['Animals & Nature'] },
  { id: 'food_drink', label: 'Food & Drink', icon: Pizza, sourceCategories: ['Food & Drink'] },
  { id: 'activities', label: 'Activities', icon: Trophy, sourceCategories: ['Activities'] },
  { id: 'travel_places', label: 'Travel & Places', icon: Plane, sourceCategories: ['Travel & Places'] },
  { id: 'objects', label: 'Objects', icon: Lightbulb, sourceCategories: ['Objects'] },
  { id: 'symbols', label: 'Symbols', icon: Heart, sourceCategories: ['Symbols'] },
  { id: 'flags', label: 'Flags', icon: Flag, sourceCategories: ['Flags'] },
];

function calculatePosition(
  anchorEl?: HTMLElement | null,
  position?: { top: number; left: number },
  placement: 'top' | 'bottom' | 'auto' = 'auto'
): { top: number; left: number } | null {
  if (typeof window === 'undefined') return null;
  if (position) return position;
  if (!anchorEl) return null;

  const rect = anchorEl.getBoundingClientRect();
  const pickerWidth = 356;
  const pickerHeight = 420;
  const margin = 8;

  let top = 0;
  let left = rect.left;

  // Horizontally clamp within window
  if (left + pickerWidth > window.innerWidth - margin) {
    left = Math.max(margin, window.innerWidth - pickerWidth - margin);
  }
  if (left < margin) left = margin;

  // Vertical placement
  const spaceBelow = window.innerHeight - rect.bottom;
  const spaceAbove = rect.top;

  if (placement === 'top') {
    top = rect.top - pickerHeight - margin;
  } else if (placement === 'bottom') {
    top = rect.bottom + margin;
  } else {
    // auto: prefer top if space below is too small, else bottom
    if (spaceBelow < pickerHeight + margin && spaceAbove > spaceBelow) {
      top = Math.max(margin, rect.top - pickerHeight - margin);
    } else {
      top = Math.min(window.innerHeight - pickerHeight - margin, rect.bottom + margin);
    }
  }

  return { top, left };
}

export function EmojiPicker({
  onSelect,
  onClose,
  anchorEl,
  position,
  placement = 'auto',
}: EmojiPickerProps) {
  const [data, setData] = useState(() => emojisApi.getEmojisSync());
  const [frequentlyUsed, setFrequentlyUsed] = useState<string[]>(getInitialFrequentlyUsed);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('frequently_used');
  const [activeSkinTone, setActiveSkinTone] = useState<typeof SKIN_TONES[number]>(getInitialSkinTone);
  const [showSkinToneMenu, setShowSkinToneMenu] = useState(false);

  const handleSelectSkinTone = (tone: typeof SKIN_TONES[number]) => {
    setActiveSkinTone(tone);
    setShowSkinToneMenu(false);
    try {
      localStorage.setItem(SKIN_TONE_STORAGE_KEY, tone.label);
    } catch {
      // ignore
    }
  };

  // Adapts an EmojiItem with the active skin tone modifier
  const withSkinTone = useCallback(
    (item: EmojiItem): EmojiItem => {
      const toned = applySkinTone(item.emoji, activeSkinTone.modifier);
      if (toned === item.emoji) return item;
      return {
        ...item,
        emoji: toned,
      };
    },
    [activeSkinTone.modifier]
  );

  // Skin tone hover label transition (transitions 'Dark' -> DARK_TONE_HOVER_CUSTOM_LABEL after hover)
  const [hoveredToneLabel, setHoveredToneLabel] = useState<string | null>(null);
  const [hoveredToneIndex, setHoveredToneIndex] = useState<number | null>(null);
  const darkToneHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleMouseEnterTone = (tone: typeof SKIN_TONES[number], index: number) => {
    setHoveredToneIndex(index);
    if (tone.label === 'Dark') {
      setHoveredToneLabel('Dark');
      if (darkToneHoverTimerRef.current) clearTimeout(darkToneHoverTimerRef.current);
      darkToneHoverTimerRef.current = setTimeout(() => {
        setHoveredToneLabel(DARK_TONE_HOVER_CUSTOM_LABEL);
      }, 1500); // Transitions to custom label after 1.5s
    } else {
      setHoveredToneLabel(tone.label);
    }
  };

  const handleMouseLeaveTone = () => {
    if (darkToneHoverTimerRef.current) clearTimeout(darkToneHoverTimerRef.current);
    setHoveredToneLabel(null);
    setHoveredToneIndex(null);
  };

  // Floating speech-bubble tooltip state
  const [hoveredEmoji, setHoveredEmoji] = useState<EmojiItem | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{
    left: number;
    top: number;
    placeBelow: boolean;
  } | null>(null);

  // Opening & closing smooth animation state
  const [isClosing, setIsClosing] = useState(false);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [pickerPos, setPickerPos] = useState<{ top: number; left: number } | null>(() =>
    calculatePosition(anchorEl, position, placement)
  );

  const containerRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const categoryRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Background fetch full emojis if not cached
  useEffect(() => {
    emojisApi.getEmojis().then(setData);
  }, []);

  // Update position on resize or scroll
  useEffect(() => {
    const handleUpdate = () => {
      setPickerPos(calculatePosition(anchorEl, position, placement));
    };
    window.addEventListener('resize', handleUpdate);
    window.addEventListener('scroll', handleUpdate, true);
    return () => {
      window.removeEventListener('resize', handleUpdate);
      window.removeEventListener('scroll', handleUpdate, true);
    };
  }, [anchorEl, position, placement]);

  // Handle smooth closing animation
  const handleClose = useCallback(() => {
    if (isClosing) return;
    setIsClosing(true);
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, 150);
  }, [isClosing, onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      if (darkToneHoverTimerRef.current) clearTimeout(darkToneHoverTimerRef.current);
    };
  }, []);

  // Close on outside click with exit animation
  useEffect(() => {
    const handleMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (containerRef.current && containerRef.current.contains(target)) return;
      if (anchorEl && anchorEl.contains(target)) return;
      handleClose();
    };

    window.addEventListener('mousedown', handleMouseDown);
    return () => window.removeEventListener('mousedown', handleMouseDown);
  }, [handleClose, anchorEl]);

  // Close on Escape key with exit animation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleClose]);

  // Auto focus search input on mount
  useEffect(() => {
    const t = setTimeout(() => {
      inputRef.current?.focus();
    }, 50);
    return () => clearTimeout(t);
  }, []);

  // Lookup map for fast emoji item lookup
  const emojiLookup = useMemo(() => {
    const map = new Map<string, EmojiItem>();
    for (const item of data.emojis) {
      if (!map.has(item.emoji)) {
        map.set(item.emoji, item);
      }
    }
    return map;
  }, [data.emojis]);

  // Frequently used emoji items
  const frequentlyUsedItems = useMemo<EmojiItem[]>(() => {
    return frequentlyUsed.map((char) => {
      const toned = applySkinTone(char, activeSkinTone.modifier);
      const found = emojiLookup.get(char) || emojiLookup.get(toned);
      if (found) return withSkinTone(found);
      return {
        emoji: toned,
        name: 'Emoji',
        category: 'Frequently Used',
        keywords: [],
      };
    });
  }, [frequentlyUsed, emojiLookup, activeSkinTone.modifier, withSkinTone]);

  // Grouped category items for the Slack / ClickUp view
  const categorySections = useMemo(() => {
    return CATEGORIES.map((cat) => {
      if (cat.id === 'frequently_used') {
        return {
          ...cat,
          items: frequentlyUsedItems,
        };
      }
      const sourceCats = cat.sourceCategories || [];
      const items: EmojiItem[] = [];
      for (const sc of sourceCats) {
        const list = data.grouped[sc] || [];
        items.push(...list.map(withSkinTone));
      }
      return {
        ...cat,
        items,
      };
    });
  }, [data.grouped, frequentlyUsedItems, withSkinTone]);

  // Search results
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const raw = emojisApi.search(search, data.emojis);
    return raw.map(withSkinTone);
  }, [search, data.emojis, withSkinTone]);

  // Scroll to category
  const scrollToCategory = (categoryId: string) => {
    setActiveCategory(categoryId);
    const catEl = categoryRefs.current[categoryId];
    if (catEl && scrollContainerRef.current) {
      catEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  // Scroll spy to update bottom active icon
  const handleScroll = () => {
    if (search.trim()) return;
    const container = scrollContainerRef.current;
    if (!container) return;
    const containerTop = container.getBoundingClientRect().top;

    let current = CATEGORIES[0].id;
    for (const cat of CATEGORIES) {
      const el = categoryRefs.current[cat.id];
      if (el) {
        const rect = el.getBoundingClientRect();
        if (rect.top - containerTop <= 40) {
          current = cat.id;
        }
      }
    }
    setActiveCategory(current);
  };

  const handleSelectEmoji = (emoji: string) => {
    recordFrequentlyUsed(emoji);
    setFrequentlyUsed(getInitialFrequentlyUsed());
    onSelect(emoji);
    handleClose();
  };

  const handleMouseEnterEmoji = (item: EmojiItem, el: HTMLElement) => {
    setHoveredEmoji(item);
    if (containerRef.current) {
      const containerRect = containerRef.current.getBoundingClientRect();
      const elRect = el.getBoundingClientRect();
      const left = elRect.left - containerRect.left + elRect.width / 2;
      const top = elRect.top - containerRect.top;
      // If near top of container, place tooltip below
      const placeBelow = top < 70;
      setTooltipPos({
        left,
        top: placeBelow ? top + elRect.height + 6 : top - 6,
        placeBelow,
      });
    }
  };

  const handleMouseLeaveEmoji = () => {
    setHoveredEmoji(null);
    setTooltipPos(null);
  };

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      ref={containerRef}
      style={{
        position: 'fixed',
        top: pickerPos ? pickerPos.top : -9999,
        left: pickerPos ? pickerPos.left : -9999,
        zIndex: 999999,
        width: 356,
        height: 420,
      }}
      className={`bg-popover border border-border rounded-2xl shadow-2xl shadow-black/20 dark:shadow-black/70 flex flex-col overflow-hidden text-foreground select-none transition-all duration-150 transform ${isClosing
          ? 'animate-out fade-out-0 zoom-out-95 opacity-0 scale-95 pointer-events-none'
          : 'animate-in fade-in-0 zoom-in-95 opacity-100 scale-100'
        }`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {/* Top Bar: Search + Skin tone + Action button */}
      <div className="p-3 pb-2 flex items-center gap-2 border-b border-border/50 bg-card/40 relative">
        <div className="relative flex-1 flex items-center">
          <input
            ref={inputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search..."
            className="w-full bg-transparent border border-zinc-300 dark:border-zinc-700/80 rounded-lg px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground outline-none focus:border-zinc-500 dark:focus:border-zinc-400 focus:ring-1 focus:ring-zinc-400/20 transition-all"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              className="absolute right-2 text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>

        {/* Skin Tone Selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowSkinToneMenu((prev) => !prev)}
            className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-card/60 hover:bg-accent text-base leading-none transition-colors cursor-pointer"
            title={`Skin tone: ${activeSkinTone.label}`}
          >
            {activeSkinTone.emoji}
          </button>

          {showSkinToneMenu && (
            <div className="absolute top-full right-0 mt-1.5 z-50">
              {/* Floating tooltip positioned directly above the hovered hand with a downward pointing arrow */}
              {hoveredToneLabel && hoveredToneIndex !== null && (
                <div
                  style={{
                    left: `${16 + hoveredToneIndex * 28}px`,
                  }}
                  className="absolute bottom-full -translate-x-1/2 mb-2 px-2 py-0.5 rounded-md bg-zinc-900 text-white text-[10px] font-medium whitespace-nowrap shadow-md pointer-events-none select-none z-50 animate-in fade-in-0 zoom-in-95 duration-100 flex flex-col items-center"
                >
                  {hoveredToneLabel}
                  {/* Arrow caret underneath pointing directly to the hovered hand */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent border-t-4 border-t-zinc-900" />
                </div>
              )}
              <div className="flex items-center gap-1 p-1 bg-popover border border-border rounded-xl shadow-xl animate-in fade-in-0 zoom-in-95 duration-100">
                {SKIN_TONES.map((tone, idx) => (
                  <button
                    key={tone.label}
                    type="button"
                    onClick={() => handleSelectSkinTone(tone)}
                    onMouseEnter={() => handleMouseEnterTone(tone, idx)}
                    onMouseLeave={handleMouseLeaveTone}
                    className={`w-6 h-6 flex items-center justify-center text-sm rounded-md hover:bg-accent cursor-pointer transition-colors ${activeSkinTone.label === tone.label ? 'bg-accent ring-1 ring-border' : ''
                      }`}
                  >
                    {tone.emoji}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Action + Button */}
        <button
          type="button"
          onClick={() => inputRef.current?.focus()}
          className="w-7 h-7 flex items-center justify-center rounded-lg border border-border bg-card/60 hover:bg-accent text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Search or shortcut"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Floating Tooltip matching the screenshot bubble with arrow */}
      {hoveredEmoji && tooltipPos && (
        <div
          style={{
            position: 'absolute',
            left: tooltipPos.left,
            top: tooltipPos.top,
            transform: tooltipPos.placeBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
          }}
          className="z-50 pointer-events-none px-2.5 py-1.5 bg-zinc-900 text-white rounded-lg shadow-xl text-[11px] font-mono leading-tight whitespace-nowrap flex flex-col gap-0.5 animate-in fade-in-0 duration-75"
        >
          <div className="font-semibold text-white">
            :{hoveredEmoji.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}:
          </div>
          {hoveredEmoji.keywords.length > 0 && (
            <div className="text-zinc-400 text-[10px]">
              :{hoveredEmoji.keywords[0].toLowerCase().replace(/[^a-z0-9]+/g, '_')}:
            </div>
          )}
          {/* Arrow caret pointing to emoji */}
          <div
            className={`absolute left-1/2 -translate-x-1/2 w-0 h-0 border-x-4 border-x-transparent ${tooltipPos.placeBelow
                ? 'bottom-full border-b-4 border-b-zinc-900'
                : 'top-full border-t-4 border-t-zinc-900'
              }`}
          />
        </div>
      )}

      {/* Emoji Scroll Area */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto px-3 py-2 custom-scrollbar min-h-0 bg-popover relative"
      >
        {search ? (
          /* Search results */
          <div>
            <div className="text-xs font-semibold text-zinc-500 dark:text-zinc-400 mb-2 px-1 flex items-center justify-between">
              <span>Search Results</span>
              <span className="text-[10px] text-muted-foreground font-normal">
                {searchResults?.length || 0} found
              </span>
            </div>
            {searchResults && searchResults.length > 0 ? (
              <div className="grid grid-cols-10 gap-0.5">
                {searchResults.map((item) => (
                  <button
                    key={`${item.emoji}-${item.name}`}
                    type="button"
                    onClick={() => handleSelectEmoji(item.emoji)}
                    onMouseEnter={(e) => handleMouseEnterEmoji(item, e.currentTarget)}
                    onMouseLeave={handleMouseLeaveEmoji}
                    className="w-7 h-7 flex items-center justify-center text-lg rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                    title={item.name}
                  >
                    {item.emoji}
                  </button>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-xs text-muted-foreground">
                No matching emojis found
              </div>
            )}
          </div>
        ) : (
          /* Categorized View */
          categorySections.map((cat) => {
            if (cat.items.length === 0) return null;
            return (
              <div
                key={cat.id}
                ref={(el) => {
                  categoryRefs.current[cat.id] = el;
                }}
                className="mb-3"
              >
                <div className="sticky top-0 bg-popover/95 backdrop-blur-xs py-1 text-xs font-semibold text-zinc-500 dark:text-zinc-400 tracking-wide px-1 z-10">
                  {cat.label}
                </div>
                <div className="grid grid-cols-10 gap-0.5">
                  {cat.items.map((item) => (
                    <button
                      key={`${cat.id}-${item.emoji}-${item.name}`}
                      type="button"
                      onClick={() => handleSelectEmoji(item.emoji)}
                      onMouseEnter={(e) => handleMouseEnterEmoji(item, e.currentTarget)}
                      onMouseLeave={handleMouseLeaveEmoji}
                      className="w-7 h-7 flex items-center justify-center text-lg rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors cursor-pointer"
                      title={item.name}
                    >
                      {item.emoji}
                    </button>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Bottom Category Bar matching the screenshot */}
      {!search && (
        <div className="border-t border-border bg-card/60 px-2 py-1.5 flex items-center justify-between text-muted-foreground z-10 shrink-0">
          {CATEGORIES.map((cat) => {
            const IconComponent = cat.icon;
            const isActive = activeCategory === cat.id;
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => scrollToCategory(cat.id)}
                title={cat.label}
                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${isActive
                    ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                    : 'text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-100/60 dark:hover:bg-zinc-800/60'
                  }`}
              >
                <IconComponent className="w-3.5 h-3.5" />
              </button>
            );
          })}
        </div>
      )}
    </div>,
    document.body
  );
}
