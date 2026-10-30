'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useAppStore } from '@/lib/store';
import { authApi, usersApi } from '@/api';
import { API_BASE_URL } from '@/api/client';
import { Settings, User as UserIcon, Users, Lock, Star, Eye, EyeOff, UploadCloud, Loader2, Code, Plus, Check, Copy, Trash2, Book, Sparkles, Cpu, Wifi, Gauge, X, Play, ShieldCheck, Bell, Palette, Volume2, Volume1, VolumeX, Music, CheckCircle2, AtSign, Smile, MessageSquare, RefreshCw, RotateCcw, AlertCircle } from 'lucide-react';
import { UserNotificationPreferences, UploadedSoundItem } from '@/types';
import {
  playNotificationSound,
  playPresetTone,
  convertAudioToNotificationSound,
  SOUND_PRESETS,
  SoundPreset,
  SAMPLE_CUSTOM_SOUNDS,
  SampleCustomSound,
  preloadSampleSounds,
  SOUND_CATEGORIES,
  SoundCategory,
  SoundChoice,
} from '@/lib/soundNotification';
import { SettingsSkeleton } from '@/components/ui/Skeleton';
import { toast } from '@/lib/toast';
import { ApiDocsSection } from '@/components/settings/ApiDocsSection';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import { ConfirmDeleteModal } from '@/components/modals/ConfirmDeleteModal';
import { uploadApi } from '@/api/upload';
import { triggerMentionConfetti } from '@/components/ui/MentionConfetti';
import {
  getClientPerfProfile,
  setPerfTierOverride,
  getPerfTierOverride,
  PerfProfile,
  PerfTier,
} from '@/lib/perfAdaptive';

interface ApiKey {
  id: string;
  name: string;
  key: string;
  createdAt: string;
  lastUsed: string | null;
}

function StarRating({ rating }: { rating: number }) {
  return (
    <div className="flex items-center gap-0.5">
      {[1, 2, 3].map((n) => (
        <Star
          key={n}
          className={`w-3.5 h-3.5 ${n <= rating ? 'text-yellow-400 fill-yellow-400' : 'text-zinc-700 fill-zinc-700'}`}
        />
      ))}
      <span className="ml-1.5 text-sm text-zinc-300">{rating}</span>
    </div>
  );
}

export default function SettingsPage() {
  const { currentUser, setCurrentUser } = useAppStore();
  const isAdmin = currentUser?.systemRole === 'ADMIN' || (currentUser?.roles || []).some(r => r?.trim().toUpperCase() === 'ADMIN');

  const [loading, setLoading] = useState(!currentUser);
  
  // Profile State
  const [name, setName] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [confettiUrl, setConfettiUrl] = useState('');
  const [dailySheetUrl, setDailySheetUrl] = useState('');
  const [profileSaving, setProfileSaving] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isUploadingConfetti, setIsUploadingConfetti] = useState(false);
  const [isUploadingSound, setIsUploadingSound] = useState(false);
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const [audioConversionStats, setAudioConversionStats] = useState<string | null>(null);
  const [auditioningPreset, setAuditioningPreset] = useState<string | null>(null);
  const [perfProfile, setPerfProfile] = useState<PerfProfile | null>(null);
  const [perfOverride, setPerfOverride] = useState<PerfTier | 'auto'>('auto');

  // Password State
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  // API Keys State
  const [apiKeys, setApiKeys] = useState<ApiKey[]>([]);
  const [loadingKeys, setLoadingKeys] = useState(true);
  const [newKeyName, setNewKeyName] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [keyToDelete, setKeyToDelete] = useState<ApiKey | null>(null);

  // Notification Preferences State
  const [notifPrefs, setNotifPrefs] = useState<UserNotificationPreferences>({
    status: true,
    checklists: true,
    audits: true,
    assigned: true,
    comments: true,
    mentions: true,
    defaultView: 'for_me',
    confettiEnabled: false,
    receiveConfetti: false,
    soundEnabled: true,
    soundPreset: 'ting',
    soundVolume: 0.8,
    soundUrl: null,
    uploadedSoundUrl: null,
    uploadedSounds: [],
    typeSounds: {},
  });

  // Scrollspy Refs
  const profileRef = useRef<HTMLDivElement>(null);
  const appearanceRef = useRef<HTMLDivElement>(null);
  const confettiRef = useRef<HTMLDivElement>(null);
  const passwordRef = useRef<HTMLDivElement>(null);
  const notificationsRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<HTMLDivElement>(null);
  const docsRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState('profile');

  // Load user
  useEffect(() => {
    if (!currentUser) {
      authApi.getMe()
        .then(({ user }) => {
          setCurrentUser(user);
          setPerfProfile(getClientPerfProfile());
          setPerfOverride(getPerfTierOverride());
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
      loadApiKeys(currentUser.id);
      setPerfProfile(getClientPerfProfile());
      setPerfOverride(getPerfTierOverride());
    }
    preloadSampleSounds();
  }, []);

  // Populate profile fields
  useEffect(() => {
    if (currentUser) {
      setName(currentUser.name || '');
      setAvatarUrl(currentUser.avatarUrl || '');
      setConfettiUrl(currentUser.confettiUrl || '');
      setDailySheetUrl(currentUser.dailySheetUrl || '');
      if (currentUser.notificationPreferences) {
        setNotifPrefs({
          status: currentUser.notificationPreferences.status !== false,
          checklists: currentUser.notificationPreferences.checklists !== false,
          audits: currentUser.notificationPreferences.audits !== false,
          assigned: currentUser.notificationPreferences.assigned !== false,
          comments: currentUser.notificationPreferences.comments !== false,
          mentions: currentUser.notificationPreferences.mentions !== false,
          defaultView: currentUser.notificationPreferences.defaultView || 'for_me',
          confettiEnabled: currentUser.notificationPreferences.confettiEnabled === true,
          receiveConfetti: currentUser.notificationPreferences.receiveConfetti === true,
          soundEnabled: currentUser.notificationPreferences.soundEnabled !== false,
          soundPreset: currentUser.notificationPreferences.soundPreset || 'ting',
          soundVolume: currentUser.notificationPreferences.soundVolume ?? 0.8,
          soundUrl: currentUser.notificationPreferences.soundUrl || null,
          uploadedSoundUrl: currentUser.notificationPreferences.uploadedSoundUrl || null,
          uploadedSounds: currentUser.notificationPreferences.uploadedSounds || [],
          typeSounds: currentUser.notificationPreferences.typeSounds || {},
        });
      }
      setLoading(false);
      loadApiKeys(currentUser.id);
      setPerfProfile(getClientPerfProfile());
      setPerfOverride(getPerfTierOverride());
    }
  }, [currentUser]);

  // Scrollspy observer
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id);
          }
        });
      },
      { rootMargin: '-20% 0px -80% 0px' }
    );

    if (profileRef.current) observer.observe(profileRef.current);
    if (appearanceRef.current) observer.observe(appearanceRef.current);
    if (confettiRef.current) observer.observe(confettiRef.current);
    if (passwordRef.current) observer.observe(passwordRef.current);
    if (notificationsRef.current) observer.observe(notificationsRef.current);
    if (apiRef.current) observer.observe(apiRef.current);
    if (docsRef.current) observer.observe(docsRef.current);

    return () => observer.disconnect();
  }, []);

  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  const handleTogglePreference = async (key: keyof Omit<UserNotificationPreferences, 'defaultView'>) => {
    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      [key]: !notifPrefs[key],
    };
    setNotifPrefs(updated);
    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      toast.success('Notification preferences updated.');
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to update preferences.');
    }
  };

  const handleSetDefaultView = async (view: 'for_me' | 'show_all') => {
    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      defaultView: view,
    };
    setNotifPrefs(updated);
    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      toast.success(`Default activity view set to ${view === 'for_me' ? 'For Me' : 'Show All'}.`);
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to update default view.');
    }
  };

  // Profile Methods
  const handleSaveProfile = async () => {
    setProfileSaving(true);
    try {
      const res = await authApi.updateProfile({ name, avatarUrl, dailySheetUrl });
      setCurrentUser(res.user);
      toast.success('Profile updated successfully.');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to update profile.');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleFileUpload = async (file: File) => {
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Avatar file size cannot exceed 2MB');
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('folder', 'avatars');

      const res = await fetch(`${API_BASE_URL}/upload/avatar`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      });

      if (!res.ok) throw new Error('Upload failed');
      const data = await res.json();
      setAvatarUrl(data.url);
      setCurrentUser(data.user);
      toast.success("Avatar updated successfully.");
    } catch (error: any) {
      toast.error('Failed to upload avatar.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileUpload(e.target.files[0]);
    }
  };

  // Auto-compress confetti image to featherweight WebP under 256x256 (~25-45 KB)
  const optimizeConfettiFile = async (file: File): Promise<File> => {
    // If already a small GIF, leave untouched
    if (file.type === 'image/gif' && file.size <= 500 * 1024) {
      return file;
    }
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const maxDimension = 256;
          let width = img.width;
          let height = img.height;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(file);
          ctx.drawImage(img, 0, 0, width, height);
          canvas.toBlob(
            (blob) => {
              if (!blob) return resolve(file);
              const optimized = new File(
                [blob],
                file.name.replace(/\.[^.]+$/, '.webp'),
                { type: 'image/webp', lastModified: Date.now() }
              );
              resolve(optimized);
            },
            'image/webp',
            0.85
          );
        };
        img.onerror = () => resolve(file);
        img.src = e.target?.result as string;
      };
      reader.onerror = () => resolve(file);
      reader.readAsDataURL(file);
    });
  };

  // Mention Confetti Methods
  const handleConfettiUpload = async (rawFile: File) => {
    setIsUploadingConfetti(true);
    try {
      const file = await optimizeConfettiFile(rawFile);
      if (file.size > 500 * 1024) {
        toast.error('Confetti image cannot exceed 500 KB for fast loading');
        setIsUploadingConfetti(false);
        return;
      }
      const res = await uploadApi.uploadConfetti(file);
      setConfettiUrl(res.url);
      setCurrentUser(res.user);
      const kbSize = Math.max(1, Math.round(file.size / 1024));
      // Auto-agree on custom upload if not yet opted in
      if (!notifPrefs.confettiEnabled || !notifPrefs.receiveConfetti) {
        const updatedPrefs: UserNotificationPreferences = {
          ...notifPrefs,
          confettiEnabled: true,
          receiveConfetti: true,
        };
        setNotifPrefs(updatedPrefs);
        await authApi.updateProfile({ notificationPreferences: updatedPrefs });
      }
      toast.success(`Mention confetti image updated successfully (${kbSize} KB)`);
      triggerMentionConfetti(res.user, undefined, true);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to upload confetti image');
    } finally {
      setIsUploadingConfetti(false);
    }
  };

  const handleConfettiFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleConfettiUpload(e.target.files[0]);
    }
  };

  const handleDeleteConfetti = async () => {
    try {
      const res = await uploadApi.deleteConfetti();
      setConfettiUrl('');
      setCurrentUser(res.user);
      toast.success('Removed custom confetti image (reverted to avatar)');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove confetti image');
    }
  };

  const handleTestConfetti = () => {
    if (!notifPrefs.receiveConfetti) {
      toast.error('Please agree to "Receive Confetti Animations" below to preview animations on your screen.');
      return;
    }
    triggerMentionConfetti({
      id: currentUser?.id,
      name: name || currentUser?.name || 'You',
      avatarUrl,
      confettiUrl,
      notificationPreferences: {
        ...notifPrefs,
        confettiEnabled: true,
      },
    }, undefined, true);
  };

  const handlePerfOverrideChange = (tier: PerfTier | 'auto') => {
    setPerfTierOverride(tier);
    setPerfOverride(tier);
    setPerfProfile(getClientPerfProfile());
    toast.success(tier === 'auto' ? 'Hardware adaptation set to Auto' : `Hardware tier overridden to ${tier.toUpperCase()}`);
  };

  // Sound Notification Methods
  const handleToggleSound = async () => {
    const updatedSoundEnabled = !notifPrefs.soundEnabled;
    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      soundEnabled: updatedSoundEnabled,
    };
    setNotifPrefs(updated);
    if (updatedSoundEnabled) {
      playNotificationSound(undefined, notifPrefs.soundVolume ?? 0.8, notifPrefs.soundPreset as SoundPreset);
    }
    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      toast.success(updatedSoundEnabled ? 'Notification sound enabled' : 'Notification sound muted');
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to update sound preferences');
    }
  };

  const handleChangeSoundVolume = async (volume: number) => {
    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      soundVolume: volume,
    };
    setNotifPrefs(updated);
    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
    } catch {
      // silently fail optimistic slider
    }
  };

  const handleAuditionPreset = (preset: SoundPreset, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAuditioningPreset(preset);
    playPresetTone(preset, notifPrefs.soundVolume ?? 0.8);
    setTimeout(() => {
      setAuditioningPreset((prev) => (prev === preset ? null : prev));
    }, 600);
  };

  const handleAuditionSample = (sample: SampleCustomSound, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setAuditioningPreset(sample.id);
    playNotificationSound(sample.url, notifPrefs.soundVolume ?? 0.8, 'custom');
    setTimeout(() => {
      setAuditioningPreset((prev) => (prev === sample.id ? null : prev));
    }, 1200);
  };

  const SAMPLE_SOUND_URL_SET = useMemo(() => new Set<string>(SAMPLE_CUSTOM_SOUNDS.map((s) => s.url)), []);

  const isSampleUrl = (url?: string | null): boolean => {
    if (!url) return false;
    if (SAMPLE_SOUND_URL_SET.has(url)) return true;
    const filename = url.split('/').pop()?.split('?')[0];
    return SAMPLE_CUSTOM_SOUNDS.some((s) => s.url.endsWith(filename || ''));
  };

  const userUploadedSounds: UploadedSoundItem[] = useMemo((): UploadedSoundItem[] => {
    if (Array.isArray(notifPrefs.uploadedSounds) && notifPrefs.uploadedSounds.length > 0) {
      return notifPrefs.uploadedSounds;
    }
    const sounds: UploadedSoundItem[] = [];
    const seenUrls = new Set<string>();
    const genUrl = notifPrefs.uploadedSoundUrl || (
      notifPrefs.soundUrl && !isSampleUrl(notifPrefs.soundUrl) ? notifPrefs.soundUrl : null
    );
    if (genUrl && !isSampleUrl(genUrl)) {
      seenUrls.add(genUrl);
      sounds.push({ id: 'uploaded-default', name: 'Custom Audio', url: genUrl });
    }
    if (notifPrefs.typeSounds) {
      Object.entries(notifPrefs.typeSounds).forEach(([cat, cfg]) => {
        if (cfg?.soundUrl && !isSampleUrl(cfg.soundUrl) && !seenUrls.has(cfg.soundUrl)) {
          seenUrls.add(cfg.soundUrl);
          const catName = SOUND_CATEGORIES.find((c) => c.id === cat)?.name || cat;
          sounds.push({ id: `uploaded-${cat}`, name: `${catName} Audio`, url: cfg.soundUrl });
        }
      });
    }
    return sounds;
  }, [notifPrefs.uploadedSounds, notifPrefs.uploadedSoundUrl, notifPrefs.soundUrl, notifPrefs.typeSounds, SAMPLE_SOUND_URL_SET]);

  const customUploadedCount = userUploadedSounds.length;
  const isMaxSoundsReached = customUploadedCount >= 4;

  const defaultSoundName = useMemo(() => {
    if ((notifPrefs.soundPreset || 'ting') === 'custom') {
      const url = notifPrefs.soundUrl;
      const matchUploaded = userUploadedSounds.find((s: UploadedSoundItem) => s.url === url);
      if (matchUploaded) return matchUploaded.name;
      const matchSample = SAMPLE_CUSTOM_SOUNDS.find((s) => {
        const filename = s.url.split('/').pop()?.split('?')[0];
        return s.url === url || (filename && url?.endsWith(filename));
      });
      if (matchSample) return matchSample.name;
      return 'Custom Audio';
    }
    return SOUND_PRESETS.find((p) => p.id === (notifPrefs.soundPreset || 'ting'))?.name || 'Classic Ting';
  }, [notifPrefs.soundPreset, notifPrefs.soundUrl, userUploadedSounds]);

  const handleSetSoundAsDefault = async (sound: UploadedSoundItem | SampleCustomSound) => {
    const isSample = isSampleUrl(sound.url);
    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      soundPreset: 'custom',
      soundUrl: sound.url,
      uploadedSoundUrl: isSample ? notifPrefs.uploadedSoundUrl : sound.url,
      soundEnabled: true,
    };
    setNotifPrefs(updated);
    setAuditioningPreset(`active-${sound.id}`);
    playNotificationSound(sound.url, notifPrefs.soundVolume ?? 0.8, 'custom');
    setTimeout(() => setAuditioningPreset(null), 1200);

    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      toast.success(`Default alert sound set to "${sound.name}"`);
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to set default sound');
    }
  };

  const handleChangeSoundPreset = async (preset: SoundPreset) => {
    const targetSoundUrl = preset === 'custom'
      ? (notifPrefs.soundUrl || notifPrefs.uploadedSoundUrl || SAMPLE_CUSTOM_SOUNDS[0]?.url)
      : notifPrefs.soundUrl;

    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      soundPreset: preset,
      soundUrl: targetSoundUrl,
      soundEnabled: true,
    };
    setNotifPrefs(updated);
    if (preset !== 'custom') {
      playPresetTone(preset, notifPrefs.soundVolume ?? 0.8);
    } else if (targetSoundUrl) {
      playNotificationSound(targetSoundUrl, notifPrefs.soundVolume ?? 0.8, 'custom');
    }
    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      toast.success(`Notification sound set to ${preset === 'custom' ? 'Custom Sound' : preset.toUpperCase()}`);
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to update sound preset');
    }
  };

  const handleChangeCategorySound = async (
    category: SoundCategory,
    preset: SoundChoice,
    soundUrl?: string | null
  ) => {
    const currentTypeSounds = notifPrefs.typeSounds || {};
    let resolvedUrl: string | null | undefined = soundUrl;

    if (preset === 'custom') {
      if (soundUrl !== undefined) {
        resolvedUrl = soundUrl;
      } else {
        resolvedUrl = currentTypeSounds[category]?.soundUrl || notifPrefs.uploadedSoundUrl || notifPrefs.soundUrl;
      }
    } else {
      resolvedUrl = undefined;
    }

    const updatedTypeSounds = {
      ...currentTypeSounds,
      [category]: {
        preset,
        soundUrl: resolvedUrl,
      },
    };

    const updated: UserNotificationPreferences = {
      ...notifPrefs,
      typeSounds: updatedTypeSounds,
    };
    setNotifPrefs(updated);

    if (preset === 'custom' && resolvedUrl) {
      playNotificationSound(resolvedUrl, notifPrefs.soundVolume ?? 0.8, 'custom');
    } else if (preset !== 'inherit' && preset !== 'mute') {
      playPresetTone(preset as SoundPreset, notifPrefs.soundVolume ?? 0.8);
    }

    try {
      const res = await authApi.updateProfile({ notificationPreferences: updated });
      setCurrentUser(res.user);
      const categoryLabel = SOUND_CATEGORIES.find((c) => c.id === category)?.name || category;
      toast.success(`${categoryLabel} alert sound updated`);
    } catch (e: any) {
      setNotifPrefs(notifPrefs);
      toast.error(e?.message || 'Failed to update category sound');
    }
  };

  const handleAuditionCategory = (
    category: SoundCategory,
    e?: React.MouseEvent
  ) => {
    if (e) e.stopPropagation();
    const config = notifPrefs.typeSounds?.[category];
    const choice = config?.preset || 'inherit';

    if (choice === 'mute') {
      toast.info('This category is set to Mute (no sound)');
      return;
    }

    setAuditioningPreset(`category-${category}`);

    if (choice === 'inherit') {
      if ((notifPrefs.soundPreset || 'ting') === 'custom' && notifPrefs.soundUrl) {
        playNotificationSound(notifPrefs.soundUrl, notifPrefs.soundVolume ?? 0.8, 'custom');
      } else {
        playPresetTone((notifPrefs.soundPreset as SoundPreset) || 'ting', notifPrefs.soundVolume ?? 0.8);
      }
    } else if (choice === 'custom') {
      const url = config?.soundUrl || notifPrefs.uploadedSoundUrl || notifPrefs.soundUrl;
      if (url) {
        playNotificationSound(url, notifPrefs.soundVolume ?? 0.8, 'custom');
      } else {
        playPresetTone('ting', notifPrefs.soundVolume ?? 0.8);
      }
    } else {
      playPresetTone(choice as SoundPreset, notifPrefs.soundVolume ?? 0.8);
    }

    setTimeout(() => {
      setAuditioningPreset((prev) => (prev === `category-${category}` ? null : prev));
    }, 700);
  };

  const handleSoundUpload = async (rawFile: File) => {
    setIsUploadingSound(true);
    setAudioConversionStats(null);
    try {
      const validTypes = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/x-m4a', 'audio/m4a', 'audio/aac'];
      const ext = (rawFile.name || '').split('.').pop()?.toLowerCase();
      if (!validTypes.includes(rawFile.type) && !['mp3', 'wav', 'ogg', 'm4a', 'aac'].includes(ext || '')) {
        toast.error('Please upload an audio file (.mp3, .wav, .ogg, or .m4a)');
        setIsUploadingSound(false);
        return;
      }

      if (customUploadedCount >= 4) {
        toast.error('Maximum of 4 custom notification sounds reached. Please delete an existing sound before uploading a new one.');
        setIsUploadingSound(false);
        return;
      }

      const conversion = await convertAudioToNotificationSound(rawFile, 3.0);
      const convKb = Math.max(1, Math.round(conversion.convertedSize / 1024));

      if (conversion.file.size > 500 * 1024) {
        toast.error('Notification sound cannot exceed 500 KB');
        setIsUploadingSound(false);
        return;
      }

      const res = await uploadApi.uploadSound(conversion.file);
      setCurrentUser(res.user);

      const cleanName = (res.name || rawFile.name.replace(/\.[^.]+$/, '').replace(/_ting$/i, '').replace(/[_-]+/g, ' '))
        .trim()
        .slice(0, 30) || 'Custom Audio';

      const newSoundItem: UploadedSoundItem = {
        id: res.soundId || `custom-${Date.now()}`,
        name: cleanName,
        url: res.url,
      };

      const nextUploadedSounds = [...userUploadedSounds, newSoundItem];
      const updatedPrefs: UserNotificationPreferences = {
        ...notifPrefs,
        uploadedSounds: nextUploadedSounds,
        uploadedSoundUrl: res.url,
        soundUrl: res.url,
        soundPreset: 'custom',
        soundEnabled: true,
      };
      setNotifPrefs(updatedPrefs);
      toast.success(`"${newSoundItem.name}" uploaded successfully (${convKb} KB)`);
      playNotificationSound(res.url, notifPrefs.soundVolume ?? 0.8, 'custom');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to convert or upload notification sound');
    } finally {
      setIsUploadingSound(false);
    }
  };

  const handleSoundFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleSoundUpload(e.target.files[0]);
      e.target.value = '';
    }
  };

  const handleDeleteSound = async (params?: { soundId?: string; soundUrl?: string; category?: SoundCategory } | SoundCategory) => {
    try {
      if (typeof params === 'string' || (params && 'category' in params && !params.soundId && !params.soundUrl)) {
        const cat = typeof params === 'string' ? params : params?.category;
        if (!cat) return;
        const res = await uploadApi.deleteSound({ category: cat });
        setCurrentUser(res.user);
        const currentTypeSounds = { ...(notifPrefs.typeSounds || {}) };
        currentTypeSounds[cat] = {
          preset: 'inherit',
          soundUrl: null,
        };
        const updatedPrefs: UserNotificationPreferences = {
          ...notifPrefs,
          typeSounds: currentTypeSounds,
        };
        setNotifPrefs(updatedPrefs);
        const catLabel = SOUND_CATEGORIES.find((c) => c.id === cat)?.name || cat;
        toast.success(`${catLabel} reset to Default chime`);
      } else if (params && (params.soundId || params.soundUrl)) {
        const res = await uploadApi.deleteSound({ soundId: params.soundId, soundUrl: params.soundUrl });
        setCurrentUser(res.user);
        const remaining = userUploadedSounds.filter((s: UploadedSoundItem) => s.id !== params.soundId && s.url !== params.soundUrl);
        const deletedUrl = params.soundUrl || userUploadedSounds.find((s: UploadedSoundItem) => s.id === params.soundId)?.url;
        const updatedPrefs: UserNotificationPreferences = {
          ...notifPrefs,
          uploadedSounds: remaining,
          soundUrl: notifPrefs.soundUrl === deletedUrl ? null : notifPrefs.soundUrl,
          uploadedSoundUrl: notifPrefs.uploadedSoundUrl === deletedUrl ? (remaining[0]?.url || null) : notifPrefs.uploadedSoundUrl,
          soundPreset: notifPrefs.soundUrl === deletedUrl ? 'ting' : notifPrefs.soundPreset,
        };
        if (updatedPrefs.typeSounds) {
          const nextTypeSounds = { ...updatedPrefs.typeSounds };
          for (const [k, v] of Object.entries(nextTypeSounds)) {
            if (v?.soundUrl === deletedUrl) {
              nextTypeSounds[k as SoundCategory] = { preset: 'inherit', soundUrl: null };
            }
          }
          updatedPrefs.typeSounds = nextTypeSounds;
        }
        setNotifPrefs(updatedPrefs);
        toast.success('Custom sound removed from library');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to remove sound');
    }
  };

  // Password Methods
  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast.error('New password must be at least 6 characters.');
      return;
    }
    setPwSaving(true);
    try {
      await authApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
    } catch (e: any) {
      toast.error(e?.message || 'Failed to change password.');
    } finally {
      setPwSaving(false);
    }
  };

  // API Methods
  const loadApiKeys = async (userId: string) => {
    try {
      setLoadingKeys(true);
      const res = await usersApi.getApiKeys(userId);
      setApiKeys(res.apiKeys);
    } catch (err: any) {
      toast.error('Failed to load API keys');
    } finally {
      setLoadingKeys(false);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim() || !currentUser) return;
    try {
      const res = await usersApi.createApiKey(currentUser.id, newKeyName.trim());
      setApiKeys([res.apiKey, ...apiKeys]);
      setNewKeyName('');
      toast.success('API Key created successfully');
    } catch (err: any) {
      toast.error('Failed to create API key');
    }
  };

  const handleDeleteApiKey = async (keyId: string) => {
    if (!currentUser) return;
    try {
      await usersApi.deleteApiKey(currentUser.id, keyId);
      setApiKeys(apiKeys.filter(k => k.id !== keyId));
      toast.success('API Key revoked');
      setKeyToDelete(null);
    } catch (err: any) {
      toast.error('Failed to revoke API key');
    }
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(id);
    setTimeout(() => setCopiedKey(null), 2000);
  };
  if (loading) {
    return <SettingsSkeleton />;
  }

  return (
    <div className="flex w-full h-full bg-background overflow-hidden">
      {/* Settings Sidebar (Scrollspy) */}
      <div className="w-64 shrink-0 bg-background border-r border-[var(--border)] flex flex-col">
        <div className="p-4 border-b border-[var(--border)]">
          <h1 className="text-sm font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
            <Settings className="w-4 h-4" style={{ color: 'var(--muted)' }} />
            Settings
          </h1>
        </div>
        <nav className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
          {[
            { id: 'profile', label: 'Profile', icon: UserIcon },
            { id: 'appearance', label: 'Appearance', icon: Palette },
            { id: 'confetti', label: 'Mention Confetti', icon: Sparkles },
            { id: 'password', label: 'Password', icon: Lock },
            { id: 'notifications', label: 'Notifications', icon: Bell },
            { id: 'api', label: 'API Integrations', icon: Code },
            { id: 'docs', label: 'API Documentation', icon: Book },
          ].map((item) => {
            const IconComponent = item.icon;
            const isActive = activeSection === item.id;
            return (
              <button
                key={item.id}
                onClick={() => scrollToSection(item.id)}
                className={`flex items-center gap-2 px-3 py-2 w-full text-left rounded-lg text-sm transition-all cursor-pointer theme-focus-ring ${
                  isActive ? '' : 'hover:bg-accent hover:text-foreground'
                }`}
                style={{
                  backgroundColor: isActive ? 'color-mix(in srgb, var(--accent) 15%, var(--surface))' : 'transparent',
                  color: isActive ? 'var(--text)' : 'var(--muted)',
                  fontWeight: isActive ? 600 : 400,
                }}
              >
                <IconComponent
                  className="w-4 h-4 transition-colors"
                  style={{ color: isActive ? 'var(--accent)' : 'var(--muted)' }}
                />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 h-full overflow-y-auto custom-scrollbar bg-background">
        <div className="max-w-[700px] mx-auto py-10 px-8 pb-32 space-y-12">
          
          <div className="mb-4">
            <h1 className="text-2xl font-bold flex items-center gap-2" style={{ color: 'var(--text)' }}>
              Account Settings
            </h1>
            <p className="text-sm mt-1" style={{ color: 'var(--muted)' }}>
              Manage your profile details, security, appearance, and integrations.
            </p>
          </div>

          {/* PROFILE SECTION */}
          <section id="profile" ref={profileRef} className="scroll-mt-8 space-y-6">
            <div className="bg-background border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-card">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <UserIcon className="w-4 h-4 text-zinc-400" />
                  Account Profile
                </h2>
              </div>
              <div className="p-6">
                {/* Read Only Stats */}
                <div className="bg-secondary/50 rounded-lg p-4 border border-zinc-800 mb-6 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Email</span>
                    <span className="text-sm text-zinc-300">{currentUser?.email}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">System Role</span>
                    <span className="text-xs font-bold uppercase tracking-wider text-yellow-400">
                      {currentUser?.systemRole}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Employment</span>
                    <span className="text-sm font-medium text-zinc-300">{currentUser?.employmentType || 'N/A'}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Star Rating</span>
                    <StarRating rating={currentUser?.starRating || 1} />
                  </div>
                </div>

                <div className="space-y-5">
                  <div className="flex items-start gap-6">
                    {/* Avatar Upload */}
                    <div className="shrink-0">
                      <label className="block text-[12px] text-zinc-400 mb-1.5">Avatar Image</label>
                      <label className="relative w-16 h-16 rounded-full overflow-hidden bg-zinc-800 border border-zinc-700 flex items-center justify-center cursor-pointer group block">
                        {avatarUrl ? (
                          <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
                        ) : (
                          <UserIcon className="w-6 h-6 text-zinc-500" />
                        )}
                        
                        {/* Hover Overlay */}
                        <div className="absolute inset-0 bg-black/60 flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                          <UploadCloud className="w-4 h-4 text-zinc-100 drop-shadow-md mb-0.5" />
                          <span className="text-[10px] font-medium text-zinc-100 drop-shadow-md leading-none">Upload</span>
                        </div>

                        {/* Loading Overlay */}
                        {isUploading && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
                            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                          </div>
                        )}
                        
                        <input 
                          type="file" 
                          className="hidden" 
                          accept="image/*"
                          onChange={handleFileChange}
                          disabled={isUploading}
                        />
                      </label>
                    </div>

                    {/* Display Name Input */}
                    <div className="flex-1">
                      <label className="block text-[12px] text-zinc-400 mb-1.5">Display Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        maxLength={100}
                        className="w-full bg-card border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                      />
                      <div className="flex justify-between items-start mt-1.5 px-1">
                        <span className="text-[11px] text-zinc-500">This name will be displayed across your workspace.</span>
                        <span className="text-[10px] text-zinc-500 font-medium">{name.length}/100</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[12px] text-zinc-400 mb-1.5">Google Daily Sheet URL</label>
                    <input
                      type="text"
                      value={dailySheetUrl}
                      onChange={e => setDailySheetUrl(e.target.value)}
                      className="w-full bg-card border border-zinc-800 rounded-lg px-3 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      onClick={handleSaveProfile}
                      disabled={profileSaving}
                      className="w-full py-2 bg-zinc-100 hover:bg-white text-zinc-900 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                    >
                      {profileSaving ? 'Saving...' : 'Save Profile'}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* APPEARANCE & THEMES SECTION */}
          <div ref={appearanceRef}>
            <AppearanceSettings />
          </div>

          {/* MENTION CONFETTI & CELEBRATION SECTION */}
          <section id="confetti" ref={confettiRef} className="scroll-mt-8 space-y-6">
            <div className="bg-background border border-zinc-800 rounded-xl overflow-hidden">
              {/* Header: Title + Subtitle + Primary CTA */}
              <div className="px-6 py-4 border-b border-zinc-800 bg-card flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-400" />
                    Mention Celebration Confetti
                  </h2>
                  <p className="text-xs text-zinc-500 mt-0.5">
                    Trigger a personalized celebration burst when teammates mention you in tasks, comments, and activity.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleTestConfetti}
                  className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-indigo-600 hover:bg-indigo-500 text-white shadow-xs transition-all cursor-pointer hover:scale-102 active:scale-98 shrink-0 self-start sm:self-auto"
                >
                  <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
                  <span>Test Confetti Burst</span>
                </button>
              </div>

              {/* User Consent & Permissions Row */}
              <div className="p-6 border-b border-zinc-800/80 bg-zinc-900/30">
                <div className="space-y-3">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">Celebration Permissions & Consent</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Nexus only displays confetti celebrations when explicitly agreed to by both the mentioned user and the viewer.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
                    {/* Agreement 1: Celebrate My Mentions */}
                    <div className={`p-4 rounded-xl border transition-all ${
                      notifPrefs.confettiEnabled
                        ? 'bg-indigo-500/5 border-indigo-500/30'
                        : 'bg-zinc-900/40 border-zinc-800/80'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-0 pr-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-200 whitespace-nowrap">Celebrate My Mentions</span>
                            <span className={`inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 leading-tight ${
                              notifPrefs.confettiEnabled
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              {notifPrefs.confettiEnabled ? 'Agreed & Active' : 'Not Agreed (Disabled)'}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            I agree to allow a celebration confetti burst to appear on screen when teammates @mention me.
                          </p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(notifPrefs.confettiEnabled)}
                          onClick={() => handleTogglePreference('confettiEnabled')}
                          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-0.5 ${
                            notifPrefs.confettiEnabled ? 'bg-indigo-600' : 'bg-zinc-700'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                              notifPrefs.confettiEnabled ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>

                    {/* Agreement 2: Receive Confetti Animations */}
                    <div className={`p-4 rounded-xl border transition-all ${
                      notifPrefs.receiveConfetti
                        ? 'bg-indigo-500/5 border-indigo-500/30'
                        : 'bg-zinc-900/40 border-zinc-800/80'
                    }`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1.5 flex-1 min-w-0 pr-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-semibold text-zinc-200 whitespace-nowrap">Receive Confetti Animations</span>
                            <span className={`inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 leading-tight ${
                              notifPrefs.receiveConfetti
                                ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/25'
                                : 'bg-zinc-800 text-zinc-400'
                            }`}>
                              {notifPrefs.receiveConfetti ? 'Agreed & Active' : 'Animations Off'}
                            </span>
                          </div>
                          <p className="text-[11px] text-zinc-400 leading-relaxed">
                            I agree to receive and display celebration confetti animations on my screen when mentions occur.
                          </p>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={Boolean(notifPrefs.receiveConfetti)}
                          onClick={() => handleTogglePreference('receiveConfetti')}
                          className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 mt-0.5 ${
                            notifPrefs.receiveConfetti ? 'bg-indigo-600' : 'bg-zinc-700'
                          }`}
                        >
                          <div
                            className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                              notifPrefs.receiveConfetti ? 'translate-x-5' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Row 1: Visual Asset / Confetti Avatar */}
              <div className="p-6 border-b border-zinc-800/80 bg-zinc-900/10">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
                  <div className="flex items-start sm:items-center gap-4">
                    {/* Avatar Ring Preview */}
                    <div className="relative group shrink-0">
                      <div className={`relative w-16 h-16 rounded-full overflow-hidden bg-zinc-800 border-2 flex items-center justify-center transition-all ${
                        confettiUrl ? 'border-indigo-500 shadow-md shadow-indigo-500/10' : 'border-zinc-700'
                      }`}>
                        {confettiUrl || avatarUrl ? (
                          <img
                            src={confettiUrl || avatarUrl}
                            alt="Confetti Preview"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <UserIcon className="w-7 h-7 text-zinc-500" />
                        )}

                        {isUploadingConfetti && (
                          <div className="absolute inset-0 bg-black/70 flex items-center justify-center z-10">
                            <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
                          </div>
                        )}
                      </div>

                      {/* Mini Sparkle Floating Pin */}
                      <div
                        className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center text-[10px] border border-background shadow-xs ${
                          confettiUrl ? 'bg-indigo-600 text-white' : 'bg-zinc-700 text-zinc-300'
                        }`}
                        title={confettiUrl ? 'Custom Confetti Image Active' : 'Defaulting to Account Avatar'}
                      >
                        <Sparkles className="w-2.5 h-2.5" />
                      </div>
                    </div>

                    {/* Metadata & Description */}
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-200 whitespace-nowrap">Confetti Image</h3>
                        <span className={`inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 leading-tight ${
                          confettiUrl
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                            : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/50'
                        }`}>
                          {confettiUrl ? 'Custom Image Active' : 'Using Profile Avatar'}
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        {confettiUrl
                          ? 'Custom image uploaded. This asset bursts onto teammate screens whenever you are mentioned.'
                          : 'No custom confetti image set. Nexus automatically uses your standard profile avatar as a fallback.'}
                      </p>
                      <span className="text-[11px] text-zinc-500 block">
                        PNG, JPG, or WEBP up to 500 KB. High-res images are auto-compressed to ~30 KB for instant burst performance.
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 self-start sm:self-center shrink-0">
                    <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-zinc-800 hover:bg-zinc-700 text-zinc-200 cursor-pointer transition-colors border border-zinc-700/60 shadow-xs">
                      <UploadCloud className="w-3.5 h-3.5 text-zinc-300" />
                      <span>{confettiUrl ? 'Change Image' : 'Upload Image'}</span>
                      <input
                        type="file"
                        className="hidden"
                        accept="image/*"
                        onChange={handleConfettiFileChange}
                        disabled={isUploadingConfetti}
                      />
                    </label>

                    {confettiUrl && (
                      <button
                        type="button"
                        onClick={handleDeleteConfetti}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 transition-colors cursor-pointer border border-transparent hover:border-rose-500/20"
                        title="Revert to profile avatar"
                      >
                        <X className="w-3.5 h-3.5" />
                        <span>Reset</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Row 2: Animation Intensity & Hardware Adaptation (Admin Only) */}
              {isAdmin && (
                <div className="p-6 space-y-4 border-t border-zinc-800/80">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-semibold text-zinc-200 whitespace-nowrap">Animation Intensity</h3>
                        <span className="inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 leading-tight">
                          Hardware Adaptive
                        </span>
                        <span className="inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 bg-purple-500/15 text-purple-300 border border-purple-500/25 leading-tight">
                          Admin Only
                        </span>
                      </div>
                      <p className="text-xs text-zinc-500 mt-0.5">
                        Tune particle burst density, or let Nexus dynamically throttle to preserve 60 FPS on low-spec devices.
                      </p>
                    </div>

                    {/* Segmented Control */}
                    <div className="inline-flex items-center bg-zinc-800/80 p-1 rounded-lg border border-zinc-700/60 shrink-0 self-start lg:self-center">
                      <button
                        type="button"
                        onClick={() => handlePerfOverrideChange('auto')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap leading-none ${
                          perfOverride === 'auto'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                        }`}
                      >
                        Auto-Adaptive
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePerfOverrideChange('low')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap leading-none ${
                          perfOverride === 'low'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                        }`}
                      >
                        Subtle (8)
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePerfOverrideChange('medium')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap leading-none ${
                          perfOverride === 'medium'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                        }`}
                      >
                        Balanced (18)
                      </button>
                      <button
                        type="button"
                        onClick={() => handlePerfOverrideChange('high')}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer whitespace-nowrap leading-none ${
                          perfOverride === 'high'
                            ? 'bg-indigo-600 text-white shadow-xs'
                            : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                        }`}
                      >
                        Festive (28)
                      </button>
                    </div>
                  </div>

                  {/* Hardware Engine Status Bar */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 rounded-lg bg-zinc-900/40 border border-zinc-800/80 text-xs">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="flex items-center gap-1.5 text-zinc-300 font-medium">
                        <Gauge className="w-3.5 h-3.5 text-indigo-400" />
                        <span>Active Engine:</span>
                        <span className="capitalize text-zinc-100 font-semibold">
                          {perfProfile?.tier || 'medium'} ({perfProfile?.particleCount || 18} particles)
                        </span>
                      </span>

                      <span className="text-zinc-600 hidden sm:inline">•</span>

                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <Cpu className="w-3.5 h-3.5 text-zinc-500" />
                        <span>{perfProfile?.deviceMemory ? `${perfProfile.deviceMemory} GB RAM` : '4+ GB RAM'} ({perfProfile?.hardwareConcurrency || 4} cores)</span>
                      </span>

                      <span className="text-zinc-600 hidden sm:inline">•</span>

                      <span className="flex items-center gap-1.5 text-zinc-400">
                        <Wifi className="w-3.5 h-3.5 text-zinc-500" />
                        <span>~{perfProfile?.estimatedLatencyMs || 50}ms RTT</span>
                      </span>
                    </div>

                    <div className="text-[11px] text-zinc-500 flex items-center gap-1">
                      {perfOverride === 'auto' ? (
                        <span className="text-zinc-400">Auto-throttles if frame time exceeds 36ms</span>
                      ) : (
                        <span className="text-amber-400 font-medium">Manual intensity override active</span>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Row 3: Security & Theme Reassurance Footer */}
              <div className="px-6 py-3.5 bg-zinc-900/40 border-t border-zinc-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px] text-zinc-500">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Cloudflare R2 storage with AES-256 encrypted URL reference</span>
                </div>
                <div className="flex items-center gap-2 text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                  <span>Contrast-balanced for light mode & dark theme legibility</span>
                </div>
              </div>
            </div>
          </section>

          {/* PASSWORD SECTION */}
          <section id="password" ref={passwordRef} className="scroll-mt-8 space-y-6">
            <div className="bg-background border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-card">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Lock className="w-4 h-4 text-zinc-400" />
                  Password
                </h2>
              </div>
              <div className="p-6 space-y-5">
                <div>
                  <label className="block text-[12px] text-zinc-400 mb-1.5">Current Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                    <input
                      type={showCurrent ? 'text' : 'password'}
                      value={currentPassword}
                      onChange={e => setCurrentPassword(e.target.value)}
                      placeholder="Enter current password"
                      className="w-full bg-card border border-zinc-800 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrent(!showCurrent)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[12px] text-zinc-400 mb-1.5">
                    New Password <span className="text-zinc-600 font-normal">(min. 6 characters)</span>
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-2.5 w-4 h-4 text-zinc-600" />
                    <input
                      type={showNew ? 'text' : 'password'}
                      value={newPassword}
                      onChange={e => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full bg-card border border-zinc-800 rounded-lg pl-9 pr-10 py-2 text-sm text-zinc-100 focus:outline-none focus:border-zinc-600 transition-colors"
                    />
                    <button
                      type="button"
                      onClick={() => setShowNew(!showNew)}
                      className="absolute right-3 top-2.5 text-zinc-500 hover:text-zinc-300"
                    >
                      {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleChangePassword}
                    disabled={pwSaving || !currentPassword || !newPassword}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
                  >
                    {pwSaving ? 'Updating...' : 'Update Password'}
                  </button>
                </div>
              </div>
            </div>
          </section>

          {/* NOTIFICATION PREFERENCES SECTION */}
          <section id="notifications" ref={notificationsRef} className="scroll-mt-8 space-y-6">
            <div className="bg-background border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-card">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Bell className="w-4 h-4 text-zinc-400" />
                  Notification Preferences
                </h2>
                <p className="text-xs text-zinc-500 mt-1">
                  Customize which notifications and activity updates you receive across Nexus.
                </p>
              </div>

              {/* Notification Sound & Ting Customization */}
              <div className="p-6 border-b border-zinc-800/80 bg-zinc-900/15">
                <div className="space-y-5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Volume2 className="w-4 h-4 text-indigo-400" />
                        <h3 className="text-sm font-semibold text-zinc-200">Notification Alert Sounds</h3>
                        <span className={`inline-flex items-center justify-center text-[10px] px-2.5 py-0.5 rounded-full font-medium whitespace-nowrap shrink-0 leading-tight ${
                          notifPrefs.soundEnabled
                            ? 'bg-indigo-500/15 text-indigo-400 border border-indigo-500/25'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700/50'
                        }`}>
                          {notifPrefs.soundEnabled ? 'Active' : 'Muted'}
                        </span>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-zinc-800/80 border border-zinc-700/60 text-zinc-300 flex items-center gap-1.5 ml-1">
                          <Music className="w-3 h-3 text-indigo-400" />
                          <span>Uploaded: <strong className={isMaxSoundsReached ? 'text-amber-400 font-bold' : 'text-zinc-200'}>{customUploadedCount} / 4</strong></span>
                        </span>
                      </div>
                      <p className="text-xs text-zinc-400">
                        Plays an audio chime when real-time notifications arrive. Choose an acoustic preset or upload custom sounds (up to 4 max).
                      </p>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={Boolean(notifPrefs.soundEnabled)}
                        onClick={handleToggleSound}
                        className={`w-11 h-6 rounded-full transition-colors relative cursor-pointer shrink-0 ${
                          notifPrefs.soundEnabled ? 'bg-indigo-600' : 'bg-zinc-700'
                        }`}
                      >
                        <div
                          className={`w-5 h-5 rounded-full bg-white transition-transform absolute top-0.5 left-0.5 ${
                            notifPrefs.soundEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  </div>

                  {isMaxSoundsReached && (
                    <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                      <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                      <span className="flex-1 font-medium">
                        You have reached your maximum limit of 4 custom notification sounds. Delete an uploaded sound to add a new one.
                      </span>
                    </div>
                  )}

                  {/* Volume Slider & Sound Presets Grid */}
                  <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 pt-1">
                    {/* Volume Slider */}
                    <div className="lg:col-span-4 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-3">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-200 flex items-center gap-1.5">
                          {((notifPrefs.soundVolume ?? 0.8) === 0 || !notifPrefs.soundEnabled) ? (
                            <VolumeX className="w-4 h-4 text-zinc-500" />
                          ) : (notifPrefs.soundVolume ?? 0.8) < 0.5 ? (
                            <Volume1 className="w-4 h-4 text-indigo-400" />
                          ) : (
                            <Volume2 className="w-4 h-4 text-indigo-400" />
                          )}
                          <span>Volume</span>
                        </span>
                        <span className="text-zinc-400 font-mono text-[11px]">
                          {Math.round((notifPrefs.soundVolume ?? 0.8) * 100)}%
                        </span>
                      </div>
                      <input
                        type="range"
                        min="0"
                        max="1"
                        step="0.05"
                        value={notifPrefs.soundVolume ?? 0.8}
                        onChange={(e) => handleChangeSoundVolume(parseFloat(e.target.value))}
                        onMouseUp={() => playNotificationSound(undefined, notifPrefs.soundVolume ?? 0.8)}
                        className="w-full accent-indigo-500 cursor-pointer h-1.5 bg-zinc-800 rounded-lg appearance-none"
                      />
                      <p className="text-[11px] text-zinc-500">
                        Drag to adjust chime volume. Releases a preview sound.
                      </p>
                    </div>

                    {/* Presets Grid */}
                    <div className="lg:col-span-8 p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-zinc-200">Alert Sound Presets</span>
                        <span className="text-[11px] text-zinc-500">Click to set as default or ▶ to preview</span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {SOUND_PRESETS.map((preset) => {
                          const isSelected = (notifPrefs.soundPreset || 'ting') === preset.id;
                          const isAuditioning = auditioningPreset === preset.id;
                          return (
                            <div
                              key={preset.id}
                              onClick={() => handleChangeSoundPreset(preset.id)}
                              className={`group relative p-2.5 rounded-lg border text-left cursor-pointer transition-all flex items-center justify-between gap-2 ${
                                isSelected
                                  ? 'bg-zinc-800/90 border-zinc-600 text-zinc-100 shadow-xs ring-1 ring-zinc-500/20'
                                  : 'bg-zinc-800/40 border-zinc-800 hover:border-zinc-700/80 text-zinc-300'
                              }`}
                            >
                              <div className="min-w-0 pr-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="text-xs font-semibold truncate text-zinc-100">{preset.name}</p>
                                  {isSelected && (
                                    <span className="inline-flex items-center justify-center text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-200 border border-zinc-600 font-medium shrink-0 leading-none">
                                      Default
                                    </span>
                                  )}
                                </div>
                                <p className="text-[10px] text-zinc-500 truncate">{preset.id === 'ting' ? 'Default Crystal' : preset.name.split(' ')[0]}</p>
                              </div>
                              <button
                                type="button"
                                onClick={(e) => handleAuditionPreset(preset.id, e)}
                                className={`w-6 h-6 rounded-md flex items-center justify-center shrink-0 transition-colors border ${
                                  isAuditioning
                                    ? 'bg-zinc-700 text-indigo-400 border-zinc-600'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700/60'
                                }`}
                                title={`Audition ${preset.name}`}
                              >
                                {isAuditioning ? (
                                  <span className="w-2 h-2 rounded-full bg-indigo-400 animate-ping" />
                                ) : (
                                  <Play className="w-3 h-3 fill-current ml-0.5" />
                                )}
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Custom Sound Library (The ONE & ONLY Section with the Upload Button) */}
                  <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-4">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1 min-w-0 pr-2">
                        <div className="flex items-center gap-2.5 flex-wrap">
                          <div className="flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-indigo-400 shrink-0" />
                            <h4 className="text-sm font-semibold text-zinc-100">Custom Sound Library</h4>
                          </div>
                          <span className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-zinc-800/90 border border-zinc-700/70 text-zinc-300 flex items-center gap-1.5 shrink-0">
                            <Music className="w-3 h-3 text-indigo-400" />
                            <span>Uploaded: <strong className={isMaxSoundsReached ? 'text-amber-400 font-bold' : 'text-zinc-100'}>{customUploadedCount} / 4</strong></span>
                          </span>
                        </div>
                        <p className="text-xs text-zinc-400 leading-relaxed">
                          Upload up to 4 custom audio files (MP3, WAV, OGG, M4A) or choose from ready-to-use sample sounds.
                        </p>
                      </div>

                      {/* The single Upload Button */}
                      <div className="shrink-0 self-start sm:self-center">
                        {isMaxSoundsReached ? (
                          <button
                            type="button"
                            onClick={() => toast.error('Maximum of 4 custom notification sounds reached. Please delete an existing sound before uploading a new one.')}
                            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium border bg-zinc-900/80 text-zinc-500 border-zinc-800 cursor-not-allowed whitespace-nowrap shadow-xs"
                            title="Maximum 4 custom sounds reached. Delete an existing sound first."
                          >
                            <UploadCloud className="w-4 h-4 text-zinc-600 shrink-0" />
                            <span>Upload Audio (Full)</span>
                          </button>
                        ) : (
                          <label
                            className={`inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg text-xs font-medium cursor-pointer transition-all border whitespace-nowrap shadow-xs select-none ${
                              isUploadingSound
                                ? 'bg-zinc-800 text-zinc-400 border-zinc-700'
                                : 'bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white border-indigo-500/80'
                            }`}
                            title="Upload a custom alert audio file"
                          >
                            {isUploadingSound ? (
                              <Loader2 className="w-4 h-4 animate-spin shrink-0" />
                            ) : (
                              <UploadCloud className="w-4 h-4 shrink-0" />
                            )}
                            <span>{isUploadingSound ? 'Optimizing Audio...' : '+ Upload Audio'}</span>
                            <input
                              type="file"
                              className="hidden"
                              accept="audio/*,.mp3,.wav,.ogg,.m4a"
                              disabled={isUploadingSound}
                              onChange={handleSoundFileChange}
                            />
                          </label>
                        )}
                      </div>
                    </div>

                    {isMaxSoundsReached && (
                      <div className="flex items-center gap-2.5 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-300 text-xs">
                        <AlertCircle className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="flex-1 font-medium">
                          You have reached your maximum limit of 4 custom notification sounds. Delete an uploaded sound to add a new one.
                        </span>
                      </div>
                    )}

                    {/* My Uploaded Sounds Grid */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="font-semibold text-zinc-300">My Uploaded Audio ({userUploadedSounds.length} / 4)</span>
                        <span>Click ▶ to preview</span>
                      </div>

                      {userUploadedSounds.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                          {userUploadedSounds.map((sound: UploadedSoundItem) => {
                            const isDefault = (notifPrefs.soundPreset || 'ting') === 'custom' && notifPrefs.soundUrl === sound.url;
                            const isAuditioning = auditioningPreset === `uploaded-${sound.id}`;

                            return (
                              <div
                                key={sound.id}
                                className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                                  isDefault
                                    ? 'bg-zinc-800/90 border-zinc-600 text-zinc-100 shadow-xs ring-1 ring-zinc-500/20'
                                    : 'bg-zinc-800/40 border-zinc-800 hover:border-zinc-700/80 text-zinc-300'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="min-w-0 pr-1">
                                    <div className="flex items-center gap-1.5">
                                      <Music className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                                      <p className="text-xs font-semibold truncate text-zinc-100" title={sound.name}>{sound.name}</p>
                                    </div>
                                    <div className="mt-1">
                                      {isDefault ? (
                                        <span className="inline-flex items-center justify-center text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-200 border border-zinc-600 font-medium whitespace-nowrap shrink-0 leading-none">
                                          Default Alert
                                        </span>
                                      ) : (
                                        <span className="text-[10px] text-zinc-500">Custom Upload</span>
                                      )}
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-1 shrink-0">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setAuditioningPreset(`uploaded-${sound.id}`);
                                        playNotificationSound(sound.url, notifPrefs.soundVolume ?? 0.8, 'custom');
                                        setTimeout(() => setAuditioningPreset(null), 1200);
                                      }}
                                      className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors border ${
                                        isAuditioning
                                          ? 'bg-zinc-700 text-indigo-400 border-zinc-600'
                                          : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700/60'
                                      }`}
                                      title={`Preview ${sound.name}`}
                                    >
                                      {isAuditioning ? (
                                        <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
                                      ) : (
                                        <Play className="w-3 h-3 fill-current ml-0.5" />
                                      )}
                                    </button>

                                    <button
                                      type="button"
                                      onClick={() => handleDeleteSound({ soundId: sound.id, soundUrl: sound.url })}
                                      className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors border border-transparent hover:border-rose-500/20"
                                      title={`Delete "${sound.name}" from library`}
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>

                                <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px]">
                                  {!isDefault ? (
                                    <button
                                      type="button"
                                      onClick={() => handleSetSoundAsDefault(sound)}
                                      className="text-zinc-400 hover:text-zinc-200 font-medium cursor-pointer transition-colors"
                                    >
                                      Set as Default
                                    </button>
                                  ) : (
                                    <span className="text-emerald-400 font-medium">✓ Active Default</span>
                                  )}
                                  <span className="text-zinc-500 font-mono">Custom</span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="p-4 rounded-xl border border-dashed border-zinc-800 text-center text-xs text-zinc-500">
                          No custom sounds uploaded yet. Click <span className="text-indigo-400 font-medium">+ Upload Audio</span> above to add your own alert audio (up to 4).
                        </div>
                      )}
                    </div>

                    {/* Ready-to-Use Sample Sounds Sub-grid */}
                    <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                      <div className="flex items-center justify-between text-[11px] text-zinc-400">
                        <span className="font-semibold text-zinc-300">Ready-to-Use Sample Sounds</span>
                        <span>Click ▶ to preview</span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
                        {SAMPLE_CUSTOM_SOUNDS.map((sample) => {
                          const filename = sample.url.split('/').pop()?.split('?')[0];
                          const isSelected = (notifPrefs.soundPreset || 'ting') === 'custom' &&
                            (notifPrefs.soundUrl === sample.url || (filename && notifPrefs.soundUrl?.endsWith(filename)));
                          const isAuditioning = auditioningPreset === sample.id;

                          return (
                            <div
                              key={sample.id}
                              className={`p-3 rounded-xl border flex flex-col justify-between gap-2.5 transition-all ${
                                isSelected
                                  ? 'bg-zinc-800/90 border-zinc-600 text-zinc-100 shadow-xs ring-1 ring-zinc-500/20'
                                  : 'bg-zinc-800/40 border-zinc-800 hover:border-zinc-700/80 text-zinc-300'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 pr-1">
                                  <div className="flex items-center gap-1.5">
                                    <p className="text-xs font-semibold truncate text-zinc-100" title={sample.name}>{sample.name}</p>
                                    {isSelected && (
                                      <span className="inline-flex items-center justify-center text-[9px] px-1.5 py-0.5 rounded-full bg-zinc-700 text-zinc-200 border border-zinc-600 font-medium whitespace-nowrap shrink-0 leading-none">
                                        Default
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-zinc-400 mt-0.5 line-clamp-1" title={sample.description}>{sample.description}</p>
                                </div>

                                <button
                                  type="button"
                                  onClick={(e) => handleAuditionSample(sample, e)}
                                  className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors shadow-xs border ${
                                    isAuditioning
                                      ? 'bg-zinc-700 text-indigo-400 border-zinc-600'
                                      : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border-zinc-700/60'
                                  }`}
                                  title={`Audition ${sample.name}`}
                                >
                                  {isAuditioning ? (
                                    <span className="w-2.5 h-2.5 rounded-full bg-indigo-400 animate-ping" />
                                  ) : (
                                    <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                                  )}
                                </button>
                              </div>

                              <div className="flex items-center justify-between pt-1 border-t border-zinc-800/60 text-[10px]">
                                {!isSelected ? (
                                  <button
                                    type="button"
                                    onClick={() => handleSetSoundAsDefault(sample)}
                                    className="text-zinc-400 hover:text-zinc-200 font-medium cursor-pointer transition-colors"
                                  >
                                    Set as Default
                                  </button>
                                ) : (
                                  <span className="text-emerald-400 font-medium">✓ Active Default</span>
                                )}
                                <span className="text-zinc-500 font-mono">Sample</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {/* Per-Category Sound Customization (CLEAN - ZERO UPLOAD BUTTONS) */}
                  <div className="p-4 rounded-xl bg-zinc-900/50 border border-zinc-800/80 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Volume2 className="w-4 h-4 text-indigo-400" />
                        <h4 className="text-xs font-semibold text-zinc-200">Per-Category Sound Alerts</h4>
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        Assign distinct sounds for specific alerts like @ Mentions or Reactions
                      </span>
                    </div>

                    <div className="divide-y divide-zinc-800/60 border border-zinc-800/80 rounded-xl overflow-hidden bg-zinc-950/40">
                      {SOUND_CATEGORIES.map((cat) => {
                        const config = notifPrefs.typeSounds?.[cat.id];
                        const currentChoice: SoundChoice = config?.preset || 'inherit';
                        const categorySoundUrl = config?.soundUrl;
                        const isAuditioning = auditioningPreset === `category-${cat.id}`;

                        const CategoryIcon =
                          cat.id === 'mention'
                            ? AtSign
                            : cat.id === 'reaction'
                            ? Smile
                            : cat.id === 'comment'
                            ? MessageSquare
                            : RefreshCw;

                        // Determine selected value for dropdown
                        let selectValue = 'inherit';
                        if (currentChoice === 'mute') {
                          selectValue = 'mute';
                        } else if (currentChoice === 'inherit') {
                          selectValue = 'inherit';
                        } else if (['ting', 'chime', 'pop', 'bell', 'glass'].includes(currentChoice)) {
                          selectValue = `preset-${currentChoice}`;
                        } else if (currentChoice === 'custom' && categorySoundUrl) {
                          const matchedUploaded = userUploadedSounds.find((s: UploadedSoundItem) => s.url === categorySoundUrl);
                          const matchedSample = SAMPLE_CUSTOM_SOUNDS.find((s) => {
                            const filename = s.url.split('/').pop()?.split('?')[0];
                            return s.url === categorySoundUrl || (filename && categorySoundUrl.endsWith(filename));
                          });
                          if (matchedUploaded) {
                            selectValue = `custom-${matchedUploaded.id}`;
                          } else if (matchedSample) {
                            selectValue = `sample-${matchedSample.id}`;
                          } else {
                            selectValue = 'inherit';
                          }
                        }

                        const handleCategoryDropdownChange = (val: string) => {
                          if (val === 'inherit') {
                            handleChangeCategorySound(cat.id, 'inherit');
                          } else if (val === 'mute') {
                            handleChangeCategorySound(cat.id, 'mute');
                          } else if (val.startsWith('preset-')) {
                            const preset = val.replace('preset-', '') as SoundChoice;
                            handleChangeCategorySound(cat.id, preset);
                          } else if (val.startsWith('custom-')) {
                            const soundId = val.replace('custom-', '');
                            const sound = userUploadedSounds.find((s: UploadedSoundItem) => s.id === soundId);
                            if (sound) {
                              handleChangeCategorySound(cat.id, 'custom', sound.url);
                            }
                          } else if (val.startsWith('sample-')) {
                            const sampleId = val.replace('sample-', '');
                            const sample = SAMPLE_CUSTOM_SOUNDS.find((s) => s.id === sampleId);
                            if (sample) {
                              handleChangeCategorySound(cat.id, 'custom', sample.url);
                            }
                          }
                        };

                        return (
                          <div
                            key={cat.id}
                            className="p-3.5 sm:px-4 sm:py-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-zinc-900/30 transition-colors"
                          >
                            <div className="flex items-center gap-3 min-w-0 pr-2">
                              <div className="w-8 h-8 rounded-lg bg-zinc-800/80 border border-zinc-700/60 flex items-center justify-center shrink-0 text-zinc-300">
                                <CategoryIcon className="w-4 h-4" />
                              </div>
                              <div className="min-w-0">
                                <p className="text-xs font-semibold text-zinc-100">{cat.name}</p>
                                <p className="text-[11px] text-zinc-400 truncate mt-0.5">{cat.description}</p>
                              </div>
                            </div>

                            <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                              {/* Dropdown Selector */}
                              <select
                                value={selectValue}
                                onChange={(e) => handleCategoryDropdownChange(e.target.value)}
                                className={`text-xs rounded-lg px-2.5 py-1.5 border font-medium cursor-pointer transition-colors focus:outline-none focus:ring-1 focus:ring-zinc-600 focus:border-zinc-500 w-48 sm:w-56 ${
                                  currentChoice === 'mute'
                                    ? 'bg-zinc-900 border-rose-500/30 text-rose-300'
                                    : currentChoice !== 'inherit'
                                    ? 'bg-zinc-900 border-zinc-700 text-zinc-100 hover:border-zinc-600'
                                    : 'bg-zinc-900/90 border-zinc-800 text-zinc-300 hover:border-zinc-700'
                                }`}
                              >
                                <option value="inherit" className="bg-zinc-900 text-zinc-200">
                                  Default ({defaultSoundName})
                                </option>
                                <optgroup label="Studio Presets" className="bg-zinc-900 text-zinc-400 font-semibold">
                                  <option value="preset-ting" className="bg-zinc-900 text-zinc-200">Classic Ting</option>
                                  <option value="preset-chime" className="bg-zinc-900 text-zinc-200">Crystal Chime</option>
                                  <option value="preset-pop" className="bg-zinc-900 text-zinc-200">Subtle Pop</option>
                                  <option value="preset-bell" className="bg-zinc-900 text-zinc-200">Desk Bell</option>
                                  <option value="preset-glass" className="bg-zinc-900 text-zinc-200">Glass Clink</option>
                                </optgroup>
                                {userUploadedSounds.length > 0 && (
                                  <optgroup label="My Uploaded Sounds" className="bg-zinc-900 text-zinc-400 font-semibold">
                                    {userUploadedSounds.map((sound: UploadedSoundItem) => (
                                      <option key={sound.id} value={`custom-${sound.id}`} className="bg-zinc-900 text-zinc-200">
                                        Custom: {sound.name}
                                      </option>
                                    ))}
                                  </optgroup>
                                )}
                                <optgroup label="Sample Sounds" className="bg-zinc-900 text-zinc-400 font-semibold">
                                  {SAMPLE_CUSTOM_SOUNDS.map((sample) => (
                                    <option key={sample.id} value={`sample-${sample.id}`} className="bg-zinc-900 text-zinc-200">
                                      Sample: {sample.name}
                                    </option>
                                  ))}
                                </optgroup>
                                <option value="mute" className="bg-zinc-900 text-rose-300">Mute (No sound)</option>
                              </select>

                              {/* Audition Play Button */}
                              <button
                                type="button"
                                onClick={(e) => handleAuditionCategory(cat.id, e)}
                                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 transition-colors shadow-xs ${
                                  currentChoice === 'mute'
                                    ? 'bg-zinc-800 text-zinc-600 cursor-not-allowed'
                                    : isAuditioning
                                    ? 'bg-indigo-500 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700/60'
                                }`}
                                title={currentChoice === 'mute' ? 'Category is muted' : `Preview ${cat.name} alert`}
                                disabled={currentChoice === 'mute'}
                              >
                                {isAuditioning ? (
                                  <span className="w-2 h-2 rounded-full bg-white animate-ping" />
                                ) : (
                                  <Play className="w-3 h-3 fill-current ml-0.5" />
                                )}
                              </button>

                              {/* Reset / Revert to Default Button if category has a custom setting */}
                              {currentChoice !== 'inherit' && (
                                <button
                                  type="button"
                                  onClick={() => handleDeleteSound({ category: cat.id })}
                                  className="w-7 h-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors border border-transparent hover:border-zinc-700 shrink-0"
                                  title={`Reset ${cat.name} to default chime`}
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Default Activity Feed View Preference */}
              <div className="p-6 border-b border-zinc-800/80 bg-zinc-900/30">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold text-zinc-200">Default Activity View</h3>
                    <p className="text-xs text-zinc-500 mt-0.5">
                      Choose whether the Activity page opens with your personal feed or all workspace activity.
                    </p>
                  </div>

                  <div className="flex items-center bg-zinc-800/80 p-1 rounded-lg border border-zinc-700/60 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleSetDefaultView('for_me')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                        (notifPrefs.defaultView || 'for_me') === 'for_me'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                      }`}
                    >
                      <UserIcon className="w-3.5 h-3.5" />
                      <span>For Me</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSetDefaultView('show_all')}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                        notifPrefs.defaultView === 'show_all'
                          ? 'bg-indigo-600 text-white shadow-xs'
                          : 'text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700/50'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Show All</span>
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-6 divide-y divide-zinc-800/60">
                {[
                  {
                    key: 'status' as const,
                    title: 'Status Updates',
                    desc: 'Notifications when status changes on tasks or subtasks assigned to you.',
                  },
                  {
                    key: 'checklists' as const,
                    title: 'Checklists',
                    desc: 'Notifications when checklist items are assigned to you or completed on tasks assigned to you.',
                  },
                  {
                    key: 'audits' as const,
                    title: 'Auditor Checks',
                    desc: 'Notifications when audit checklists (Instructions, Design, Funnel, UI UX) are checked on tasks assigned to you.',
                  },
                  {
                    key: 'assigned' as const,
                    title: 'Assignments & Unassignments',
                    desc: 'Notifications when you are assigned to or unassigned from tasks or subtasks.',
                  },
                  {
                    key: 'comments' as const,
                    title: 'Comments & Replies',
                    desc: 'Notifications for new comments and replies on tasks you are assigned to or commented on.',
                  },
                  {
                    key: 'mentions' as const,
                    title: '@Mentions',
                    desc: 'High-priority notifications when someone directly @mentions you in comments or tasks.',
                  },
                  {
                    key: 'confettiEnabled' as const,
                    title: 'Celebrate My Mentions',
                    desc: 'Allow your personalized celebration confetti burst when teammates mention you.',
                  },
                  {
                    key: 'receiveConfetti' as const,
                    title: 'Receive Confetti Animations',
                    desc: 'Display celebration confetti animations on your screen when mentions occur in your workspace.',
                  },
                ].map((item, idx) => {
                  const isEnabled = notifPrefs[item.key] !== false;
                  return (
                    <div
                      key={item.key}
                      className={`flex items-center justify-between py-4 ${idx === 0 ? 'pt-0' : ''}`}
                    >
                      <div className="pr-4">
                        <h4 className="text-sm font-medium text-zinc-200">{item.title}</h4>
                        <p className="text-xs text-zinc-500 mt-0.5">{item.desc}</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        onClick={() => handleTogglePreference(item.key)}
                        className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                          isEnabled ? 'bg-indigo-600' : 'bg-zinc-700'
                        }`}
                      >
                        <span
                          className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-md ring-0 transition duration-200 ease-in-out ${
                            isEnabled ? 'translate-x-5' : 'translate-x-0'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </section>

          {/* API INTEGRATIONS SECTION */}
          <section id="api" ref={apiRef} className="scroll-mt-8 space-y-6">
            <div className="bg-background border border-zinc-800 rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-zinc-800 bg-card">
                <h2 className="text-sm font-semibold text-zinc-200 flex items-center gap-2">
                  <Code className="w-4 h-4 text-zinc-400" />
                  API Integrations
                </h2>
              </div>
              <div className="p-6">
                
                {/* Generate New Key Form */}
                <form onSubmit={handleCreateApiKey} className="flex gap-2 mb-8">
                  <input
                    type="text"
                    value={newKeyName}
                    onChange={(e) => setNewKeyName(e.target.value)}
                    placeholder="Key Name (e.g., n8n Automation)"
                    className="flex-1 bg-[hsl(240,3.7%,15.9%)] border border-transparent rounded-lg px-3 py-2 text-sm text-[hsl(240,4.8%,95.9%)] focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all placeholder:text-[hsl(240,5%,64.9%)]"
                  />
                  <button
                    type="submit"
                    disabled={!newKeyName.trim()}
                    className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2 whitespace-nowrap"
                  >
                    <Plus className="size-4" />
                    Generate Key
                  </button>
                </form>

                {/* Keys List */}
                <div className="space-y-3">
                  {loadingKeys ? (
                    <div className="flex items-center justify-center py-8">
                      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                    </div>
                  ) : apiKeys.length === 0 ? (
                    <div className="text-center py-8 border border-dashed border-[hsl(240,3.7%,15.9%)] rounded-lg">
                      <Code className="size-8 text-[hsl(240,5%,64.9%)] mx-auto mb-3" />
                      <p className="text-sm text-[hsl(240,5%,64.9%)]">No API keys generated yet.</p>
                    </div>
                  ) : (
                    apiKeys.map(key => (
                      <div key={key.id} className="p-4 bg-[hsl(240,5.9%,10%)] border border-[hsl(240,3.7%,15.9%)] rounded-lg">
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <h4 className="text-sm font-medium text-[hsl(240,4.8%,95.9%)]">{key.name}</h4>
                            <p className="text-xs text-[hsl(240,5%,64.9%)] mt-0.5">
                              Created {new Date(key.createdAt).toLocaleDateString()}
                            </p>
                          </div>
                          <button
                            onClick={() => setKeyToDelete(key)}
                            className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-400/10 rounded transition-colors"
                            title="Revoke Key"
                          >
                            <Trash2 className="size-4" />
                          </button>
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-black/40 rounded p-2 text-xs font-mono text-[hsl(240,4.8%,95.9%)] border border-[hsl(240,3.7%,15.9%)] overflow-hidden text-ellipsis whitespace-nowrap">
                            {key.key || '••••••••••••••••••••••••••••••••'}
                          </div>
                          {key.key && (
                            <button
                              onClick={() => copyToClipboard(key.key, key.id)}
                              className="shrink-0 p-2 text-[hsl(240,5%,64.9%)] hover:text-white bg-[hsl(240,3.7%,15.9%)] rounded hover:bg-[hsl(240,5%,25.9%)] transition-colors"
                              title="Copy to clipboard"
                            >
                              {copiedKey === key.id ? <Check className="size-4 text-emerald-400" /> : <Copy className="size-4" />}
                            </button>
                          )}
                        </div>
                        {key.key && (
                          <p className="text-[11px] text-yellow-500/90 mt-2">
                            Make sure to copy your API key now. You won't be able to see it again!
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>

              </div>
            </div>
          </section>

          <ApiDocsSection innerRef={docsRef} />

        </div>
      </div>
      
      {/* Modals */}
      {keyToDelete && (
        <ConfirmDeleteModal
          isOpen={true}
          onClose={() => setKeyToDelete(null)}
          onConfirm={async () => {
            await handleDeleteApiKey(keyToDelete.id);
          }}
          title="Revoke API Key"
          itemName={keyToDelete.name}
        />
      )}
    </div>
  );
}
