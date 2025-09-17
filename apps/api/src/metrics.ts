export type HistogramOptions = {
  name: string;
  help: string;
  labelNames?: string[];
  buckets?: number[];
};

type HistogramObservation = {
  labelsKey: string;
  labels: Record<string, string>;
  value: number;
};

type HistogramLabelSet = {
  observe(value: number): void;
};

class Histogram {
  private observations: HistogramObservation[] = [];
  private readonly labelNames: string[];
  private readonly buckets: number[];

  constructor(private readonly options: HistogramOptions) {
    this.labelNames = options.labelNames || [];
    this.buckets = options.buckets || [];
  }

  labels(...values: string[]): HistogramLabelSet {
    const labels: Record<string, string> = {};
    this.labelNames.forEach((key, idx) => {
      if (values[idx] !== undefined) {
        labels[key] = values[idx];
      }
    });
    return {
      observe: (value: number) => this.observeInternal(labels, value),
    };
  }

  observe(value: number) {
    this.observeInternal({}, value);
  }

  private observeInternal(labels: Record<string, string>, value: number) {
    const labelsKey = this.labelNames.map((k) => `${k}:${labels[k] ?? ''}`).join('|');
    this.observations.push({ labelsKey, labels, value });
  }

  metrics(): string {
    const header = `# HELP ${this.options.name} ${this.options.help}\n# TYPE ${this.options.name} histogram`;
    if (!this.observations.length) {
      return `${header}\n${this.options.name}_count 0`;
    }

    const byLabel: Record<string, HistogramObservation[]> = {};
    for (const obs of this.observations) {
      (byLabel[obs.labelsKey] ||= []).push(obs);
    }

    const lines: string[] = [header];
    for (const key of Object.keys(byLabel)) {
      const obs = byLabel[key];
      const labels = obs[0].labels;
      const labelText = this.formatLabels(labels);
      const sortedBuckets = [...this.buckets].sort((a, b) => a - b);
      let cumulative = 0;
      for (const bucket of sortedBuckets) {
        cumulative += obs.filter((o) => o.value <= bucket).length;
        lines.push(`${this.options.name}_bucket${labelText},le="${bucket}" ${cumulative}`);
      }
      lines.push(`${this.options.name}_bucket${labelText},le="+Inf" ${obs.length}`);
      const sum = obs.reduce((acc, o) => acc + o.value, 0);
      lines.push(`${this.options.name}_sum${labelText} ${sum}`);
      lines.push(`${this.options.name}_count${labelText} ${obs.length}`);
    }
    return lines.join('\n');
  }

  private formatLabels(labels: Record<string, string>): string {
    const entries = Object.entries(labels);
    if (!entries.length) return '';
    const serialized = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${serialized}}`;
  }
}

const histograms: Histogram[] = [];

export const register = {
  contentType: 'text/plain; version=0.0.4',
  async metrics() {
    return histograms.map((h) => h.metrics()).join('\n');
  },
};

export function collectDefaultMetrics() {
  // No-op placeholder
}

export { Histogram };

export function createHistogram(options: HistogramOptions): Histogram {
  const histogram = new Histogram(options);
  histograms.push(histogram);
  return histogram;
}
