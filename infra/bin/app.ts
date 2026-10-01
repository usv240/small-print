#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { SmallPrintSiteStack } from '../lib/site-stack';

const app = new cdk.App();

new SmallPrintSiteStack(app, 'SmallPrintSite', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'Small Print: static site (S3 + CloudFront) and anonymous results API (HTTP API, Lambda, DynamoDB)',
});

cdk.Tags.of(app).add('Project', 'small-print');

// cdk-nag AwsSolutions rule pack. Accepted findings are acknowledged, with reasons, in lib/nag.ts.
cdk.Validations.of(app).addPlugins(new AwsSolutionsChecks(app, { verbose: true }));
