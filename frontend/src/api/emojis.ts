import { apiClient } from './client';
import {
  EmojiItem,
  EMOJI_CATEGORIES,
  QUICK_REACTIONS,
  EMOJI_LIST,
  CATEGORIZED_EMOJIS,
} from '@/lib/emojiData';

export interface EmojiResponse {
  categories: readonly string[];
  quickReactions: string[];
  grouped: Record<string, EmojiItem[]>;
  total: number;
  emojis: EmojiItem[];
}

let cachedData: EmojiResponse | null = null;
let fetchPromise: Promise<EmojiResponse> | null = null;

export const emojisApi = {
  /**
   * Returns cached emojis immediately if available, or fetches from backend API
   * with seamless fallback to local dataset.
   */
  async getEmojis(): Promise<EmojiResponse> {
    if (cachedData) return cachedData;

    if (!fetchPromise) {
      fetchPromise = apiClient<EmojiResponse>('/api/emojis')
        .then(res => {
          cachedData = res;
          return res;
        })
        .catch(err => {
          console.warn('Failed to fetch /api/emojis, using local fallback:', err);
          const fallback: EmojiResponse = {
            categories: EMOJI_CATEGORIES,
            quickReactions: QUICK_REACTIONS,
            grouped: CATEGORIZED_EMOJIS,
            total: EMOJI_LIST.length,
            emojis: EMOJI_LIST,
          };
          cachedData = fallback;
          return fallback;
        });
    }

    return fetchPromise;
  },

  /**
   * Synchronously returns the currently cached emojis or the bundled fallback
   * so UI components can render instantly with zero frames of loading spinners.
   */
  getEmojisSync(): EmojiResponse {
    if (cachedData) return cachedData;
    return {
      categories: EMOJI_CATEGORIES,
      quickReactions: QUICK_REACTIONS,
      grouped: CATEGORIZED_EMOJIS,
      total: EMOJI_LIST.length,
      emojis: EMOJI_LIST,
    };
  },

  /**
   * Search emojis by name or keyword with high-speed local filtering.
   */
  search(query: string, sourceEmojis?: EmojiItem[]): EmojiItem[] {
    const list = sourceEmojis || (cachedData?.emojis ?? EMOJI_LIST);
    const q = query.trim().toLowerCase();
    if (!q) return list;

    return list.filter(item => {
      return (
        item.emoji === q ||
        item.name.toLowerCase().includes(q) ||
        item.keywords.some(k => k.toLowerCase().includes(q))
      );
    });
  },
};
