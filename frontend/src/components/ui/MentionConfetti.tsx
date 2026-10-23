'use client';

import React, { useEffect, useRef, useState } from 'react';
import { getClientPerfProfile, recordFrameDrop } from '@/lib/perfAdaptive';
import { User } from '@/types/models';
import { useAppStore } from '@/lib/store';

interface ConfettiOrigin {
  x: number;
  y: number;
}

interface ConfettiEventDetail {
  user: Partial<User>;
  origin?: ConfettiOrigin;
  forceTest?: boolean;
}

const CONFETTI_TRIGGER_EVENT = 'nexus:trigger-mention-confetti';

// In-memory image element cache so images are fetched once and pulled instantly
const imageCache = new Map<string, HTMLImageElement>();
const LAST_MENTION_CACHE_KEY = 'nexus_last_mention_confetti_cache';

export interface LastMentionConfettiCache {
  userId?: string;
  url: string;
  name?: string;
  timestamp: number;
}

/**
 * Returns the cached record of the last mentioned user.
 */
export function getLastMentionConfetti(): LastMentionConfettiCache | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LAST_MENTION_CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Pre-warms and preloads a confetti image into RAM so when triggered there is 0ms delay.
 */
export function preloadMentionConfettiImage(url?: string | null) {
  if (!url) return;
  getOrLoadImage(url);
}

function getOrLoadImage(url: string, onLoaded?: () => void): HTMLImageElement | null {
  if (!url) return null;
  const existing = imageCache.get(url);
  if (existing) {
    if (existing.complete && existing.naturalWidth > 0) return existing;
    return existing;
  }

  const img = new Image();
  img.crossOrigin = 'anonymous';
  if (onLoaded) {
    img.onload = () => {
      onLoaded();
    };
  }
  img.src = url;
  imageCache.set(url, img);
  return img;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  angle: number;
  spin: number;
  opacity: number;
  decay: number;
  type: 'image' | 'star' | 'circle';
  color: string;
}

// Curated jewel/pastel tones that pop elegantly in both light and dark modes
const LIGHT_PALETTE = ['#4f46e5', '#059669', '#d97706', '#e11d48', '#0284c7', '#7c3aed'];
const DARK_PALETTE = ['#818cf8', '#34d399', '#fbbf24', '#f472b6', '#38bdf8', '#a78bfa'];

/**
 * Triggers a custom mention confetti burst for a given user.
 */
export function triggerMentionConfetti(user: Partial<User>, origin?: ConfettiOrigin, forceTest = false) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent<ConfettiEventDetail>(CONFETTI_TRIGGER_EVENT, {
      detail: { user, origin, forceTest },
    })
  );
}

export function MentionConfetti() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isActive, setIsActive] = useState(false);
  const particlesRef = useRef<Particle[]>([]);
  const animFrameRef = useRef<number | null>(null);
  const userImageRef = useRef<HTMLImageElement | null>(null);
  const userInitialsRef = useRef<string>('?');

  // Pre-warm the last mentioned user's confetti image on initial mount
  useEffect(() => {
    const lastMention = getLastMentionConfetti();
    if (lastMention?.url) {
      preloadMentionConfettiImage(lastMention.url);
    }
  }, []);

  useEffect(() => {
    const handleTrigger = (e: Event) => {
      const customEvent = e as CustomEvent<ConfettiEventDetail>;
      const { user, origin, forceTest } = customEvent.detail;
      if (!user) return;

      const store = useAppStore.getState();
      const currentUser = store.currentUser;
      const workspaceUsersIndex = store.workspaceUsersIndex;

      // 1. Viewer Consent Check: Does the viewing client agree to receive/display confetti animations?
      // If the current viewing user has not agreed (receiveConfetti !== true), never show animations.
      const viewerAgreed = currentUser?.notificationPreferences?.receiveConfetti === true;
      if (!viewerAgreed && !forceTest) {
        return;
      }

      // 2. Mentioned User Consent Check: Did the mentioned user agree to allow confetti celebrations?
      // When a user is @mentioned, confetti only bursts if they explicitly agreed (confettiEnabled === true).
      if (!forceTest) {
        const fullUser = user.id ? workspaceUsersIndex[user.id] || user : user;
        const mentionedUserAgreed = fullUser.notificationPreferences?.confettiEnabled === true;
        if (!mentionedUserAgreed) {
          return;
        }
      }

      const profile = getClientPerfProfile();

      // Resolve the best image URL: custom confetti image -> avatar -> Google imageUrl
      const targetUrl = user.confettiUrl || user.avatarUrl || user.imageUrl || '';
      const initials = (user.name || '?').trim().split(/\s+/).map(p => p[0]).join('').substring(0, 2).toUpperCase();
      userInitialsRef.current = initials;

      if (targetUrl) {
        userImageRef.current = getOrLoadImage(targetUrl);
        // Persist last mentioned user to localStorage cache so it stays warm and never needs re-fetching
        try {
          localStorage.setItem(
            LAST_MENTION_CACHE_KEY,
            JSON.stringify({
              userId: user.id,
              url: targetUrl,
              name: user.name,
              timestamp: Date.now(),
            })
          );
        } catch {}
      } else {
        userImageRef.current = null;
      }

      // Determine launch origin
      const startX = origin?.x ?? (typeof window !== 'undefined' ? window.innerWidth / 2 : 400);
      const startY = origin?.y ?? (typeof window !== 'undefined' ? window.innerHeight * 0.7 : 500);

      const isLightMode = typeof document !== 'undefined' && document.documentElement.classList.contains('theme-light');
      const palette = isLightMode ? LIGHT_PALETTE : DARK_PALETTE;

      const newParticles: Particle[] = [];
      const particleCount = profile.particleCount;

      // 1. Photo Avatar Particles (30-40% of count)
      const imageCount = Math.max(3, Math.round(particleCount * 0.35));
      for (let i = 0; i < imageCount; i++) {
        const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.6; // Upward cone
        const speed = 7 + Math.random() * 8;
        newParticles.push({
          x: startX,
          y: startY,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          size: profile.imageResolution * (0.8 + Math.random() * 0.4),
          angle: (Math.random() - 0.5) * 0.5,
          spin: (Math.random() - 0.5) * 0.08,
          opacity: 1,
          decay: 0.012 + Math.random() * 0.008,
          type: 'image',
          color: palette[i % palette.length],
        });
      }

      // 2. Accompanying Sparkles & Ribbons
      if (profile.enableSparkles) {
        const extraCount = particleCount - imageCount;
        for (let i = 0; i < extraCount; i++) {
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
          const speed = 5 + Math.random() * 9;
          newParticles.push({
            x: startX,
            y: startY,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            size: 5 + Math.random() * 6,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.2,
            opacity: 1,
            decay: 0.015 + Math.random() * 0.01,
            type: i % 2 === 0 ? 'star' : 'circle',
            color: palette[i % palette.length],
          });
        }
      }

      particlesRef.current = newParticles;
      setIsActive(true);
    };

    window.addEventListener(CONFETTI_TRIGGER_EVENT, handleTrigger);
    return () => window.removeEventListener(CONFETTI_TRIGGER_EVENT, handleTrigger);
  }, []);

  // Animation Loop with Frame Drop Monitoring
  useEffect(() => {
    if (!isActive) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas to window
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    let lastFrameTime = performance.now();
    let slowFrames = 0;

    const render = (now: number) => {
      const delta = now - lastFrameTime;
      lastFrameTime = now;

      // Slow computer frame drop protection
      if (delta > 36) {
        slowFrames++;
        if (slowFrames >= 2) {
          recordFrameDrop();
          // Cull half of remaining particles immediately
          particlesRef.current = particlesRef.current.filter((_, idx) => idx % 2 === 0);
        }
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const isLightMode = document.documentElement.classList.contains('theme-light');
      const particles = particlesRef.current;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Physics
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.97; // Drag
        p.vy += 0.28; // Gentle Gravity
        p.angle += p.spin;
        p.opacity -= p.decay;

        if (p.opacity <= 0) continue;

        ctx.save();
        ctx.globalAlpha = Math.max(0, p.opacity);
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);

        if (p.type === 'image') {
          const radius = p.size / 2;

          // Shadow for light/dark mode contrast
          ctx.shadowColor = isLightMode ? 'rgba(0,0,0,0.22)' : 'rgba(0,0,0,0.65)';
          ctx.shadowBlur = 8;
          ctx.shadowOffsetY = 3;

          // Circular clipping for avatar
          ctx.beginPath();
          ctx.arc(0, 0, radius, 0, Math.PI * 2);
          ctx.fillStyle = isLightMode ? '#f4f4f5' : '#27272a';
          ctx.fill();

          ctx.save();
          ctx.beginPath();
          ctx.arc(0, 0, radius - 1.5, 0, Math.PI * 2);
          ctx.clip();

          const img = userImageRef.current;
          if (img && img.complete && img.naturalWidth > 0) {
            ctx.drawImage(img, -radius, -radius, p.size, p.size);
          } else {
            // High-contrast stylish fallback badge with initials
            ctx.fillStyle = p.color;
            ctx.fillRect(-radius, -radius, p.size, p.size);
            ctx.fillStyle = '#ffffff';
            ctx.font = `bold ${Math.round(radius * 0.85)}px sans-serif`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(userInitialsRef.current, 0, 1);
          }
          ctx.restore();

          // Crisp border ring for light/dark mode
          ctx.shadowColor = 'transparent';
          ctx.lineWidth = 2;
          ctx.strokeStyle = isLightMode ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.3)';
          ctx.beginPath();
          ctx.arc(0, 0, radius - 0.5, 0, Math.PI * 2);
          ctx.stroke();

        } else if (p.type === 'circle') {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'star') {
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        }

        ctx.restore();
      }

      // Filter alive particles
      particlesRef.current = particles.filter(p => p.opacity > 0 && p.y < canvas.height + 50);

      if (particlesRef.current.length > 0) {
        animFrameRef.current = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setIsActive(false);
      }
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [isActive]);

  if (!isActive) return null;

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[1000000] w-full h-full"
      style={{ display: isActive ? 'block' : 'none' }}
    />
  );
}
