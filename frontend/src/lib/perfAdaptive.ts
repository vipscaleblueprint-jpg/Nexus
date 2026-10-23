'use client';

export type PerfTier = 'low' | 'medium' | 'high';

export interface PerfProfile {
  tier: PerfTier;
  particleCount: number;
  maxDurationMs: number;
  enableSparkles: boolean;
  enableGlow: boolean;
  imageResolution: number;
  deviceMemory: number;
  hardwareConcurrency: number;
  estimatedLatencyMs: number;
  isDataSaver: boolean;
  cachedAt: number;
}

const STORAGE_KEY = 'nexus_perf_profile_cache';
const OVERRIDE_KEY = 'nexus_perf_tier_override';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Probes hardware memory, logical CPU concurrency, and network latency.
 */
function probeSystemMetrics(): {
  memoryGb: number;
  cores: number;
  latencyMs: number;
  saveData: boolean;
} {
  if (typeof window === 'undefined') {
    return { memoryGb: 4, cores: 4, latencyMs: 50, saveData: false };
  }

  // Device memory in GB (Chrome, Edge, Opera; returns e.g. 0.5, 1, 2, 4, 8)
  const nav = navigator as any;
  const memoryGb = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : 4;
  const cores = typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : 4;

  // Network RTT latency
  let latencyMs = 50;
  let saveData = false;
  if (nav.connection) {
    if (typeof nav.connection.rtt === 'number') {
      latencyMs = nav.connection.rtt;
    }
    if (nav.connection.saveData === true) {
      saveData = true;
    }
  }

  return { memoryGb, cores, latencyMs, saveData };
}

/**
 * Calculates adaptive tier and particle budget based on hardware & latency.
 */
function calculateTier(memoryGb: number, cores: number, latencyMs: number, saveData: boolean): PerfTier {
  // If data saver is enabled or low hardware specs or high network latency:
  if (saveData || memoryGb <= 4 || cores <= 2 || latencyMs > 250) {
    return 'low';
  }

  // High performance: 8GB+ RAM, 6+ cores, snappy latency
  if (memoryGb >= 8 && cores >= 6 && latencyMs <= 120) {
    return 'high';
  }

  // Balanced mid-tier
  return 'medium';
}

function getTierSettings(tier: PerfTier): {
  particleCount: number;
  maxDurationMs: number;
  enableSparkles: boolean;
  enableGlow: boolean;
  imageResolution: number;
} {
  switch (tier) {
    case 'low':
      return {
        particleCount: 8,
        maxDurationMs: 1300,
        enableSparkles: false,
        enableGlow: false,
        imageResolution: 32,
      };
    case 'medium':
      return {
        particleCount: 18,
        maxDurationMs: 1800,
        enableSparkles: true,
        enableGlow: false,
        imageResolution: 40,
      };
    case 'high':
    default:
      return {
        particleCount: 28,
        maxDurationMs: 2200,
        enableSparkles: true,
        enableGlow: true,
        imageResolution: 48,
      };
  }
}

/**
 * Retrieves the cached client performance profile, or benchmarks and caches it.
 */
export function getClientPerfProfile(): PerfProfile {
  if (typeof window === 'undefined') {
    const defaults = getTierSettings('medium');
    return {
      tier: 'medium',
      ...defaults,
      deviceMemory: 4,
      hardwareConcurrency: 4,
      estimatedLatencyMs: 50,
      isDataSaver: false,
      cachedAt: Date.now(),
    };
  }

  // Check manual user override first
  const userOverride = localStorage.getItem(OVERRIDE_KEY) as PerfTier | null;
  if (userOverride && (userOverride === 'low' || userOverride === 'medium' || userOverride === 'high')) {
    const settings = getTierSettings(userOverride);
    const { memoryGb, cores, latencyMs, saveData } = probeSystemMetrics();
    return {
      tier: userOverride,
      ...settings,
      deviceMemory: memoryGb,
      hardwareConcurrency: cores,
      estimatedLatencyMs: latencyMs,
      isDataSaver: saveData,
      cachedAt: Date.now(),
    };
  }

  // Check cached profile in localStorage
  try {
    const cachedRaw = localStorage.getItem(STORAGE_KEY);
    if (cachedRaw) {
      const parsed: PerfProfile = JSON.parse(cachedRaw);
      const isFresh = Date.now() - (parsed.cachedAt || 0) < CACHE_TTL_MS;
      if (isFresh && parsed.tier && parsed.particleCount) {
        return parsed;
      }
    }
  } catch {
    // Ignore JSON parse errors
  }

  // Compute fresh profile
  const { memoryGb, cores, latencyMs, saveData } = probeSystemMetrics();
  const tier = calculateTier(memoryGb, cores, latencyMs, saveData);
  const settings = getTierSettings(tier);

  const profile: PerfProfile = {
    tier,
    ...settings,
    deviceMemory: memoryGb,
    hardwareConcurrency: cores,
    estimatedLatencyMs: latencyMs,
    isDataSaver: saveData,
    cachedAt: Date.now(),
  };

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(profile));
  } catch {
    // Ignore storage quota
  }

  return profile;
}

/**
 * Manually set or clear user override tier.
 */
export function setPerfTierOverride(tier: PerfTier | 'auto'): void {
  if (typeof window === 'undefined') return;
  if (tier === 'auto') {
    localStorage.removeItem(OVERRIDE_KEY);
  } else {
    localStorage.setItem(OVERRIDE_KEY, tier);
  }
}

export function getPerfTierOverride(): PerfTier | 'auto' {
  if (typeof window === 'undefined') return 'auto';
  const val = localStorage.getItem(OVERRIDE_KEY);
  if (val === 'low' || val === 'medium' || val === 'high') return val;
  return 'auto';
}

/**
 * Automatically degrades the tier if frame drops (>33ms/frame) are detected during canvas animation.
 */
export function recordFrameDrop(): void {
  if (typeof window === 'undefined') return;
  try {
    const current = getClientPerfProfile();
    if (current.tier !== 'low') {
      const lowSettings = getTierSettings('low');
      const degraded: PerfProfile = {
        ...current,
        tier: 'low',
        ...lowSettings,
        cachedAt: Date.now(),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(degraded));
    }
  } catch {
    // Ignore
  }
}
