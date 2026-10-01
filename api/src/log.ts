// Structured JSON log lines. Callers pass only validated, non-identifying fields:
// never request bodies, IP addresses or user agents.

type Fields = Record<string, string | number | boolean | null | undefined>;

function write(level: 'info' | 'warn' | 'error', msg: string, fields: Fields = {}): void {
  console.log(JSON.stringify({ level, msg, ...fields }));
}

export const log = {
  info: (msg: string, fields?: Fields) => write('info', msg, fields),
  warn: (msg: string, fields?: Fields) => write('warn', msg, fields),
  error: (msg: string, fields?: Fields) => write('error', msg, fields),
};

/** Error class name only (e.g. "ProvisionedThroughputExceededException"), never the message payload. */
export function errorName(err: unknown): string {
  return err instanceof Error ? err.name : typeof err;
}

type Unit = 'Count' | 'Milliseconds' | 'None';

/**
 * Publishes CloudWatch metrics through the Embedded Metric Format: one structured log line that
 * CloudWatch Logs turns into metrics asynchronously. No SDK call and no cloudwatch:PutMetricData permission.
 */
export function emitMetrics(
  namespace: string,
  dimensions: Record<string, string>,
  metrics: Record<string, { value: number; unit: Unit }>,
  properties: Fields = {},
): void {
  const line: Record<string, unknown> = {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: namespace,
          Dimensions: [Object.keys(dimensions)],
          Metrics: Object.entries(metrics).map(([Name, m]) => ({ Name, Unit: m.unit })),
        },
      ],
    },
    ...properties,
    ...dimensions,
  };
  for (const [name, m] of Object.entries(metrics)) line[name] = m.value;
  console.log(JSON.stringify(line));
}
