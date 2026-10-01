#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { SmallPrintSiteStack } from '../lib/site-stack';

const app = new cdk.App();

new SmallPrintSiteStack(app, 'SmallPrintSite', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: 'us-east-1' },
  description: 'Small Print: static site (S3 + CloudFront)',
});

cdk.Tags.of(app).add('Project', 'small-print');
