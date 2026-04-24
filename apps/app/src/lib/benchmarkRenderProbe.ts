import { useEffect } from 'react';
import { Platform } from 'react-native';

type BenchmarkRenderProbeMetric = {
  commitCount: number;
  firstCommitMs: number | null;
  lastCommitMs: number | null;
};

declare global {
  interface Window {
    __hhBenchmarkRenderProbes?: Record<string, BenchmarkRenderProbeMetric>;
    __hhBenchmarkRenderProbeEnabled?: boolean;
  }
}

function isBenchmarkRenderProbeEnabled(): boolean {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return false;
  }

  if (window.__hhBenchmarkRenderProbeEnabled) {
    return true;
  }

  return new URLSearchParams(window.location.search).has('hhBenchmark');
}

export function useBenchmarkRenderProbe(surface: string): void {
  useEffect(() => {
    if (!isBenchmarkRenderProbeEnabled()) {
      return;
    }

    const now = performance.now();
    window.__hhBenchmarkRenderProbes ??= {};
    const metric = window.__hhBenchmarkRenderProbes[surface] ?? {
      commitCount: 0,
      firstCommitMs: null,
      lastCommitMs: null,
    };

    metric.commitCount += 1;
    metric.firstCommitMs ??= now;
    metric.lastCommitMs = now;
    window.__hhBenchmarkRenderProbes[surface] = metric;
  });
}
