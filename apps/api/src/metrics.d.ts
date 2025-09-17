export type HistogramOptions = {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
};

declare class Histogram {
  constructor(options: HistogramOptions);
  labels(...values: string[]): { observe(value: number): void };
  observe(value: number): void;
  metrics(): string;
}

export declare const register: {
  contentType: string;
  metrics(): Promise<string>;
};

export declare function collectDefaultMetrics(): void;
export { Histogram };
export declare function createHistogram(options: HistogramOptions): Histogram;
