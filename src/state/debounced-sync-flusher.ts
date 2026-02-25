export type FlushTrigger = "immediate" | "timer" | "manual";

export interface FlushMetricContext<Result> {
  trigger: FlushTrigger;
  durationMs: number;
  result: Result;
}

export interface DebouncedSyncFlusherOptions<Result, Metric> {
  enabled: boolean;
  delayMs: number;
  isBlocked: () => boolean;
  runSync: () => Result;
  buildMetric: (context: FlushMetricContext<Result>) => Metric;
  onMetric?: (metric: Metric) => void;
}

export class DebouncedSyncFlusher<Result, Metric> {
  private queued = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inFlight = false;

  constructor(private readonly options: DebouncedSyncFlusherOptions<Result, Metric>) {}

  request(): void {
    if (this.options.isBlocked()) {
      return;
    }

    if (!this.options.enabled) {
      this.flush("immediate");
      return;
    }

    this.queued = true;
    if (!this.timer) {
      this.schedule();
    }
  }

  flushNow(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.flush("manual");
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null;
      this.flush("timer");
    }, this.options.delayMs);

    if (this.timer && typeof (this.timer as { unref?: () => void }).unref === "function") {
      (this.timer as { unref: () => void }).unref();
    }
  }

  private flush(trigger: FlushTrigger): void {
    if (this.options.isBlocked()) {
      return;
    }

    if (this.inFlight) {
      this.queued = true;
      return;
    }

    if (trigger !== "immediate" && !this.queued) {
      return;
    }

    this.inFlight = true;
    this.queued = false;

    const startedAt = process.hrtime.bigint();
    const result = this.options.runSync();
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    this.inFlight = false;
    if (this.options.onMetric) {
      this.options.onMetric(
        this.options.buildMetric({
          trigger,
          durationMs,
          result,
        })
      );
    }

    if (this.queued && this.options.enabled && !this.timer) {
      this.schedule();
    }
  }
}
