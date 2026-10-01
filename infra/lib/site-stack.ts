import * as fs from 'fs';
import * as path from 'path';
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { SmallPrintApi } from './api';
import { Monitoring } from './monitoring';
import { addNagAcknowledgements } from './nag';

/** Front-end build output if present, otherwise the static placeholder in site/. */
function siteSourceDir(): string {
  const webDist = path.join(__dirname, '../../web/dist');
  return fs.existsSync(path.join(webDist, 'index.html')) ? webDist : path.join(__dirname, '../../site');
}

// Static site: private S3 bucket served only through CloudFront (origin access control),
// plus the anonymous results API at /api/* on the same origin.
// The construct IDs SiteBucket, SiteHeaders, SiteDistribution and DeploySite are deployed; keep them
// so the distribution (and its URL) is updated in place, never replaced.
export class SmallPrintSiteStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const alertEmail: string | undefined = this.node.tryGetContext('alertEmail') || undefined;
    if (alertEmail !== undefined && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(alertEmail)) {
      throw new Error('Context value alertEmail must be an email address');
    }

    const bucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // The camera test needs HTTPS; the camera is allowed for this origin only.
    const headers = new cloudfront.ResponseHeadersPolicy(this, 'SiteHeaders', {
      securityHeadersBehavior: {
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: cdk.Duration.days(365), includeSubdomains: true, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=()', override: true }],
      },
    });

    const api = new SmallPrintApi(this, 'Api');
    const apiOrigin = new origins.HttpOrigin(api.originDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
    });
    // Stats are public aggregates: let the edge serve them, honouring the origin's max-age=30.
    const statsCache = new cloudfront.CachePolicy(this, 'StatsCachePolicy', {
      comment: 'Small Print /api/v1/stats: honour origin Cache-Control, max 60 s',
      minTtl: cdk.Duration.seconds(0),
      defaultTtl: cdk.Duration.seconds(30),
      maxTtl: cdk.Duration.seconds(60),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const distribution = new cloudfront.Distribution(this, 'SiteDistribution', {
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
      // Order matters: the exact stats path must be matched before the /api/* catch-all.
      additionalBehaviors: {
        '/api/v1/stats': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: statsCache,
          responseHeadersPolicy: headers,
          compress: true,
        },
        '/api/*': {
          origin: apiOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: headers,
          compress: true,
        },
      },
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      // Users are worldwide, including Africa and South America, so serve from every edge location.
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
    });

    // --- Site content, in three passes so each kind of file gets the right headers.
    // Content types come from the file extension (Python mimetypes in the deployment Lambda,
    // which maps .wasm to application/wasm). The order below is enforced with dependencies.
    const source = s3deploy.Source.asset(siteSourceDir());
    const deployLogs = new logs.LogGroup(this, 'DeployLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // 1. Content-hashed build output (Vite's /assets/): cache for a year, never revalidate.
    //    prune: false keeps previous hashes so a browser still holding the old index.html can load them.
    const deployAssets = new s3deploy.BucketDeployment(this, 'DeployAssets', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['assets/*'],
      prune: false,
      cacheControl: [
        s3deploy.CacheControl.setPublic(),
        s3deploy.CacheControl.maxAge(cdk.Duration.days(365)),
        s3deploy.CacheControl.immutable(),
      ],
      logGroup: deployLogs,
    });

    // 2. MediaPipe model bundles (.task): no standard MIME type for the extension, so set it explicitly.
    const deployModels = new s3deploy.BucketDeployment(this, 'DeployModels', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['*.task'],
      prune: false,
      contentType: 'application/octet-stream',
      cacheControl: [s3deploy.CacheControl.noCache()],
      logGroup: deployLogs,
    });
    deployModels.node.addDependency(deployAssets);

    // 2b. MediaPipe WebAssembly runtime, brotli-compressed at build time (web/scripts/compress-dist.mjs):
    //     ~11 MB is over CloudFront's 10 MB on-the-fly compression limit. Versioned with the npm
    //     package, so a day of caching is safe.
    const deployWasm = new s3deploy.BucketDeployment(this, 'DeployWasm', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['*'],
      include: ['mediapipe/wasm/*.wasm'],
      prune: false,
      contentType: 'application/wasm',
      contentEncoding: 'br',
      cacheControl: [s3deploy.CacheControl.setPublic(), s3deploy.CacheControl.maxAge(cdk.Duration.days(1))],
      logGroup: deployLogs,
    });
    deployWasm.node.addDependency(deployModels);

    // 3. Everything else (HTML, manifest, icons): always revalidate. Runs last so new HTML never
    //    references assets that are not uploaded yet, then invalidates CloudFront.
    //    Pruning skips the excluded patterns, so assets and models above are not deleted.
    const deploySite = new s3deploy.BucketDeployment(this, 'DeploySite', {
      sources: [source],
      destinationBucket: bucket,
      exclude: ['assets/*', '*.task', 'mediapipe/wasm/*.wasm'],
      cacheControl: [s3deploy.CacheControl.noCache()],
      distribution,
      distributionPaths: ['/*'],
      logGroup: deployLogs,
    });
    deploySite.node.addDependency(deployWasm);

    const siteUrl = `https://${distribution.distributionDomainName}`;
    const monitoring = new Monitoring(this, 'Monitoring', { siteUrl, distribution, api, alertEmail });

    new cdk.CfnOutput(this, 'SiteUrl', { value: siteUrl });
    new cdk.CfnOutput(this, 'ApiUrl', { value: `${siteUrl}/api/v1`, description: 'Same-origin API base (via CloudFront)' });
    new cdk.CfnOutput(this, 'DashboardUrl', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards/dashboard/${monitoring.dashboard.dashboardName}`,
    });
    new cdk.CfnOutput(this, 'TableName', { value: api.table.tableName });

    addNagAcknowledgements(this);
  }
}
