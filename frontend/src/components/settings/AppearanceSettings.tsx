'use client';

import { useState, useEffect, useId } from 'react';
import {
  Sun,
  Moon,
  Laptop,
  Check,
  RotateCcw,
  Palette as PaletteIcon,
  Sparkles,
  ShieldCheck,
  Info,
  CheckCircle2,
  AlertTriangle,
  XCircle,
} from 'lucide-react';
import {
  ThemeMode,
  ThemePalette,
  ThemeConfig,
  PALETTES,
  DEFAULT_THEME_CONFIG,
  applyTheme,
  getStoredTheme,
  saveStoredTheme,
  calculateLuminance,
  getOnAccentColor,
  isValidHex,
} from '@/lib/theme';
import { useAppStore } from '@/lib/store';
import { toast } from '@/lib/toast';

export function AppearanceSettings() {
  const { currentUser } = useAppStore();
  const hexInputId = useId();
  const colorPickerId = useId();

  const [mode, setMode] = useState<ThemeMode>('dark');
  const [palette, setPalette] = useState<ThemePalette>('nexus');
  const [customAccent, setCustomAccent] = useState<string | null>(null);
  const [hexInput, setHexInput] = useState<string>('');
  const [hexError, setHexError] = useState<string | null>(null);

  // Initialize from storage
  useEffect(() => {
    const stored = getStoredTheme(currentUser?.id);
    setMode(stored.mode);
    setPalette(stored.palette);
    setCustomAccent(stored.custom || null);
    setHexInput(stored.custom || '');
  }, [currentUser?.id]);

  const updateTheme = (newConfig: ThemeConfig) => {
    applyTheme(newConfig);
    saveStoredTheme(newConfig, currentUser?.id);
  };

  const handleModeChange = (newMode: ThemeMode) => {
    setMode(newMode);
    const newConfig: ThemeConfig = { mode: newMode, palette, custom: customAccent };
    updateTheme(newConfig);
    toast.success(`Appearance mode set to ${newMode.charAt(0).toUpperCase() + newMode.slice(1)}`);
  };

  const handlePaletteSelect = (newPalette: ThemePalette) => {
    setPalette(newPalette);
    // Requirement 3: The custom accent clears when a preset is chosen
    setCustomAccent(null);
    setHexInput('');
    setHexError(null);

    const newConfig: ThemeConfig = { mode, palette: newPalette, custom: null };
    updateTheme(newConfig);
    toast.success(`Switched to ${PALETTES[newPalette].name} palette`);
  };

  const handleCustomAccentApply = (rawHex: string) => {
    let sanitized = rawHex.trim();
    if (!sanitized.startsWith('#')) {
      sanitized = `#${sanitized}`;
    }

    if (!isValidHex(sanitized)) {
      setHexError('Please enter a valid 3 or 6-digit hex code (e.g., #4F46E5)');
      return;
    }

    const formattedHex = sanitized.toUpperCase();
    setHexError(null);
    setCustomAccent(formattedHex);
    setHexInput(formattedHex);

    const newConfig: ThemeConfig = { mode, palette, custom: formattedHex };
    updateTheme(newConfig);
    toast.success(`Custom accent color applied: ${formattedHex}`);
  };

  const handleHexInputChange = (value: string) => {
    setHexInput(value);
    const trimmed = value.trim();
    const candidate = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
    if (isValidHex(candidate)) {
      setHexError(null);
      const formatted = candidate.toUpperCase();
      setCustomAccent(formatted);
      const newConfig: ThemeConfig = { mode, palette, custom: formatted };
      updateTheme(newConfig);
    } else if (trimmed === '' || trimmed === '#') {
      setHexError(null);
    }
  };

  const handleClearCustomAccent = () => {
    setCustomAccent(null);
    setHexInput('');
    setHexError(null);
    const newConfig: ThemeConfig = { mode, palette, custom: null };
    updateTheme(newConfig);
    toast.success('Custom accent cleared; returned to preset accent');
  };

  const handleResetToDefault = () => {
    setMode(DEFAULT_THEME_CONFIG.mode);
    setPalette(DEFAULT_THEME_CONFIG.palette);
    setCustomAccent(null);
    setHexInput('');
    setHexError(null);

    updateTheme(DEFAULT_THEME_CONFIG);
    toast.success('Appearance reset to default (Nexus, System)');
  };

  // Determine active accent and luminance
  const activeAccent = customAccent || PALETTES[palette][mode === 'dark' ? 'dark' : 'light'].accent;
  const activeOnAccent = customAccent ? getOnAccentColor(customAccent) : (mode === 'dark' ? '#0F172A' : '#FFFFFF');
  const accentLuminance = calculateLuminance(activeAccent);

  return (
    <section id="appearance" className="scroll-mt-8 space-y-6">
      <div
        className="rounded-xl border overflow-hidden transition-colors"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        {/* Section Header */}
        <div
          className="px-6 py-4 border-b flex flex-col sm:flex-row sm:items-center justify-between gap-3"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'color-mix(in srgb, var(--surface) 95%, var(--bg))',
          }}
        >
          <div>
            <h2
              className="text-sm font-semibold flex items-center gap-2"
              style={{ color: 'var(--text)' }}
            >
              <PaletteIcon className="w-4 h-4" style={{ color: 'var(--accent)' }} />
              Appearance & Themes
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
              Customize your interface mode, color palette presets, and accent colors.
            </p>
          </div>

          <button
            type="button"
            onClick={handleResetToDefault}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer theme-focus-ring self-start sm:self-auto border hover:bg-[var(--hover-subtle)]"
            style={{
              borderColor: 'var(--border)',
              backgroundColor: 'var(--surface)',
              color: 'var(--muted)',
            }}
            title="Reset theme and colors to default"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset to default</span>
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* 1. MODE: Light / Dark / System Segmented Control */}
          <div className="space-y-3">
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: 'var(--muted)' }}>
                Interface Mode
              </label>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Choose between dark atmosphere, crisp light mode, or follow your operating system automatically.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Interface mode selector"
              className="inline-flex p-1 rounded-xl border max-w-full"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
              }}
            >
              {[
                { id: 'light' as const, label: 'Light', icon: Sun },
                { id: 'dark' as const, label: 'Dark', icon: Moon },
                { id: 'system' as const, label: 'System', icon: Laptop },
              ].map((item) => {
                const IconComponent = item.icon;
                const isSelected = mode === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => handleModeChange(item.id)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium transition-all cursor-pointer theme-focus-ring ${
                      isSelected ? '' : 'hover:bg-[color-mix(in_srgb,var(--text)_5%,transparent)]'
                    }`}
                    style={{
                      backgroundColor: isSelected ? 'var(--surface)' : 'transparent',
                      color: isSelected ? 'var(--text)' : 'var(--muted)',
                      boxShadow: isSelected ? '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)' : 'none',
                    }}
                  >
                    <IconComponent
                      className="w-3.5 h-3.5"
                      style={{ color: isSelected ? 'var(--accent)' : 'inherit' }}
                    />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. PRESET PALETTES */}
          <div className="space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="space-y-0.5">
                <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: 'var(--muted)' }}>
                  Preset Palettes
                </label>
                <p className="text-xs" style={{ color: 'var(--muted)' }}>
                  Hand-crafted, WCAG-compliant color schemes tuned for high focus and visual harmony.
                </p>
              </div>
              {customAccent && (
                <span
                  className="inline-flex items-center justify-center px-2.5 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap shrink-0 self-start sm:self-center leading-tight"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
                    color: 'var(--accent)',
                  }}
                >
                  Custom accent active
                </span>
              )}
            </div>

            <div
              role="radiogroup"
              aria-label="Preset color palettes"
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3"
            >
              {(Object.keys(PALETTES) as ThemePalette[]).map((paletteKey) => {
                const item = PALETTES[paletteKey];
                const isSelected = palette === paletteKey && !customAccent;
                const lightBg = item.light.bg;
                const darkBg = item.dark.bg;
                const accentColor = mode === 'dark' ? item.dark.accent : item.light.accent;

                return (
                  <div
                    key={item.id}
                    role="radio"
                    aria-checked={isSelected}
                    tabIndex={0}
                    onClick={() => handlePaletteSelect(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        handlePaletteSelect(item.id);
                      }
                    }}
                    className="p-3.5 rounded-xl border transition-all cursor-pointer theme-focus-ring relative group hover:border-[color-mix(in_srgb,var(--text)_25%,var(--border))]"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                  >
                    {/* Top Row: Title + Check */}
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-semibold capitalize" style={{ color: 'var(--text)' }}>
                          {item.name}
                        </span>
                        {item.id === 'nexus' && (
                          <span
                            className="text-[10px] px-1.5 py-0.5 rounded-md font-medium"
                            style={{
                              backgroundColor: 'color-mix(in srgb, var(--text) 8%, var(--surface))',
                              color: 'var(--muted)',
                            }}
                          >
                            Default
                          </span>
                        )}
                      </div>

                      {isSelected && (
                        <div
                          className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                          style={{
                            backgroundColor: 'var(--accent)',
                            color: 'var(--on-accent)',
                          }}
                        >
                          <Check className="w-3 h-3 stroke-[2.5]" />
                        </div>
                      )}
                    </div>

                    <p className="text-[11px] mb-3 line-clamp-1" style={{ color: 'var(--muted)' }}>
                      {item.description}
                    </p>

                    {/* Small Swatch: Accent, Light BG, Dark BG */}
                    <div
                      className="p-2 rounded-lg border flex items-center justify-between gap-2"
                      style={{
                        backgroundColor: 'var(--bg)',
                        borderColor: 'var(--border)',
                      }}
                    >
                      <div className="flex items-center gap-2">
                        {/* Accent swatch */}
                        <div
                          className="w-5 h-5 rounded-full shadow-xs shrink-0"
                          style={{ backgroundColor: accentColor }}
                          title={`Accent: ${accentColor}`}
                        />
                        <div className="flex flex-col">
                          <span className="text-[10px] font-mono leading-none" style={{ color: 'var(--text)' }}>
                            {accentColor}
                          </span>
                          <span className="text-[9px] leading-tight" style={{ color: 'var(--muted)' }}>
                            accent
                          </span>
                        </div>
                      </div>

                      {/* Light & Dark Swatches */}
                      <div className="flex items-center gap-1.5 shrink-0">
                        <div
                          className="w-4 h-4 rounded-full border shadow-2xs"
                          style={{
                            backgroundColor: lightBg,
                            borderColor: item.light.border,
                          }}
                          title={`Light mode surface: ${lightBg}`}
                        />
                        <div
                          className="w-4 h-4 rounded-full border shadow-2xs"
                          style={{
                            backgroundColor: darkBg,
                            borderColor: item.dark.border,
                          }}
                          title={`Dark mode surface: ${darkBg}`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 3. CUSTOM ACCENT COLOR PICKER */}
          <div className="space-y-4 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div>
              <div className="flex items-center gap-2">
                <label
                  htmlFor={hexInputId}
                  className="text-xs font-semibold uppercase tracking-wider block"
                  style={{ color: 'var(--muted)' }}
                >
                  Custom Accent Color
                </label>
                <span
                  className="inline-flex items-center justify-center text-[10px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 leading-tight"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
                    color: 'var(--accent)',
                  }}
                >
                  Inline Override
                </span>
              </div>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Override the palette accent. Nexus automatically calculates accessible text luminance on your custom color.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3">
              {/* Native Color Picker Circle */}
              <div className="relative shrink-0">
                <input
                  id={colorPickerId}
                  type="color"
                  value={isValidHex(activeAccent) ? activeAccent : '#4F46E5'}
                  onChange={(e) => handleCustomAccentApply(e.target.value)}
                  className="absolute inset-0 opacity-0 w-full h-full cursor-pointer z-10"
                  aria-label="Choose custom accent color"
                />
                <div
                  className="w-10 h-10 rounded-xl border-2 flex items-center justify-center shadow-xs transition-transform hover:scale-105"
                  style={{
                    backgroundColor: activeAccent,
                    borderColor: 'var(--border)',
                  }}
                >
                  <Sparkles
                    className="w-4 h-4"
                    style={{ color: activeOnAccent }}
                  />
                </div>
              </div>

              {/* Hex Text Input */}
              <div className="flex-1 min-w-[200px] max-w-xs relative">
                <input
                  id={hexInputId}
                  type="text"
                  maxLength={7}
                  value={hexInput}
                  onChange={(e) => handleHexInputChange(e.target.value)}
                  placeholder={PALETTES[palette][mode === 'dark' ? 'dark' : 'light'].accent}
                  className="w-full rounded-lg px-3 py-2 text-xs font-mono border transition-colors theme-focus-ring"
                  style={{
                    backgroundColor: 'var(--bg)',
                    borderColor: hexError ? 'var(--danger)' : 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>

              {/* Clear button if custom accent is set */}
              {customAccent && (
                <button
                  type="button"
                  onClick={handleClearCustomAccent}
                  className="px-3 py-2 rounded-lg text-xs font-medium border transition-colors theme-focus-ring cursor-pointer hover:bg-[var(--hover-subtle)]"
                  style={{
                    borderColor: 'var(--border)',
                    backgroundColor: 'var(--surface)',
                    color: 'var(--muted)',
                  }}
                >
                  Clear custom accent
                </button>
              )}
            </div>

            {hexError && (
              <p className="text-[11px]" style={{ color: 'var(--danger)' }}>
                {hexError}
              </p>
            )}

            {/* Luminance & Contrast Status Badge */}
            <div
              className="p-3.5 rounded-xl border flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              style={{
                backgroundColor: 'var(--bg)',
                borderColor: 'var(--border)',
              }}
            >
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" style={{ color: 'var(--success)' }} />
                <span style={{ color: 'var(--text)' }}>
                  Luminance: <strong className="font-mono">{(accentLuminance * 100).toFixed(1)}%</strong>
                </span>
                <span style={{ color: 'var(--muted)' }}>•</span>
                <span style={{ color: 'var(--muted)' }}>Text on accent:</span>
                <span
                  className="px-2 py-0.5 rounded font-medium text-[11px] font-mono shadow-2xs border"
                  style={{
                    backgroundColor: activeAccent,
                    color: activeOnAccent,
                    borderColor: 'var(--border)',
                  }}
                >
                  {activeOnAccent === '#0F172A' ? 'Dark text (#0F172A)' : 'White text (#FFFFFF)'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
                <Info className="w-3.5 h-3.5 shrink-0" />
                <span>WCAG AA accessible contrast</span>
              </div>
            </div>
          </div>

          {/* 4. LIVE INTERACTIVE COMPONENT PREVIEW */}
          <div className="space-y-3 pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
            <div>
              <label className="text-xs font-semibold uppercase tracking-wider block" style={{ color: 'var(--muted)' }}>
                Live Tokens & Component Preview
              </label>
              <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                Preview how buttons, tinted backgrounds (<code className="font-mono text-[11px]">color-mix</code>), and status colors render in your active theme.
              </p>
            </div>

            <div
              className="p-5 rounded-xl border space-y-4"
              style={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
              }}
            >
              {/* Row A: Primary action + Tinted badge + Ghost button */}
              <div className="flex flex-wrap items-center gap-3">
                {/* Primary Button */}
                <button
                  type="button"
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-xs transition-opacity hover:opacity-90 theme-focus-ring cursor-pointer"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: 'var(--on-accent)',
                  }}
                >
                  Primary Action Button
                </button>

                {/* Tinted Background Badge: Requirement 8 */}
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
                    borderColor: 'color-mix(in srgb, var(--accent) 25%, var(--surface))',
                    color: 'var(--accent)',
                  }}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Tinted Badge (15% mix)</span>
                </span>

                {/* Selected State Item */}
                <span
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--accent) 15%, var(--surface))',
                    borderColor: 'var(--accent)',
                    color: 'var(--text)',
                  }}
                >
                  <Check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} />
                  <span>Selected List Item</span>
                </span>
              </div>

              {/* Row B: Status Indicators (Shared by all palettes per mode) */}
              <div className="pt-2 border-t flex flex-wrap items-center gap-2" style={{ borderColor: 'var(--border)' }}>
                <span className="text-[11px] font-medium mr-2" style={{ color: 'var(--muted)' }}>
                  Status Colors:
                </span>

                {/* Success */}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--success) 12%, var(--surface))',
                    borderColor: 'color-mix(in srgb, var(--success) 30%, var(--surface))',
                    color: 'var(--success)',
                  }}
                >
                  <CheckCircle2 className="w-3 h-3" />
                  <span>Success</span>
                </span>

                {/* Warning */}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--warning) 12%, var(--surface))',
                    borderColor: 'color-mix(in srgb, var(--warning) 30%, var(--surface))',
                    color: 'var(--warning)',
                  }}
                >
                  <AlertTriangle className="w-3 h-3" />
                  <span>Warning</span>
                </span>

                {/* Danger */}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--danger) 12%, var(--surface))',
                    borderColor: 'color-mix(in srgb, var(--danger) 30%, var(--surface))',
                    color: 'var(--danger)',
                  }}
                >
                  <XCircle className="w-3 h-3" />
                  <span>Danger</span>
                </span>

                {/* Info */}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border"
                  style={{
                    backgroundColor: 'color-mix(in srgb, var(--info) 12%, var(--surface))',
                    borderColor: 'color-mix(in srgb, var(--info) 30%, var(--surface))',
                    color: 'var(--info)',
                  }}
                >
                  <Info className="w-3 h-3" />
                  <span>Info</span>
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
