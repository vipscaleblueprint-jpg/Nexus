/**
 * Opt-in performance monitor for finding what makes the app slow while you use it.
 *
 * Turn on:  add ?perf=1 to any URL (remembered in this browser).  Turn off: ?perf=0
 *
 * While on, it logs to the browser console:
 *  - every API call: total ms, ms spent on the server (Server-Timing), response size
 *  - each page change: requests it triggered, the slowest one, and how long the main thread was blocked
 *  - "long tasks": moments the main thread froze (the device couldn't keep up)
 *  - JS memory (Chrome) and socket events per minute
 * and prints a summary every 30 s. In the console:
 *   nexusPerf.report()    summary now
 *   nexusPerf.download()  save everything as JSON (send this file for analysis)
 *   nexusPerf.clear()     start fresh
 *
 * When off, every hook is a single boolean check.
 */

type ApiEntry = {
  at: number; // ms since page load
  method: string;
  path: string; // ids replaced with :id
  status: number;
  ms: number;
  serverMs?: number;
  bytes?: number;
};
type LongTask = { at: number; ms: number; path: string };
type MemorySample = { at: number; usedMb: number; limitMb: number };
type NavEntry = {
  at: number;
  path: string;
  firstFrameMs: number;
  requests: number;
  slowest?: { path: string; ms: number };
  blockedMs: number;
};

const STORAGE_KEY = 'nexus_perf';
const MAX_ENTRIES = 1000;
const SUMMARY_EVERY_MS = 30_000;
const MEMORY_EVERY_MS = 15_000;
const NAV_WINDOW_MS = 5_000;
const SLOW_REQUEST_MS = 1000;
const LONG_TASK_WARN_MS = 200;

let enabled = false;
let initialized = false;
const api: ApiEntry[] = [];
const longTasks: LongTask[] = [];
const memory: MemorySample[] = [];
const navs: NavEntry[] = [];
const socketCounts: Record<string, number> = {};
let socketWindowStart = 0;

const push = <T,>(list: T[], item: T) => {
  list.push(item);
  if (list.length > MAX_ENTRIES) list.shift();
};
const now = () => Math.round(performance.now());
const currentPath = () => (typeof window === 'undefined' ? '' : window.location.pathname);

/** Collapses ids so the same endpoint groups together: /api/tasks/3f2a…/comments -> /api/tasks/:id/comments */
export function normalizePath(path: string) {
  return path
    .split('?')[0]
    .split('/')
    .map((seg) => (/^[0-9a-f-]{16,}$/i.test(seg) || /^[a-z0-9_-]{20,}$/i.test(seg) ? ':id' : seg))
    .join('/');
}

export function isPerfEnabled() {
  return enabled;
}

const percentile = (values: number[], p: number) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
};
const kb = (bytes?: number) => (bytes === undefined ? '?' : bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`);

/** Called by apiClient after each request. */
export function recordApi(method: string, url: string, status: number, ms: number, serverTimingHeader: string | null) {
  if (!enabled) return;
  let serverMs: number | undefined;
  const match = serverTimingHeader?.match(/dur=([\d.]+)/);
  if (match) serverMs = Number(match[1]);

  // Size comes from Resource Timing (needs Timing-Allow-Origin from the server)
  let bytes: number | undefined;
  const entries = performance.getEntriesByName(url, 'resource') as PerformanceResourceTiming[];
  const entry = entries[entries.length - 1];
  if (entry && entry.decodedBodySize > 0) bytes = entry.decodedBodySize;

  let path = url;
  try {
    path = new URL(url).pathname;
  } catch {}
  const item: ApiEntry = { at: now(), method, path: normalizePath(path), status, ms: Math.round(ms), serverMs, bytes };
  push(api, item);

  const network = serverMs !== undefined ? ` (server ${Math.round(serverMs)}ms, network+queue ${Math.max(0, Math.round(ms - serverMs))}ms)` : '';
  const line = `[perf] ${method} ${item.path} ${status} ${item.ms}ms${network} ${kb(bytes)}`;
  if (item.ms >= SLOW_REQUEST_MS || status >= 400 || status === 0) console.warn(line);
  else console.debug(line);
}

/** Called by the app-wide socket for every incoming event. */
export function recordSocketEvent(name: string) {
  if (!enabled) return;
  socketCounts[name] = (socketCounts[name] || 0) + 1;
}

/** Called on every route change. Logs a summary of the next few seconds. */
export function markNavigation(path: string) {
  if (!enabled) return;
  const start = performance.now();
  let firstFrameMs = 0;
  requestAnimationFrame(() => {
    firstFrameMs = Math.round(performance.now() - start);
  });
  setTimeout(() => {
    const end = start + NAV_WINDOW_MS;
    const reqs = api.filter((a) => a.at >= start && a.at <= end);
    const slowest = reqs.reduce<ApiEntry | undefined>((max, a) => (!max || a.ms > max.ms ? a : max), undefined);
    const blockedMs = longTasks.filter((t) => t.at >= start && t.at <= end).reduce((sum, t) => sum + t.ms, 0);
    const nav: NavEntry = {
      at: Math.round(start),
      path: normalizePath(path),
      firstFrameMs,
      requests: reqs.length,
      slowest: slowest ? { path: `${slowest.method} ${slowest.path}`, ms: slowest.ms } : undefined,
      blockedMs,
    };
    push(navs, nav);
    const line =
      `[perf] page ${nav.path}: first frame ${firstFrameMs}ms, ${reqs.length} request(s)` +
      (slowest ? `, slowest ${nav.slowest!.path} ${slowest.ms}ms` : '') +
      `, main thread blocked ${blockedMs}ms in first ${NAV_WINDOW_MS / 1000}s`;
    if (blockedMs > 500 || (slowest && slowest.ms >= SLOW_REQUEST_MS)) console.warn(line);
    else console.info(line);
  }, NAV_WINDOW_MS);
}

function sampleMemory() {
  const mem = (performance as any).memory; // Chrome/Edge only
  if (!mem) return;
  const sample = { at: now(), usedMb: Math.round(mem.usedJSHeapSize / 1024 / 1024), limitMb: Math.round(mem.jsHeapSizeLimit / 1024 / 1024) };
  push(memory, sample);
  if (sample.usedMb / sample.limitMb > 0.7) console.warn(`[perf] JS memory high: ${sample.usedMb}MB of ${sample.limitMb}MB`);
}

function buildSummary() {
  const recent = api.slice(-200);
  const byEndpoint: Record<string, { count: number; totalMs: number; maxMs: number; maxServerMs: number; maxBytes: number }> = {};
  recent.forEach((a) => {
    const key = `${a.method} ${a.path}`;
    const e = (byEndpoint[key] ||= { count: 0, totalMs: 0, maxMs: 0, maxServerMs: 0, maxBytes: 0 });
    e.count++;
    e.totalMs += a.ms;
    e.maxMs = Math.max(e.maxMs, a.ms);
    e.maxServerMs = Math.max(e.maxServerMs, a.serverMs ?? 0);
    e.maxBytes = Math.max(e.maxBytes, a.bytes ?? 0);
  });
  const slowestEndpoints = Object.entries(byEndpoint)
    .sort((a, b) => b[1].maxMs - a[1].maxMs)
    .slice(0, 8)
    .map(([endpoint, e]) => ({
      endpoint,
      calls: e.count,
      avgMs: Math.round(e.totalMs / e.count),
      maxMs: e.maxMs,
      maxServerMs: Math.round(e.maxServerMs),
      maxSize: kb(e.maxBytes || undefined),
    }));

  const minutes = Math.max(1 / 60, (performance.now() - socketWindowStart) / 60_000);
  const socketPerMin = Object.fromEntries(
    Object.entries(socketCounts).map(([name, count]) => [name, Math.round((count / minutes) * 10) / 10]),
  );
  const ms = recent.map((a) => a.ms);
  const lastMem = memory[memory.length - 1];
  const nav = navigator as any;

  return {
    device: {
      cpuCores: nav.hardwareConcurrency,
      deviceMemoryGb: nav.deviceMemory,
      connection: nav.connection ? { type: nav.connection.effectiveType, rttMs: nav.connection.rtt, downlinkMbps: nav.connection.downlink } : undefined,
    },
    requests: { count: recent.length, p50Ms: percentile(ms, 50), p95Ms: percentile(ms, 95), maxMs: percentile(ms, 100) },
    slowestEndpoints,
    longTasks: {
      count: longTasks.length,
      totalBlockedMs: longTasks.reduce((s, t) => s + t.ms, 0),
      worst: [...longTasks].sort((a, b) => b.ms - a.ms).slice(0, 5),
    },
    memory: lastMem ? `${lastMem.usedMb}MB of ${lastMem.limitMb}MB` : 'n/a (Chrome/Edge only)',
    socketEventsPerMinute: socketPerMin,
    recentPages: navs.slice(-10),
  };
}

function printSummary() {
  const s = buildSummary();
  console.groupCollapsed(
    `[perf] summary — ${s.requests.count} requests, p95 ${s.requests.p95Ms}ms, max ${s.requests.maxMs}ms; ` +
      `main thread blocked ${s.longTasks.totalBlockedMs}ms total; memory ${s.memory}`,
  );
  console.log('device', s.device);
  if (s.slowestEndpoints.length) console.table(s.slowestEndpoints);
  if (s.recentPages.length) console.table(s.recentPages);
  console.log('worst freezes (ms, at, page)', s.longTasks.worst);
  console.log('socket events per minute', s.socketEventsPerMinute);
  console.groupEnd();
  // Keep the Resource Timing buffer from filling up (new entries are dropped when it is full)
  performance.clearResourceTimings();
}

function download() {
  const payload = { generatedAt: new Date().toISOString(), url: window.location.href, summary: buildSummary(), api, longTasks, memory, navs };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `nexus-perf-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Reads ?perf=1 / ?perf=0, then starts the observers if enabled. Safe to call more than once. */
export function initPerfMonitor() {
  if (typeof window === 'undefined' || initialized) return;
  initialized = true;

  try {
    const flag = new URLSearchParams(window.location.search).get('perf');
    if (flag === '1') localStorage.setItem(STORAGE_KEY, '1');
    if (flag === '0') localStorage.removeItem(STORAGE_KEY);
    enabled = localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    enabled = false;
  }
  if (!enabled) return;

  socketWindowStart = performance.now();
  try {
    performance.setResourceTimingBufferSize(MAX_ENTRIES);
  } catch {}

  try {
    // Main-thread blocks >= 50 ms (Chrome/Edge). Each one is time the page couldn't respond.
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const task = { at: Math.round(entry.startTime), ms: Math.round(entry.duration), path: normalizePath(currentPath()) };
        push(longTasks, task);
        if (task.ms >= LONG_TASK_WARN_MS) console.warn(`[perf] main thread frozen ${task.ms}ms on ${task.path}`);
      }
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {
    console.info('[perf] long-task tracking not supported in this browser');
  }

  sampleMemory();
  setInterval(sampleMemory, MEMORY_EVERY_MS);
  setInterval(printSummary, SUMMARY_EVERY_MS);

  (window as any).nexusPerf = {
    report: printSummary,
    download,
    clear: () => {
      api.length = 0;
      longTasks.length = 0;
      memory.length = 0;
      navs.length = 0;
      Object.keys(socketCounts).forEach((k) => delete socketCounts[k]);
      socketWindowStart = performance.now();
    },
    disable: () => {
      try {
        localStorage.removeItem(STORAGE_KEY);
      } catch {}
      console.info('[perf] disabled — reload the page');
    },
  };
  console.info('[perf] monitor ON. Summary every 30s. nexusPerf.report() / nexusPerf.download() / nexusPerf.disable()');
}
