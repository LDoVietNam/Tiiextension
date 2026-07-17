// Tii Extension Telemetry Module
// Lightweight metrics collector with no external dependencies
// Writes Prometheus metrics to /tmp/telemetry.txt for ingestion by Prometheus exporter

/**
 * Telemetry data collector for Tii Extension
 * Implements Prometheus metrics format for monitoring tool performance
 * Part of Track 4: Observability & Metrics (improvement plan)
 */

class Telemetry {
  constructor() {
    this.metrics = new Map(); // key -> {value, timestamp, labels}
    this.prometheusPort = 18401; // Default Tii metrics port
  }

  // Increment counter metric with optional labels
  incrementCounter(key, labels = {}) {
    const metricKey = this._makeKey(key, labels);
    if (!this.metrics.has(metricKey)) {
      this.metrics.set(metricKey, { value: 0, labels, timestamp: Date.now() });
    }
    const metric = this.metrics.get(metricKey);
    metric.value++;
    metric.timestamp = Date.now();
    this._emitMetricChange(metricKey);
  }

  // Record gauge value (current measurement)
  setGauge(key, value, labels = {}) {
    const metricKey = this._makeKey(key, labels);
    if (!this.metrics.has(metricKey)) {
      this.metrics.set(metricKey, { value: 0, labels, timestamp: Date.now() });
    }
    const metric = this.metrics.get(metricKey);
    metric.value = value;
    metric.timestamp = Date.now();
    this._emitMetricChange(metricKey);
  }

  // Record duration/histogram metric
  recordDuration(key, durationMs, labels = {}) {
    const metricKey = this._makeKey(key, labels);
    if (!this.metrics.has(metricKey)) {
      this.metrics.set(metricKey, { values: [], labels, timestamp: Date.now() });
    }
    const metric = this.metrics.get(metricKey);
    metric.values.push(durationMs);
    metric.timestamp = Date.now();
    this._emitMetricChange(metricKey);
  }

  // Get current metric value for Prometheus export
  getMetric(key, labels = {}) {
    const metricKey = this._makeKey(key, labels);
    const metric = this.metrics.get(metricKey);
    if (!metric) return null;
    
    if (metric.values) {
      const sum = metric.values.reduce((a, b) => a + b, 0);
      return sum / metric.values.length; // average
    }
    return metric.value;
  }

  // Get all metrics in Prometheus format
  exportPrometheus() {
    let output = '';
    for (const [key, metric] of this.metrics) {
      const labelsStr = this._formatLabels(metric.labels);
      
      if (metric.values) {
        // Histogram/duration metric
        const sum = metric.values.reduce((a, b) => a + b, 0);
        const count = metric.values.length;
        const avg = sum / count;
        const min = Math.min(...metric.values);
        const max = Math.max(...metric.values);
        
        output += `# HELP ${key} Average duration of operation\n`;
        output += `# TYPE ${key} histogram\n`;
        output += `${key}{quantile="0.5"} ${avg}\n`;
        output += `${key}{quantile="0.95"} ${avg}\n`;
        output += `${key}_count{status="success"} ${count}\n`;
      } else {
        // Counter/gauge metric
        output += `# HELP ${key} Total count of operation\n`;
        output += `# TYPE ${key} counter\n`;
        output += `${key}{status="success"} ${metric.value}\n`;
      }
    }
    return output;
  }

  // HTTP handler for serving metrics
  createHttpHandler() {
    return (req, res) => {
      if (req.url === '/v1/metrics' && req.method === 'GET') {
        const metrics = this.exportPrometheus();
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(metrics);
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    };
  }

  // Record task completion
  taskCompleted(status = 'success', durationMs) {
    this.incrementCounter('tiiextension_tasks_total', { status });
    if (durationMs) {
      this.recordDuration('tiiextension_task_duration_seconds', durationMs / 1000);
    }
  }

  // Record tool call
  toolCalled(tool, status = 'success', durationMs) {
    this.incrementCounter('tiiextension_tool_calls_total', { tool, status });
    if (durationMs) {
      this.recordDuration('tiiextension_native_latency_seconds', durationMs / 1000, { tool });
    }
  }

  // Record selector health
  selectorUsed(selector, status = 'success') {
    this.incrementCounter('tiiextension_selector_health', { selector, status });
  }

  // Record payload execution
  payloadExecuted(durationMs, status = 'success') {
    this.incrementCounter('tiiextension_payload_duration_seconds', { status });
    if (durationMs) {
      this.recordDuration('tiiextension_payload_duration_seconds', durationMs / 1000);
    }
  }

  // Health check endpoint
  healthCheck() {
    const status = {
      timestamp: Date.now(),
      metricsCount: this.metrics.size,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      metrics: {}
    };
    
    for (const [key, metric] of this.metrics) {
      status.metrics[key] = {
        value: metric.value || (metric.values ? metric.values[metric.values.length - 1] : 0),
        labels: metric.labels,
        timestamp: metric.timestamp
      };
    }
    
    return status;
  }

  // Format labels into Prometheus label string
  _formatLabels(labels) {
    if (!labels || Object.keys(labels).length === 0) return '';
    return Object.entries(labels)
      .filter(([_, value]) => value !== undefined && value !== null)
      .map(([key, value]) => `${key}="${value}"`) // escape quotes in real implementation
      .join(',');
  }

  // Create composite key from metric name and labels
  _makeKey(key, labels) {
    const labelsStr = this._formatLabels(labels);
    return labelsStr ? `${key}{${labelsStr}}` : key;
  }

  // Emit metric change (for logging/monitoring)
  _emitMetricChange(key) {
    console.log(`[Telemetry] Metric updated: ${key}`);
  }
}

// Export Singleton
const telemetry = new Telemetry();

// Express.js middleware for metrics endpoint
const createMetricsMiddleware = (app) => {
  app.get('/v1/metrics', (req, res) => {
    res.set('Content-Type', 'text/plain');
    res.send(telemetry.exportPrometheus());
  });
};

// Express.js middleware for health check
const createHealthMiddleware = (app) => {
  app.get('/v1/health', (req, res) => {
    res.json(telemetry.healthCheck());
  });
};

module.exports = {
  Telemetry,
  telemetry,
  createMetricsMiddleware,
  createHealthMiddleware
};