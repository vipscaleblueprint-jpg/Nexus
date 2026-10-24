/**
 * Nexus Customizable Color Theme System Utility
 * Handles:
 * 1. Mode (light, dark, system)
 * 2. Preset palettes (nexus, pink, ocean, forest, sunset, graphite)
 * 3. Custom accent color overrides with luminance-based on-accent
 * 4. System mode live listener on prefers-color-scheme
 * 5. Persistence per-user with localStorage fallback
 * 6. Inline pre-paint script generation
 * 7. Full backward-compatibility with original Nexus dark mode and .theme-light
 */

export type ThemeMode = 'light' | 'dark' | 'system';
export type ThemePalette = 'nexus' | 'pink' | 'ocean' | 'forest' | 'sunset' | 'graphite';

export interface ThemeColors {
  bg: string;
  surface: string;
  border: string;
  text: string;
  muted: string;
  accent: string;
}

export interface PaletteDefinition {
  id: ThemePalette;
  name: string;
  description: string;
  light: ThemeColors;
  dark: ThemeColors;
}

export interface ThemeConfig {
  mode: ThemeMode;
  palette: ThemePalette;
  custom?: string | null;
}

export const DEFAULT_THEME_CONFIG: ThemeConfig = {
  mode: 'dark',
  palette: 'nexus',
  custom: null,
};

export const PALETTES: Record<ThemePalette, PaletteDefinition> = {
  nexus: {
    id: 'nexus',
    name: 'Nexus (Default)',
    description: 'Original Nexus design system with dark-first base and clean light mode',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#4F46E5',
    },
    dark: {
      bg: '#131316',
      surface: '#18181c',
      border: '#242429',
      text: '#e4e4e7',
      muted: '#94949e',
      accent: '#4F46E5',
    },
  },
  pink: {
    id: 'pink',
    name: 'Pink',
    description: 'Vibrant berry accent with warm blush accents',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#DB2777',
    },
    dark: {
      bg: '#14080E',
      surface: '#1F0F17',
      border: '#3A1D2B',
      text: '#F8E8EF',
      muted: '#B896A8',
      accent: '#F472B6',
    },
  },
  ocean: {
    id: 'ocean',
    name: 'Ocean',
    description: 'Deep nautical blue with refreshing sky cyan highlights',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#0369A1',
    },
    dark: {
      bg: '#07131D',
      surface: '#0D1D2A',
      border: '#173043',
      text: '#E3EEF6',
      muted: '#8FA6B8',
      accent: '#38BDF8',
    },
  },
  forest: {
    id: 'forest',
    name: 'Forest',
    description: 'Earthy pine and moss hues with emerald vibrancy',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#15803D',
    },
    dark: {
      bg: '#08130D',
      surface: '#0E1D14',
      border: '#183024',
      text: '#E2EFE6',
      muted: '#8CA697',
      accent: '#4ADE80',
    },
  },
  sunset: {
    id: 'sunset',
    name: 'Sunset',
    description: 'Warm terracotta copper tones with amber glow',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#C2410C',
    },
    dark: {
      bg: '#140C07',
      surface: '#1F140C',
      border: '#352315',
      text: '#F4E9E0',
      muted: '#B09A88',
      accent: '#FB923C',
    },
  },
  graphite: {
    id: 'graphite',
    name: 'Graphite',
    description: 'High-contrast monochrome zinc and industrial minimalism',
    light: {
      bg: '#FFFFFF',
      surface: '#F9F9F9',
      border: '#E8E8E8',
      text: '#202020',
      muted: '#595959',
      accent: '#27272A',
    },
    dark: {
      bg: '#09090B',
      surface: '#121214',
      border: '#27272A',
      text: '#F4F4F5',
      muted: '#A1A1AA',
      accent: '#E4E4E7',
    },
  },
};

/**
 * Calculates standard WCAG relative luminance for a given hex color.
 * Normalizes sRGB gamma decompression per IEC 61966-2-1.
 */
export function calculateLuminance(hex: string): number {
  if (!hex) return 0;
  const sanitized = hex.replace('#', '').trim();
  let r = 0;
  let g = 0;
  let b = 0;

  if (sanitized.length === 3) {
    r = parseInt(sanitized[0] + sanitized[0], 16);
    g = parseInt(sanitized[1] + sanitized[1], 16);
    b = parseInt(sanitized[2] + sanitized[2], 16);
  } else if (sanitized.length === 6) {
    r = parseInt(sanitized.substring(0, 2), 16);
    g = parseInt(sanitized.substring(2, 4), 16);
    b = parseInt(sanitized.substring(4, 6), 16);
  } else {
    return 0;
  }

  const sRGB = [r, g, b].map((val) => {
    const s = val / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });

  return 0.2126 * sRGB[0] + 0.7152 * sRGB[1] + 0.0722 * sRGB[2];
}

/**
 * Returns dark text (#0F172A) on light colors, and white (#FFFFFF) on dark colors.
 * Requirement 7: based on luminance.
 */
export function getOnAccentColor(accentHex: string): '#0F172A' | '#FFFFFF' {
  const lum = calculateLuminance(accentHex);
  return lum > 0.38 ? '#0F172A' : '#FFFFFF';
}

export function isValidHex(hex?: string | null): boolean {
  if (!hex) return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
}

// Media Query listener references for system mode live synchronization
let systemMediaQuery: MediaQueryList | null = null;
let systemListener: ((e: MediaQueryListEvent) => void) | null = null;

/**
 * Applies the theme configuration to the DOM.
 * 1. Sets data-theme="light|dark" on <html>
 * 2. Sets data-palette="<id>" on <html>
 * 3. Keeps legacy .theme-light class and localStorage('nexus-theme') in sync
 * 4. Overrides --accent inline if custom accent is provided; clears when null/preset is chosen
 * 5. Listens live to prefers-color-scheme if mode is 'system'
 */
export function applyTheme({ mode, palette, custom }: ThemeConfig): void {
  if (typeof document === 'undefined') return;

  const root = document.documentElement;
  const safePalette: ThemePalette = PALETTES[palette] ? palette : 'nexus';

  // 1. Clean up previous system media query listener
  if (systemMediaQuery && systemListener) {
    systemMediaQuery.removeEventListener('change', systemListener);
    systemMediaQuery = null;
    systemListener = null;
  }

  // 2. Resolve effective theme (light vs dark)
  let effectiveTheme: 'light' | 'dark' = 'dark';

  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      systemMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      effectiveTheme = systemMediaQuery.matches ? 'dark' : 'light';

      systemListener = (e: MediaQueryListEvent) => {
        const liveTheme = e.matches ? 'dark' : 'light';
        root.setAttribute('data-theme', liveTheme);
        if (liveTheme === 'light') {
          root.classList.add('theme-light');
          try { localStorage.setItem('nexus-theme', 'light'); } catch {}
        } else {
          root.classList.remove('theme-light');
          try { localStorage.setItem('nexus-theme', 'dark'); } catch {}
        }
        window.dispatchEvent(new CustomEvent('nexus-theme-change', {
          detail: { theme: liveTheme, mode: 'system', palette: safePalette, custom }
        }));
      };
      systemMediaQuery.addEventListener('change', systemListener);
    }
  } else {
    effectiveTheme = mode;
  }

  // 3. Set attributes on <html> & sync legacy .theme-light class
  root.setAttribute('data-theme', effectiveTheme);
  root.setAttribute('data-palette', safePalette);

  if (effectiveTheme === 'light') {
    root.classList.add('theme-light');
    try { localStorage.setItem('nexus-theme', 'light'); } catch {}
  } else {
    root.classList.remove('theme-light');
    try { localStorage.setItem('nexus-theme', 'dark'); } catch {}
  }

  // 4. Custom Accent Handling
  if (custom && isValidHex(custom)) {
    const hex = custom.trim().toUpperCase();
    const onAccent = getOnAccentColor(hex);
    root.style.setProperty('--accent', hex);
    root.style.setProperty('--on-accent', onAccent);
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--on-accent');
  }

  // 5. Notify listeners across the app (Sidebar, Header, etc.)
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('nexus-theme-change', {
      detail: { theme: effectiveTheme, mode, palette: safePalette, custom }
    }));
  }
}

const STORAGE_GLOBAL_KEY = 'nexus-theme-config';
const STORAGE_USER_PREFIX = 'nexus-theme-user-';

/**
 * Retrieves persisted theme configuration per user, falling back to legacy nexus-theme.
 */
export function getStoredTheme(userId?: string): ThemeConfig {
  if (typeof window === 'undefined') return DEFAULT_THEME_CONFIG;

  try {
    let raw: string | null = null;
    if (userId) {
      raw = localStorage.getItem(`${STORAGE_USER_PREFIX}${userId}`);
    }
    if (!raw) {
      raw = localStorage.getItem(STORAGE_GLOBAL_KEY);
    }

    const legacyTheme = localStorage.getItem('nexus-theme');
    const fallbackMode: ThemeMode = legacyTheme === 'light' ? 'light' : 'dark';

    if (!raw) {
      return {
        mode: fallbackMode,
        palette: 'nexus',
        custom: null,
      };
    }

    const parsed = JSON.parse(raw);
    const mode: ThemeMode = ['light', 'dark', 'system'].includes(parsed.mode) ? parsed.mode : fallbackMode;
    const palette: ThemePalette = PALETTES[parsed.palette as ThemePalette] ? parsed.palette : 'nexus';
    const custom = isValidHex(parsed.custom) ? parsed.custom.trim().toUpperCase() : null;

    return { mode, palette, custom };
  } catch {
    const legacyTheme = typeof window !== 'undefined' ? localStorage.getItem('nexus-theme') : null;
    return {
      mode: legacyTheme === 'light' ? 'light' : 'dark',
      palette: 'nexus',
      custom: null,
    };
  }
}

/**
 * Saves theme configuration per user and to the global fallback key.
 */
export function saveStoredTheme(config: ThemeConfig, userId?: string): void {
  if (typeof window === 'undefined') return;

  try {
    const payload = JSON.stringify(config);
    localStorage.setItem(STORAGE_GLOBAL_KEY, payload);
    if (userId) {
      localStorage.setItem(`${STORAGE_USER_PREFIX}${userId}`, payload);
    }
    if (config.mode === 'light' || config.mode === 'dark') {
      localStorage.setItem('nexus-theme', config.mode);
    }
  } catch {
    // Quota or private browsing fallback
  }
}

/**
 * Synchronous pre-paint script to prevent theme flash (FOUC).
 * Injected in <head> before page markup is rendered.
 */
export const PRE_PAINT_THEME_SCRIPT = `
(function() {
  try {
    var raw = localStorage.getItem('nexus-theme-config');
    var cfg = raw ? JSON.parse(raw) : null;
    var legacy = localStorage.getItem('nexus-theme');
    var mode = (cfg && cfg.mode) ? cfg.mode : (legacy === 'light' ? 'light' : 'dark');
    var palette = (cfg && cfg.palette) ? cfg.palette : 'nexus';
    var custom = (cfg && cfg.custom) ? cfg.custom : null;

    var theme = mode;
    if (mode === 'system') {
      theme = (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
    }

    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.setAttribute('data-palette', palette);

    if (theme === 'light') {
      root.classList.add('theme-light');
    } else {
      root.classList.remove('theme-light');
    }

    if (custom && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(custom)) {
      root.style.setProperty('--accent', custom);
      var c = custom.replace('#', '');
      if (c.length === 3) c = c[0] + c[0] + c[1] + c[1] + c[2] + c[2];
      var r = parseInt(c.substr(0, 2), 16) / 255;
      var g = parseInt(c.substr(2, 2), 16) / 255;
      var b = parseInt(c.substr(4, 2), 16) / 255;
      var rL = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
      var gL = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
      var bL = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
      var lum = 0.2126 * rL + 0.7152 * gL + 0.0722 * bL;
      root.style.setProperty('--on-accent', lum > 0.38 ? '#0F172A' : '#FFFFFF');
    }
  } catch (e) {}
})();
`.trim();
