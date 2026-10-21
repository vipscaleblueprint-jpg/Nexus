import { NextRequest, NextResponse } from 'next/server';
import sharp from 'sharp';

// In-memory cache for compressed thumbnails
interface CacheEntry {
  buffer: Buffer;
  contentType: string;
  createdAt: number;
}

const MAX_CACHE_ENTRIES = 500;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
const thumbnailCache = new Map<string, CacheEntry>();

function isPrivateIpOrHost(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  if (
    lower === 'localhost' ||
    lower === '127.0.0.1' ||
    lower === '0.0.0.0' ||
    lower === '::1' ||
    lower === 'metadata.google.internal' ||
    lower.endsWith('.local') ||
    lower.endsWith('.internal')
  ) {
    return true;
  }

  // IPv4 private ranges: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16
  const parts = lower.split('.').map(Number);
  if (parts.length === 4 && parts.every((p) => !isNaN(p) && p >= 0 && p <= 255)) {
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  }

  return false;
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const rawUrl = searchParams.get('url');

  if (!rawUrl) {
    return new NextResponse('Missing url parameter', { status: 400 });
  }

  let targetUrl = rawUrl.trim();
  // If a relative path from the server like /uploads/... is provided
  if (targetUrl.startsWith('/')) {
    const backendBase = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000').replace(/\/+$/, '');
    targetUrl = `${backendBase}${targetUrl}`;
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return new NextResponse('Invalid URL format', { status: 400 });
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return new NextResponse('Invalid protocol', { status: 400 });
  }

  // SSRF check: allow localhost only in development mode if querying the backend port
  const isDev = process.env.NODE_ENV !== 'production';
  const isLocalBackend = isDev && (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');
  if (!isLocalBackend && isPrivateIpOrHost(parsed.hostname)) {
    return new NextResponse('Access to private network addresses is forbidden', { status: 403 });
  }

  // Dimension and quality constraints for 1-15kb target payload
  const widthParam = parseInt(searchParams.get('w') || '360', 10);
  const qualityParam = parseInt(searchParams.get('q') || '35', 10);
  const width = Math.min(Math.max(isNaN(widthParam) ? 360 : widthParam, 60), 480);
  const quality = Math.min(Math.max(isNaN(qualityParam) ? 35 : qualityParam, 15), 65);

  const cacheKey = `${targetUrl}|w=${width}|q=${quality}`;
  const now = Date.now();

  const cached = thumbnailCache.get(cacheKey);
  if (cached && now - cached.createdAt < CACHE_TTL_MS) {
    return new NextResponse(new Uint8Array(cached.buffer), {
      status: 200,
      headers: {
        'Content-Type': cached.contentType,
        'Content-Length': String(cached.buffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Thumbnail-Cache': 'HIT',
      },
    });
  }

  try {
    const upstreamRes = await fetch(targetUrl, {
      signal: AbortSignal.timeout(10000),
      headers: {
        'User-Agent': 'Nexus-BlurUpProxy/1.0',
        Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
      },
    });

    if (!upstreamRes.ok) {
      // Fallback redirect to original if fetch failed (e.g. 403/404)
      return NextResponse.redirect(targetUrl, 302);
    }

    const contentType = upstreamRes.headers.get('content-type') || '';

    // If SVG, return directly since it is vector text and already small
    if (contentType.includes('svg') || targetUrl.toLowerCase().endsWith('.svg')) {
      const svgBuffer = Buffer.from(await upstreamRes.arrayBuffer());
      return new NextResponse(new Uint8Array(svgBuffer), {
        status: 200,
        headers: {
          'Content-Type': 'image/svg+xml',
          'Content-Length': String(svgBuffer.length),
          'Cache-Control': 'public, max-age=31536000, immutable',
        },
      });
    }

    const rawBuffer = Buffer.from(await upstreamRes.arrayBuffer());

    // Compress to tiny WebP (typically 1-15kb)
    const compressedBuffer = await sharp(rawBuffer)
      .rotate() // Auto-orient EXIF
      .resize({
        width,
        height: width,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .webp({
        quality,
        effort: 4,
      })
      .toBuffer();

    // Store in LRU cache
    if (thumbnailCache.size >= MAX_CACHE_ENTRIES) {
      const firstKey = thumbnailCache.keys().next().value;
      if (firstKey) thumbnailCache.delete(firstKey);
    }

    thumbnailCache.set(cacheKey, {
      buffer: compressedBuffer,
      contentType: 'image/webp',
      createdAt: now,
    });

    return new NextResponse(new Uint8Array(compressedBuffer), {
      status: 200,
      headers: {
        'Content-Type': 'image/webp',
        'Content-Length': String(compressedBuffer.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Thumbnail-Cache': 'MISS',
      },
    });
  } catch {
    // If sharp or fetch fails, redirect to original so the user isn't stuck
    return NextResponse.redirect(targetUrl, 302);
  }
}
