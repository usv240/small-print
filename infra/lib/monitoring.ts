import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as cw from 'aws-cdk-lib/aws-cloudwatch';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import { SmallPrintApi, SmallPrintFunction } from './api';

export interface MonitoringProps {
  /** Public site URL (CloudFront), e.g. https://dxxxx.cloudfront.net */
  readonly siteUrl: string;
  readonly distribution: cloudfront.Distribution;
  readonly api: SmallPrintApi;
  /** Optional address for alarm and budget emails (CDK context `alertEmail`). */
  readonly alertEmail?: string;
}

const NAMESPACE = 'SmallPrint';
const CHECKS = ['site', 'health', 'stats'] as const;
const TRAFFIC = ['real', 'demo', 'judge', 'dev'] as const;
const FIVE_MINUTES = cdk.Duration.minutes(5);

/** Uptime checks, alarms, a CloudWatch dashboard and a monthly cost budget. */
export class Monitoring extends Construct {
  readonly dashboard: cw.Dashboard;
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: MonitoringProps) {
    super(scope, id);
    const { api, distribution, alertEmail } = props;

    // --- Uptime: a scheduled Lambda (about $0/month) rather than a Synthetics canary (about $10/month at 5-minute runs).
    const uptime = new SmallPrintFunction(this, 'Uptime', {
      handler: 'uptime',
      description: 'Every 5 minutes: GET /, /api/v1/health and /api/v1/stats through CloudFront; publishes SmallPrint/Uptime',
      memorySize: 256, // 128 MB ran at 98 MB used and its small CPU share inflated measured latency
      timeout: cdk.Duration.seconds(30),
      environment: { SITE_URL: props.siteUrl },
    });
    new events.Rule(this, 'UptimeSchedule', {
      description: 'Small Print uptime check every 5 minutes',
      schedule: events.Schedule.rate(FIVE_MINUTES),
      targets: [new targets.LambdaFunction(uptime.fn, { retryAttempts: 0 })],
    });

    const uptimeMetric = (check: string) =>
      new cw.Metric({ namespace: NAMESPACE, metricName: 'Uptime', dimensionsMap: { Check: check }, statistic: 'Minimum', period: FIVE_MINUTES, label: check });
    const latencyMetric = (check: string) =>
      new cw.Metric({ namespace: NAMESPACE, metricName: 'Latency', dimensionsMap: { Check: check }, statistic: 'Average', period: FIVE_MINUTES, label: check });
    const worstUptime = new cw.MathExpression({
      expression: 'MIN([site, health, stats])',
      usingMetrics: { site: uptimeMetric('site'), health: uptimeMetric('health'), stats: uptimeMetric('stats') },
      label: 'Uptime (worst check)',
      period: FIVE_MINUTES,
    });

    // --- Alarms -> SNS. Email subscription only when -c alertEmail=... is supplied.
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'Small Print alarms', enforceSSL: true });
    if (alertEmail) this.alarmTopic.addSubscription(new subs.EmailSubscription(alertEmail));
    const notify = new cwActions.SnsAction(this.alarmTopic);

    const uptimeAlarm = new cw.Alarm(this, 'UptimeAlarm', {
      alarmName: 'SmallPrint-Uptime',
      alarmDescription: 'A public check (/, /api/v1/health or /api/v1/stats via CloudFront) failed for 2 consecutive 5-minute periods, or the checker stopped reporting.',
      metric: worstUptime,
      threshold: 1,
      comparisonOperator: cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 2,
      datapointsToAlarm: 2,
      treatMissingData: cw.TreatMissingData.BREACHING,
    });
    const api5xxAlarm = new cw.Alarm(this, 'Api5xxAlarm', {
      alarmName: 'SmallPrint-Api5xx',
      alarmDescription: 'The HTTP API returned 5 or more 5xx responses in 5 minutes.',
      metric: api.httpApi.metricServerError({ statistic: 'Sum', period: FIVE_MINUTES }),
      threshold: 5,
      comparisonOperator: cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cw.TreatMissingData.NOT_BREACHING,
    });
    for (const alarm of [uptimeAlarm, api5xxAlarm]) {
      alarm.addAlarmAction(notify);
      alarm.addOkAction(notify);
    }

    // --- Dashboard
    const fns = { ...api.functions, uptime };
    const screenings = TRAFFIC.map(
      (t) => new cw.Metric({ namespace: NAMESPACE, metricName: 'Screenings', dimensionsMap: { Traffic: t }, statistic: 'Sum', label: t }),
    );
    const tableName = api.table.tableName;
    const ddbMetric = (metricName: string, label: string) =>
      new cw.Metric({ namespace: 'AWS/DynamoDB', metricName, dimensionsMap: { TableName: tableName }, statistic: 'Sum', label });

    this.dashboard = new cw.Dashboard(this, 'Dashboard', {
      dashboardName: 'SmallPrint',
      defaultInterval: cdk.Duration.days(1),
    });
    this.dashboard.addWidgets(
      new cw.TextWidget({
        markdown:
          '# Small Print\nAnonymous reading-glasses screenings. Static site on S3 + CloudFront; `/api/*` routed by CloudFront to an HTTP API, Lambda (Node.js 22, ARM64) and DynamoDB. No personal data, no images, no IP addresses stored.',
        width: 24,
        height: 2,
      }),
    );
    this.dashboard.addWidgets(
      new cw.SingleValueWidget({ title: 'Screenings in time range', metrics: screenings, setPeriodToTimeRange: true, width: 12, height: 4 }),
      new cw.AlarmStatusWidget({ title: 'Alarms', alarms: [uptimeAlarm, api5xxAlarm], width: 12, height: 4 }),
    );
    this.dashboard.addWidgets(
      new cw.GraphWidget({ title: 'Uptime by check (1 = up)', left: CHECKS.map(uptimeMetric), leftYAxis: { min: 0, max: 1 }, width: 8 }),
      new cw.GraphWidget({ title: 'Check latency via CloudFront (ms)', left: CHECKS.map(latencyMetric), width: 8 }),
      new cw.GraphWidget({ title: 'Screenings by traffic', left: screenings.map((m) => m.with({ period: cdk.Duration.hours(1) })), stacked: true, width: 8 }),
    );
    this.dashboard.addWidgets(
      new cw.GraphWidget({ title: 'API requests', left: [api.httpApi.metricCount({ statistic: 'Sum', label: 'requests' })], width: 6 }),
      new cw.GraphWidget({
        title: 'API 4xx / 5xx',
        left: [
          api.httpApi.metricClientError({ statistic: 'Sum', label: '4xx' }),
          api.httpApi.metricServerError({ statistic: 'Sum', label: '5xx' }),
        ],
        width: 6,
      }),
      new cw.GraphWidget({
        title: 'API latency (ms)',
        left: [
          api.httpApi.metricLatency({ statistic: 'p50', label: 'p50' }),
          api.httpApi.metricLatency({ statistic: 'p90', label: 'p90' }),
          api.httpApi.metricIntegrationLatency({ statistic: 'p90', label: 'integration p90' }),
        ],
        width: 6,
      }),
      new cw.GraphWidget({
        title: 'CloudFront requests / error rate (%)',
        left: [distribution.metricRequests({ statistic: 'Sum', label: 'requests' })],
        right: [distribution.metricTotalErrorRate({ label: 'total error rate' })],
        width: 6,
      }),
    );
    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'Lambda errors',
        left: Object.entries(fns).map(([name, f]) => f.fn.metricErrors({ statistic: 'Sum', label: name })),
        width: 8,
      }),
      new cw.GraphWidget({
        title: 'Lambda duration p90 (ms)',
        left: Object.entries(fns).map(([name, f]) => f.fn.metricDuration({ statistic: 'p90', label: name })),
        width: 8,
      }),
      new cw.GraphWidget({
        title: 'Lambda throttles',
        left: Object.entries(fns).map(([name, f]) => f.fn.metricThrottles({ statistic: 'Sum', label: name })),
        width: 8,
      }),
    );
    this.dashboard.addWidgets(
      new cw.GraphWidget({
        title: 'DynamoDB consumed capacity units',
        left: [
          api.table.metricConsumedReadCapacityUnits({ statistic: 'Sum', label: 'read' }),
          api.table.metricConsumedWriteCapacityUnits({ statistic: 'Sum', label: 'write' }),
        ],
        width: 12,
      }),
      new cw.GraphWidget({
        title: 'DynamoDB throttles / transaction conflicts',
        left: [
          ddbMetric('ReadThrottleEvents', 'read throttles'),
          ddbMetric('WriteThrottleEvents', 'write throttles'),
          ddbMetric('TransactionConflict', 'transaction conflicts'),
        ],
        width: 12,
      }),
    );

    // --- Cost guard: account-level monthly budget. Notifications only when an email is supplied.
    const subscribers = alertEmail ? [{ subscriptionType: 'EMAIL', address: alertEmail }] : undefined;
    new budgets.CfnBudget(this, 'MonthlyBudget', {
      budget: {
        budgetName: 'small-print-monthly',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: { amount: 10, unit: 'USD' },
      },
      notificationsWithSubscribers: subscribers && [
        {
          notification: { notificationType: 'ACTUAL', comparisonOperator: 'GREATER_THAN', threshold: 80, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
        {
          notification: { notificationType: 'FORECASTED', comparisonOperator: 'GREATER_THAN', threshold: 100, thresholdType: 'PERCENTAGE' },
          subscribers,
        },
      ],
    });
  }
}
