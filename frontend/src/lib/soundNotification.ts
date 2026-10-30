/**
 * Audio Notification Engine for Nexus.
 * Provides synthesized preset tones (ting, chime, pop, bell, glass),
 * in-memory caching of custom R2 sounds, and client-side audio conversion/optimization
 * to guarantee uniform minimal-MB files (< 150 KB) suitable for instantaneous notification playback.
 */

import { useAppStore } from './store';
import { SoundCategory, SoundChoice, CategorySoundConfig } from '@/types';

export type SoundPreset = 'ting' | 'chime' | 'pop' | 'bell' | 'glass' | 'custom';
export type { SoundCategory, SoundChoice, CategorySoundConfig };

export interface SoundCategoryOption {
  id: SoundCategory;
  name: string;
  description: string;
}

export const SOUND_CATEGORIES: SoundCategoryOption[] = [
  { id: 'mention', name: '@ Mentions', description: 'When teammates directly @mention you in comments or tasks' },
  { id: 'reaction', name: 'Comment Reactions', description: 'When teammates react with an emoji to your comments' },
  { id: 'comment', name: 'Comments & Replies', description: 'When teammates comment or reply on your tasks' },
  { id: 'status', name: 'Task & Status Updates', description: 'Status transitions, assignments, audits, and checklists' },
];

export function getCategoryForNotificationType(type?: string): SoundCategory {
  if (!type) return 'status';
  const clean = type.trim().toUpperCase();
  if (clean === 'MENTION' || clean.includes('MENTION')) return 'mention';
  if (clean === 'REACTION') return 'reaction';
  if (clean === 'COMMENT' || clean === 'REPLY') return 'comment';
  return 'status';
}

export interface SoundPresetOption {
  id: SoundPreset;
  name: string;
  description: string;
}

export const SOUND_PRESETS: SoundPresetOption[] = [
  { id: 'ting', name: 'Classic Ting', description: 'Crisp crystal bell strike — sharp & distinct (Default)' },
  { id: 'chime', name: 'Crystal Chime', description: 'Harmonic 3-note ascending chord' },
  { id: 'pop', name: 'Subtle Pop', description: 'Soft, playful bubble click' },
  { id: 'bell', name: 'Desk Bell', description: 'Resonant metallic bell ding' },
  { id: 'glass', name: 'Glass Clink', description: 'Delicate high-frequency glass chime' },
];

export interface SampleCustomSound {
  id: string;
  name: string;
  description: string;
  url: string;
}

export const SAMPLE_CUSTOM_SOUNDS: SampleCustomSound[] = [
  {
    id: 'playzz-fah',
    name: 'Playzz Fah',
    description: 'Catchy and energetic voice alert effect',
    url: 'https://nexus.xfnite.cloud/nexus-sounds/samples/playzz-fah.mp3',
  },
  {
    id: 'rene-mama',
    name: 'Rene Mama',
    description: 'Expressive vocal audio notification',
    url: 'https://nexus.xfnite.cloud/nexus-sounds/samples/rene-mama.mp3',
  },
  {
    id: 'ungol',
    name: 'Ungol',
    description: 'Distinctive custom alert effect',
    url: 'https://nexus.xfnite.cloud/nexus-sounds/samples/ungol.mp3',
  },
  {
    id: 'duterte-brrt',
    name: 'Duterte Brrt',
    description: 'Iconic rapid-stutter alert sound',
    url: 'https://nexus.xfnite.cloud/nexus-sounds/samples/duterte-brrt.mp3',
  },
];

// Reusable AudioContext singleton (lazily created to adhere to browser autoplay policy)
let sharedAudioContext: AudioContext | null = null;

function getAudioContext(): AudioContext {
  if (typeof window === 'undefined') {
    throw new Error('AudioContext can only be initialized in the browser');
  }
  if (!sharedAudioContext || sharedAudioContext.state === 'closed') {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    sharedAudioContext = new AudioCtx();
  }
  if (sharedAudioContext.state === 'suspended') {
    sharedAudioContext.resume().catch(() => {});
  }
  return sharedAudioContext;
}

// In-memory audio element cache for instant zero-lag playback of custom R2 sounds
const customAudioCache = new Map<string, HTMLAudioElement>();

export function preloadCustomSound(url?: string | null) {
  if (!url || typeof window === 'undefined') return;
  if (customAudioCache.has(url)) return;
  try {
    const audio = new Audio();
    audio.crossOrigin = 'anonymous';
    audio.preload = 'auto';
    audio.src = url;
    customAudioCache.set(url, audio);
  } catch {}
}

export function preloadSampleSounds() {
  if (typeof window === 'undefined') return;
  SAMPLE_CUSTOM_SOUNDS.forEach((sample) => {
    preloadCustomSound(sample.url);
  });
}

/**
 * Synthesizes a studio-grade preset alert using Web Audio API.
 * Requires 0 network requests, 0 latency, and produces crisp acoustic sounds.
 */
export function playPresetTone(preset: SoundPreset, volume = 0.8) {
  try {
    const ctx = getAudioContext();
    const clampedVolume = Math.max(0, Math.min(1, volume));
    const now = ctx.currentTime;

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(clampedVolume, now);
    masterGain.connect(ctx.destination);

    switch (preset) {
      case 'ting': {
        // High dual-tone bell strike (1760 Hz primary + 3520 Hz octave shimmer with steep exponential decay)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain1 = ctx.createGain();
        const gain2 = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1760, now); // A6
        gain1.gain.setValueAtTime(0.7, now);
        gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.65);

        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(3520, now); // A7 sparkle
        gain2.gain.setValueAtTime(0.25, now);
        gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);

        osc1.connect(gain1);
        gain1.connect(masterGain);
        osc2.connect(gain2);
        gain2.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.7);
        osc2.stop(now + 0.4);
        break;
      }

      case 'chime': {
        // Warm 3-note ascending chord (C5 -> E5 -> G5)
        const freqs = [523.25, 659.25, 783.99];
        freqs.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          const noteStart = now + idx * 0.08;

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, noteStart);

          gain.gain.setValueAtTime(0.0001, now);
          gain.gain.setValueAtTime(0.35, noteStart);
          gain.gain.exponentialRampToValueAtTime(0.0001, noteStart + 0.55);

          osc.connect(gain);
          gain.connect(masterGain);

          osc.start(noteStart);
          osc.stop(noteStart + 0.6);
        });
        break;
      }

      case 'pop': {
        // Subtle pitch-dropping bubbly click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(950, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.08);

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.09);

        osc.connect(gain);
        gain.connect(masterGain);

        osc.start(now);
        osc.stop(now + 0.1);
        break;
      }

      case 'bell': {
        // Resonant metallic desk bell (1200 Hz fundamental + 2400 Hz harmonic + subtle metallic overtone)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(1200, now);
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(2400, now);

        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 1.0);
        osc2.stop(now + 1.0);
        break;
      }

      case 'glass': {
        // High crystalline glass clink (2793 Hz + 4186 Hz with snappy decay)
        const osc1 = ctx.createOscillator();
        const osc2 = ctx.createOscillator();
        const gain = ctx.createGain();

        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(2793, now);
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(4186, now);

        gain.gain.setValueAtTime(0.5, now);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

        osc1.connect(gain);
        osc2.connect(gain);
        gain.connect(masterGain);

        osc1.start(now);
        osc2.start(now);
        osc1.stop(now + 0.4);
        osc2.stop(now + 0.4);
        break;
      }

      default:
        // Fallback to classic ting
        playPresetTone('ting', volume);
        break;
    }
  } catch (err) {
    console.warn('Audio tone synthesis error:', err);
  }
}

/**
 * Plays the user's active notification sound alert.
 * Evaluates user preferences (soundEnabled, soundVolume, soundPreset, soundUrl)
 * and falls back seamlessly if custom audio playback encounters any error.
 */
export async function playNotificationSound(
  overrideUrl?: string,
  overrideVolume?: number,
  overridePreset?: SoundPreset,
  notificationType?: string
) {
  if (typeof window === 'undefined') return;

  const currentUser = useAppStore.getState().currentUser;
  const prefs = currentUser?.notificationPreferences;

  // Check if sound notifications are enabled (default to true)
  if (prefs?.soundEnabled === false && overridePreset === undefined) {
    return;
  }

  const volume = overrideVolume ?? prefs?.soundVolume ?? 0.8;
  let preset: SoundPreset = overridePreset ?? (prefs?.soundPreset as SoundPreset) ?? 'ting';
  let soundUrl: string | null | undefined = overrideUrl ?? prefs?.soundUrl;

  // If a notification type is provided and no manual override preset/url was passed,
  // resolve per-category sound customization with automatic inheritance
  if (notificationType && overridePreset === undefined && overrideUrl === undefined) {
    const category = getCategoryForNotificationType(notificationType);
    const categoryConfig = prefs?.typeSounds?.[category];

    if (categoryConfig?.preset === 'mute') {
      return; // Category explicitly muted
    }

    if (categoryConfig?.preset && categoryConfig.preset !== 'inherit') {
      if (categoryConfig.preset === 'custom') {
        preset = 'custom';
        soundUrl = categoryConfig.soundUrl || prefs?.soundUrl;
      } else {
        preset = categoryConfig.preset as SoundPreset;
        soundUrl = undefined;
      }
    }
  }

  if (preset === 'custom' && soundUrl) {
    try {
      let audio = customAudioCache.get(soundUrl);
      if (!audio) {
        audio = new Audio(soundUrl);
        audio.crossOrigin = 'anonymous';
        customAudioCache.set(soundUrl, audio);
      }
      audio.volume = Math.max(0, Math.min(1, volume));
      audio.currentTime = 0;
      await audio.play();
      return;
    } catch {
      // If custom audio fails (e.g. cross-origin restriction, network error, corrupted file),
      // gracefully fall back to the classic synthesized ting so the user never misses an alert
      playPresetTone('ting', volume);
    }
  } else {
    playPresetTone(preset, volume);
  }
}

// ---------------------------------------------------------------------------
// CLIENT-SIDE AUDIO CONVERTER & OPTIMIZER
// ---------------------------------------------------------------------------

export interface AudioConversionResult {
  file: File;
  originalSize: number;
  convertedSize: number;
  duration: number;
}

/**
 * Encodes an AudioBuffer into a standard 16-bit PCM Mono WAV Blob.
 */
function audioBufferToWavBlob(buffer: AudioBuffer, targetSampleRate = 24000): Blob {
  const numChannels = 1; // Downsample to mono for minimal size
  const duration = buffer.duration;
  const numSamples = Math.floor(duration * targetSampleRate);
  const bytesPerSample = 2; // 16-bit
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = targetSampleRate * blockAlign;
  const dataSize = numSamples * blockAlign;
  const headerSize = 44;
  const totalSize = headerSize + dataSize;

  const arrayBuffer = new ArrayBuffer(totalSize);
  const view = new DataView(arrayBuffer);

  // RIFF Chunk
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, 'WAVE');

  // fmt Subchunk
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
  view.setUint16(20, 1, true);  // AudioFormat (1 for PCM)
  view.setUint16(22, numChannels, true);
  view.setUint32(24, targetSampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true); // BitsPerSample

  // data Subchunk
  writeString(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  // Mix channels down to mono & resample to targetSampleRate
  const originalChannelData: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    originalChannelData.push(buffer.getChannelData(c));
  }

  const sampleRatio = buffer.sampleRate / targetSampleRate;
  let offset = 44;

  // Find peak amplitude for normalization
  let peak = 0;
  for (let i = 0; i < numSamples; i++) {
    const srcIndex = Math.min(buffer.length - 1, Math.floor(i * sampleRatio));
    let sample = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      sample += originalChannelData[c][srcIndex];
    }
    sample /= buffer.numberOfChannels;
    if (Math.abs(sample) > peak) peak = Math.abs(sample);
  }

  const gain = peak > 0.001 ? Math.min(1.5, 0.92 / peak) : 1; // Normalize to -0.7 dB

  // Fade out over the last 150ms to prevent clicks
  const fadeOutSamples = Math.floor(targetSampleRate * 0.15);
  const fadeStart = Math.max(0, numSamples - fadeOutSamples);

  for (let i = 0; i < numSamples; i++) {
    const srcIndex = Math.min(buffer.length - 1, Math.floor(i * sampleRatio));
    let sample = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      sample += originalChannelData[c][srcIndex];
    }
    sample = (sample / buffer.numberOfChannels) * gain;

    // Apply fade-out window
    if (i > fadeStart) {
      const fadeProgress = (i - fadeStart) / fadeOutSamples;
      sample *= Math.cos(fadeProgress * (Math.PI / 2));
    }

    // Clamp to -1..1
    const clamped = Math.max(-1, Math.min(1, sample));
    const intSample = clamped < 0 ? clamped * 0x8000 : clamped * 0x7FFF;
    view.setInt16(offset, intSample, true);
    offset += 2;
  }

  return new Blob([view], { type: 'audio/wav' });
}

function writeString(view: DataView, offset: number, string: string) {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
}

/**
 * Converts, trims, normalizes, and packages any user audio file
 * into a uniform minimal-MB notification sound (max 3 seconds, 24kHz mono WAV, ~50-120 KB).
 */
export async function convertAudioToNotificationSound(rawFile: File, maxDurationSeconds = 3.0): Promise<AudioConversionResult> {
  const originalSize = rawFile.size;

  // 1. Read array buffer
  const arrayBuffer = await rawFile.arrayBuffer();

  // 2. Decode audio via AudioContext
  const ctx = getAudioContext();
  const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);

  // 3. Clamp duration to maxDurationSeconds
  const targetDuration = Math.min(maxDurationSeconds, decodedBuffer.duration);
  const targetSampleRate = decodedBuffer.sampleRate;
  const numSamples = Math.floor(targetDuration * targetSampleRate);

  // Create trimmed buffer
  const trimmedBuffer = ctx.createBuffer(
    decodedBuffer.numberOfChannels,
    numSamples,
    targetSampleRate
  );

  for (let c = 0; c < decodedBuffer.numberOfChannels; c++) {
    const channelData = decodedBuffer.getChannelData(c);
    trimmedBuffer.copyToChannel(channelData.subarray(0, numSamples), c);
  }

  // 4. Encode to compact 24kHz mono WAV
  const wavBlob = audioBufferToWavBlob(trimmedBuffer, 24000);
  const safeBaseName = rawFile.name.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const convertedFile = new File([wavBlob], `${safeBaseName}_ting.wav`, {
    type: 'audio/wav',
    lastModified: Date.now(),
  });

  return {
    file: convertedFile,
    originalSize,
    convertedSize: convertedFile.size,
    duration: Number(targetDuration.toFixed(2)),
  };
}
