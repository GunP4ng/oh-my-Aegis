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
export declare class DebouncedSyncFlusher<Result, Metric> {
    private readonly options;
    private queued;
    private timer;
    private inFlight;
    constructor(options: DebouncedSyncFlusherOptions<Result, Metric>);
    request(): void;
    flushNow(): void;
    private schedule;
    private flush;
}
