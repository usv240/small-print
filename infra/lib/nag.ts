import { DefaultStackSynthesizer, Stack, Token, Validations, type CfnResource } from 'aws-cdk-lib';
import type { IConstruct } from 'constructs';

// cdk-nag (AwsSolutions pack) findings we accept on purpose, each with its reason.
// Acknowledgements are attached as narrowly as possible: on the construct that owns the finding
// (they apply to its children), and IAM5 findings are acknowledged one action/resource at a time.

function find(stack: Stack, path: string): IConstruct {
  let node: IConstruct = stack;
  for (const id of path.split('/')) node = node.node.findChild(id);
  return node;
}

function ack(scope: IConstruct, acks: Record<string, string>): void {
  Validations.of(scope).acknowledge(...Object.entries(acks).map(([id, reason]) => ({ id, reason })));
}

export function addNagAcknowledgements(stack: Stack): void {
  // --- Static site
  ack(find(stack, 'SiteBucket'), {
    'AwsSolutions-S1':
      'The bucket is private (Block Public Access, TLS-only) and readable only by this CloudFront distribution through OAC, so every read is a CloudFront origin fetch; server access logs would add a log bucket and cost without new information. Writes come only from CDK deployments, which CloudTrail records.',
  });

  ack(find(stack, 'SiteDistribution'), {
    'AwsSolutions-CFR1': 'A free public-health tool for users worldwide; geographic restriction is not wanted.',
    'AwsSolutions-CFR2':
      'AWS WAF costs at least $5/month per web ACL plus rules, half of the $10/month budget. Abuse is bounded instead by HTTP API stage throttling (20 rps, burst 40), strict schema validation with a 4 KB body cap, edge caching of /api/v1/stats, and a cost budget.',
    'AwsSolutions-CFR3':
      'CloudFront access logs record viewer IP addresses and user agents, and Small Print deliberately collects no personal data. Traffic, errors and latency are observed through CloudFront and API Gateway metrics, IP-free API access logs, and the 5-minute uptime checks.',
    'AwsSolutions-CFR4':
      'The distribution uses the default *.cloudfront.net certificate, for which the minimum viewer TLS policy cannot be changed; TLSv1.2_2021 needs a custom domain and ACM certificate (out of scope). HSTS is sent on every response and both origins are reached over TLS 1.2.',
  });

  // --- API
  ack(find(stack, 'Api/HttpApi'), {
    'AwsSolutions-APIG4':
      'Public, anonymous endpoints by design: the browser app has no accounts and sends no personal data. Requests are bounded by stage throttling, strict validation and a 4 KB body cap, and writes are idempotent per random session UUID.',
  });

  const nodeRuntime =
    'Node.js 22 (an LTS runtime supported by Lambda) is the runtime this project is built and tested on; moving to Node.js 24 is a deliberate upgrade, not a drift fix.';
  ack(find(stack, 'Api'), { 'AwsSolutions-L1': nodeRuntime });
  ack(find(stack, 'Monitoring/Uptime'), { 'AwsSolutions-L1': nodeRuntime });

  // --- aws-cdk-lib BucketDeployment handler (one singleton Lambda shared by the three site deployments)
  const deployHandler = stack.node.children.find((c) => c.node.id.startsWith('Custom::CDKBucketDeployment'));
  if (!deployHandler) throw new Error('BucketDeployment handler not found for cdk-nag acknowledgements');
  const bucketLogicalId = stack.getLogicalId(find(stack, 'SiteBucket/Resource') as CfnResource);
  const account = Token.isUnresolved(stack.account) ? '<AWS::AccountId>' : stack.account;
  const assetsBucket = `cdk-${DefaultStackSynthesizer.DEFAULT_QUALIFIER}-assets-${account}-${stack.region}`;
  const cdkManaged = 'Granted by aws-cdk-lib BucketDeployment to its own handler';
  ack(deployHandler, {
    'AwsSolutions-L1': 'CDK-managed BucketDeployment handler; its runtime (Python 3.13) is chosen and upgraded by aws-cdk-lib.',
    'AwsSolutions-IAM4[Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole]':
      `${cdkManaged}; the managed policy only allows writing CloudWatch Logs.`,
    'AwsSolutions-IAM5[Action::s3:GetObject*]': `${cdkManaged}: read the site zip from the CDK assets bucket and objects in the site bucket.`,
    'AwsSolutions-IAM5[Action::s3:GetBucket*]': `${cdkManaged}: needed by aws s3 sync; scoped to the two buckets.`,
    'AwsSolutions-IAM5[Action::s3:List*]': `${cdkManaged}: needed by aws s3 sync; scoped to the two buckets.`,
    'AwsSolutions-IAM5[Action::s3:DeleteObject*]': `${cdkManaged}: prunes removed site files; scoped to the site bucket.`,
    'AwsSolutions-IAM5[Action::s3:Abort*]': `${cdkManaged}: aborts failed multipart uploads; scoped to the site bucket.`,
    [`AwsSolutions-IAM5[Resource::<${bucketLogicalId}.Arn>/*]`]: `${cdkManaged}: object-level access to the site bucket only.`,
    [`AwsSolutions-IAM5[Resource::arn:<AWS::Partition>:s3:::${assetsBucket}/*]`]: `${cdkManaged}: read objects in the CDK bootstrap assets bucket.`,
    'AwsSolutions-IAM5[Resource::*]': `${cdkManaged}: only cloudfront:CreateInvalidation and cloudfront:GetInvalidation, used to invalidate this distribution after a deploy.`,
  });
}
