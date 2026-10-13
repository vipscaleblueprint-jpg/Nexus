import fs from 'fs';
import v8 from 'v8';
import { monitorEventLoopDelay } from 'perf_hooks';
import { optionalEnv } from './env';
import { createLogger } from './logger';

/**
 * Logs one line per interval describing how hard the process is working:
 *
 *   rss=412MB (40% of container 1024MB) heap=280/310MB (19% of limit) loopLag mean=2ms p99=48ms max=310ms inflight=3 sockets=27
 *
 * - rss vs. container: how close the container is to being OOM-killed
 * - heap vs. limit: how close Node is to "JavaScript heap out of memory"
 * - loopLag: how long requests wait because the event loop is busy (big JSON payloads, sync work).
 *   p99 above ~100 ms means users feel it; seconds means the server cannot keep up.
 *
 * The line is logged at warn when any of those cross their threshold, so it stands out in the logs.
 * Interval: RUNTIME_METRICS_INTERVAL_MS (default 60 s). Set it to 0 to disable.
 */
const log = createLogger('runtime');

const MB = 1024 * 1024;
const LAG_WARN_MS = 100;
// The histogram records the full gap between samples, so an idle loop reads ~this value. It is
// subtracted so the log shows only the extra delay caused by work blocking the loop.
const LAG_RESOLUTION_MS = 20;
const MEMORY_WARN_RATIO = 0.8;

/** The container's memory limit in bytes (cgroup v2, then v1), or null outside a limited container. */
function readContainerMemoryLimit(): number | null {
  for (const file of ['/sys/fs/cgroup/memory.max', '/sys/fs/cgroup/memory/memory.limit_in_bytes']) {
    try {
      const raw = fs.readFileSync(file, 'utf8').trim();
      const bytes = Number(raw);
      // "max" or an absurd number (no limit set) means unlimited
      if (Number.isFinite(bytes) && bytes > 0 && bytes < 2 ** 60) return bytes;
    } catch {
      // not in a container / not Linux
    }
  }
  return null;
}

export function startRuntimeMetrics(getStats: () => { sockets: number; inFlight: number }) {
  const intervalMs = Number(optionalEnv('RUNTIME_METRICS_INTERVAL_MS') ?? 60_000);
  if (!intervalMs || intervalMs < 0) return;

  const containerLimit = readContainerMemoryLimit();
  const heapLimit = v8.getHeapStatistics().heap_size_limit;
  const loop = monitorEventLoopDelay({ resolution: LAG_RESOLUTION_MS });
  loop.enable();

  const extraDelay = (ns: number) => Math.max(0, ns / 1e6 - LAG_RESOLUTION_MS);

  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    const lag = { mean: extraDelay(loop.mean), p99: extraDelay(loop.percentile(99)), max: extraDelay(loop.max) };
    loop.reset();
    const { sockets, inFlight } = getStats();

    const containerRatio = containerLimit ? mem.rss / containerLimit : null;
    const heapRatio = mem.heapUsed / heapLimit;
    const strained = lag.p99 > LAG_WARN_MS || heapRatio > MEMORY_WARN_RATIO || (containerRatio ?? 0) > MEMORY_WARN_RATIO;

    const pct = (r: number) => `${Math.round(r * 100)}%`;
    const message =
      `rss=${Math.round(mem.rss / MB)}MB` +
      (containerLimit ? ` (${pct(containerRatio!)} of container ${Math.round(containerLimit / MB)}MB)` : '') +
      ` heap=${Math.round(mem.heapUsed / MB)}/${Math.round(mem.heapTotal / MB)}MB (${pct(heapRatio)} of limit)` +
      ` loopLag mean=${lag.mean.toFixed(0)}ms p99=${lag.p99.toFixed(0)}ms max=${lag.max.toFixed(0)}ms` +
      ` inflight=${inFlight} sockets=${sockets}`;

    log[strained ? 'warn' : 'info'](
      {
        rssMb: Math.round(mem.rss / MB),
        heapUsedMb: Math.round(mem.heapUsed / MB),
        containerLimitMb: containerLimit ? Math.round(containerLimit / MB) : null,
        loopLagP99Ms: Math.round(lag.p99),
        loopLagMaxMs: Math.round(lag.max),
        inFlight,
        sockets,
      },
      message,
    );
  }, intervalMs);
  timer.unref();
}
