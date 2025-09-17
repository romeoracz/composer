/**
 * @typedef {Object} HistogramOptions
 * @property {string} name
 * @property {string} help
 * @property {string[]} [labelNames]
 * @property {number[]} [buckets]
 */

class Histogram {
  /**
   * @param {HistogramOptions} options
   */
  constructor(options) {
    this.options = options;
    this.observations = [];
    this.labelNames = options.labelNames || [];
    this.buckets = options.buckets || [];
  }

  labels(...values) {
    const labels = {};
    this.labelNames.forEach((key, idx) => {
      if (values[idx] !== undefined) {
        labels[key] = values[idx];
      }
    });
    return {
      observe: (value) => this.observeInternal(labels, value),
    };
  }

  observe(value) {
    this.observeInternal({}, value);
  }

  observeInternal(labels, value) {
    const labelsKey = this.labelNames.map((k) => `${k}:${labels[k] ?? ''}`).join('|');
    this.observations.push({ labelsKey, labels, value });
  }

  metrics() {
    const header = `# HELP ${this.options.name} ${this.options.help}\n# TYPE ${this.options.name} histogram`;
    if (!this.observations.length) {
      return `${header}\n${this.options.name}_count 0`;
    }

    const byLabel = {};
    for (const obs of this.observations) {
      if (!byLabel[obs.labelsKey]) byLabel[obs.labelsKey] = [];
      byLabel[obs.labelsKey].push(obs);
    }

    const lines = [header];
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

  formatLabels(labels) {
    const entries = Object.entries(labels);
    if (!entries.length) return '';
    const serialized = entries.map(([k, v]) => `${k}="${v}"`).join(',');
    return `{${serialized}}`;
  }
}

const histograms = [];

export const register = {
  contentType: 'text/plain; version=0.0.4',
  async metrics() {
    return histograms.map((h) => h.metrics()).join('\n');
  },
};

export function collectDefaultMetrics() {
  // No-op placeholder
}

export default {
  register,
  collectDefaultMetrics,
  createHistogram,
  Histogram,
};

export { Histogram };

/**
 * @param {HistogramOptions} options
 */
export function createHistogram(options) {
  const histogram = new Histogram(options);
  histograms.push(histogram);
  return histogram;
}
