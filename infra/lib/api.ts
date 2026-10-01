import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigw from 'aws-cdk-lib/aws-apigateway';
import * as apigwv2 from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';

const API_DIR = path.join(__dirname, '../../api');

export interface SmallPrintFunctionProps {
  /** File name (without .ts) under api/src/handlers. */
  readonly handler: string;
  readonly description: string;
  readonly memorySize?: number;
  readonly timeout?: cdk.Duration;
  readonly environment?: Record<string, string>;
}

/**
 * A Node.js 22 / ARM64 Lambda bundled locally by esbuild, with its own log group (2-week retention)
 * and a dedicated role that can only write to that log group. Callers add data permissions.
 */
export class SmallPrintFunction extends Construct {
  readonly fn: nodejs.NodejsFunction;
  readonly role: iam.Role;
  readonly logGroup: logs.LogGroup;

  constructor(scope: Construct, id: string, props: SmallPrintFunctionProps) {
    super(scope, id);

    this.logGroup = new logs.LogGroup(this, 'Logs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // No AWSLambdaBasicExecutionRole: that managed policy allows writing to every log group.
    this.role = new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: `Small Print ${props.handler} function`,
    });
    this.logGroup.grantWrite(this.role);

    this.fn = new nodejs.NodejsFunction(this, 'Function', {
      entry: path.join(API_DIR, 'src', 'handlers', `${props.handler}.ts`),
      handler: 'handler',
      description: props.description,
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: props.memorySize ?? 256,
      timeout: props.timeout ?? cdk.Duration.seconds(10),
      role: this.role,
      logGroup: this.logGroup,
      environment: { NODE_OPTIONS: '--enable-source-maps', ...props.environment },
      projectRoot: API_DIR,
      depsLockFilePath: path.join(API_DIR, 'package-lock.json'),
      bundling: {
        minify: true,
        sourceMap: true,
        sourcesContent: false,
        target: 'node22',
        // Bundle the AWS SDK v3 clients we use so the deployed version is pinned by api/package-lock.json.
        externalModules: [],
      },
    });
  }
}

/** Restricts DynamoDB item access to partition keys with the given prefixes (fine-grained access control). */
function leadingKeys(...patterns: string[]): Record<string, unknown> {
  return { 'ForAllValues:StringLike': { 'dynamodb:LeadingKeys': patterns } };
}

/**
 * Anonymous results API: DynamoDB (single table) + three Lambda functions behind an HTTP API.
 * CloudFront routes /api/* to it, so browsers call it same-origin (no CORS).
 */
export class SmallPrintApi extends Construct {
  readonly table: dynamodb.Table;
  readonly httpApi: apigwv2.HttpApi;
  readonly stage: apigwv2.HttpStage;
  readonly functions: Record<'results' | 'stats' | 'health', SmallPrintFunction>;
  /** Hostname of the HTTP API, used as the CloudFront origin. */
  readonly originDomain: string;

  constructor(scope: Construct, id: string) {
    super(scope, id);
    const stack = cdk.Stack.of(this);

    this.table = new dynamodb.Table(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },
      deletionProtection: true,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    const environment = { TABLE_NAME: this.table.tableName };
    const results = new SmallPrintFunction(this, 'Results', {
      handler: 'results',
      description: 'POST /api/v1/results: validate and store an anonymous screening result',
      environment,
    });
    const stats = new SmallPrintFunction(this, 'Stats', {
      handler: 'stats',
      description: 'GET /api/v1/stats: public aggregate counters',
      environment,
    });
    const health = new SmallPrintFunction(this, 'Health', {
      handler: 'health',
      description: 'GET /api/v1/health: DynamoDB reachability',
      memorySize: 128,
      environment,
    });
    this.functions = { results, stats, health };

    // Least privilege: exact actions, this table only, and only the key prefixes each function uses.
    results.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
        resources: [this.table.tableArn],
        conditions: leadingKeys('SESSION#*', 'AGG#*'),
      }),
    );
    stats.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:BatchGetItem'],
        resources: [this.table.tableArn],
        conditions: leadingKeys('AGG#*'),
      }),
    );
    health.role.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ['dynamodb:GetItem'],
        resources: [this.table.tableArn],
        conditions: leadingKeys('HEALTH'),
      }),
    );

    this.httpApi = new apigwv2.HttpApi(this, 'HttpApi', {
      apiName: 'small-print',
      description: 'Small Print anonymous results API (served via CloudFront at /api/*)',
      createDefaultStage: false,
    });

    // Access logs deliberately omit $context.identity.sourceIp and userAgent: we do not collect them.
    const accessLogs = new logs.LogGroup(this, 'AccessLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });
    this.stage = this.httpApi.addStage('DefaultStage', {
      stageName: '$default',
      autoDeploy: true,
      // Cost and abuse guard for a public, unauthenticated API.
      throttle: { rateLimit: 20, burstLimit: 40 },
      accessLogSettings: {
        destination: new apigwv2.LogGroupLogDestination(accessLogs),
        format: apigw.AccessLogFormat.custom(
          JSON.stringify({
            requestId: '$context.requestId',
            time: '$context.requestTime',
            routeKey: '$context.routeKey',
            status: '$context.status',
            responseLength: '$context.responseLength',
            latencyMs: '$context.responseLatency',
            integrationLatencyMs: '$context.integrationLatency',
            integrationError: '$context.integrationErrorMessage',
            error: '$context.error.message',
          }),
        ),
      },
    });

    const routes: Array<[string, apigwv2.HttpMethod, SmallPrintFunction]> = [
      ['/api/v1/results', apigwv2.HttpMethod.POST, results],
      ['/api/v1/stats', apigwv2.HttpMethod.GET, stats],
      ['/api/v1/health', apigwv2.HttpMethod.GET, health],
    ];
    for (const [routePath, method, fn] of routes) {
      this.httpApi.addRoutes({
        path: routePath,
        methods: [method],
        integration: new HttpLambdaIntegration(`${fn.node.id}Integration`, fn.fn),
      });
    }

    this.originDomain = `${this.httpApi.apiId}.execute-api.${stack.region}.${stack.urlSuffix}`;
  }
}
