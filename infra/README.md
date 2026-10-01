# Small Print infrastructure

AWS CDK v2 (TypeScript) app for Small Print: a static site and an anonymous results API, one stack
(`SmallPrintSite`, us-east-1). Lambda code lives in [`../api`](../api).

## Architecture

```
Browser ──HTTPS──▶ CloudFront  (https://dxug72099q2ay.cloudfront.net, security headers on every response)
                     │
                     ├─ /*              ─▶ S3 bucket (private, OAC only)      site, MediaPipe wasm + model
                     ├─ /api/v1/stats   ─▶ HTTP API ─▶ Lambda stats   ─▶ DynamoDB BatchGetItem AGG#*      (edge-cached 30 s)
                     └─ /api/*          ─▶ HTTP API ─▶ Lambda results ─▶ DynamoDB TransactWriteItems     (not cached)
                                                     └▶ Lambda health  ─▶ DynamoDB GetItem HEALTH

EventBridge rule (every 5 min) ─▶ Lambda uptime ─▶ GET /, /api/v1/health, /api/v1/stats via CloudFront
                                                 ─▶ EMF metrics SmallPrint/Uptime, Latency ─▶ alarm ─▶ SNS (email optional)
CloudWatch dashboard "SmallPrint"  ·  AWS Budget $10/month  ·  cdk-nag AwsSolutions checks on every synth
```

The browser calls `/api/v1/...` on the same origin, so there is no CORS configuration at all.

| Service | Role |
|---|---|
| Amazon CloudFront | One HTTPS origin for site and API. Default behavior: S3 via Origin Access Control, `CachingOptimized`. `/api/v1/stats`: custom cache policy (honours the origin's `max-age=30`, max 60 s). `/api/*`: `CachingDisabled`, all methods, `AllViewerExceptHostHeader`. HTTPS only to the API origin (TLS 1.2). Security headers policy on all behaviors. |
| Amazon S3 | Private bucket (Block Public Access, SSE-S3, TLS-only policy) holding the site. Three `BucketDeployment` passes set headers: `/assets/*` (content-hashed) `public, max-age=31536000, immutable`; `*.task` `application/octet-stream` + `no-cache`; everything else (HTML, wasm, icons) `no-cache`, then a CloudFront invalidation. Content types come from the file extension (`.wasm` maps to `application/wasm`). Source is `../web/dist` when it contains `index.html`, otherwise `../site`. |
| Amazon API Gateway (HTTP API) | Three routes, Lambda proxy integrations (payload v2), `$default` stage throttled to 20 rps / burst 40, JSON access logs without IP or user agent. |
| AWS Lambda | Node.js 22 on ARM64 (Graviton), bundled locally by esbuild (AWS SDK v3 pinned in the bundle). `results` (256 MB), `stats` (256 MB), `health` (128 MB), `uptime` (256 MB). |
| Amazon DynamoDB | One on-demand table, `pk`/`sk`, point-in-time recovery, deletion protection, `RETAIN` on stack delete. |
| Amazon CloudWatch | Log groups with 2-week retention, Embedded Metric Format metrics (`SmallPrint/Screenings` by `Traffic`, `Uptime`/`Latency` by `Check`), two alarms, dashboard `SmallPrint`. |
| Amazon EventBridge | 5-minute schedule for the uptime Lambda. |
| Amazon SNS | Alarm topic (TLS-only publish). Email subscription only if `-c alertEmail=...` is given. |
| AWS Budgets | Account-level monthly cost budget of USD 10; emails at 80 % actual and 100 % forecast when `alertEmail` is given. |

### Data model (single table)

| pk | sk | Item |
|---|---|---|
| `SESSION#<uuid>` | `RESULT` | One validated screening result + server-computed `agreement`, `createdAt`, `updatedAt`, `rev`. No IP, no user agent. |
| `AGG#<real\|demo\|judge\|dev>` | `STATS` | Flat counters (`screenings`, `outcome:readers`, `strength:1.50`, `age:45-49`, ...) updated with atomic `ADD`. |
| `HEALTH` | `HEALTH` | Never written; read by the health check. |

### API

| Route | Result |
|---|---|
| `POST /api/v1/results` | `201 {ok:true}` new session; `200 {ok:true, updated:true}` repeat of a `sessionId`; `400` invalid (unknown field, wrong type, out of range); `413` body over 4 KB; `415` content type not JSON/text; `409` repeated write conflicts; `429` throttled. |
| `GET /api/v1/stats` | `200 {updatedAt, generatedAt, traffic:{real,demo,judge,dev}}`, every bucket present (zeros included), `Cache-Control: public, max-age=30`. |
| `GET /api/v1/health` | `200 {ok:true,time}`, or `503 {ok:false,...}` when DynamoDB does not answer within 2 s. |

Idempotency: the first POST for a session runs one transaction (conditional `Put` with
`attribute_not_exists(pk)` + aggregate `ADD`). A repeat re-reads the item and runs a transaction guarded by
the item's `rev` that moves the counts from the old version to the new one, so `screenings` never double counts
and the aggregates always reflect the latest version of every session. Transaction conflicts on the shared
aggregate item are retried with jittered backoff.

## Deploy

Prerequisites: Node.js 22+, the account bootstrapped with `cdk bootstrap`, AWS profile `small-print-agent`.

```bash
cd api && npm ci && npm test          # unit tests (vitest); also installs the SDK and esbuild for bundling
cd ../infra && npm ci
npx tsc --noEmit
npx cdk deploy --all --profile small-print-agent --require-approval never
# optional alarm and budget emails:
npx cdk deploy --all --profile small-print-agent -c alertEmail=you@example.com
```

Build the front-end (`web/dist/index.html`) before deploying to ship it; without it the placeholder in `site/` is deployed.
`cdk synth` runs the cdk-nag AwsSolutions pack and fails on any unacknowledged finding.

Outputs: `SiteUrl`, `ApiUrl` (same-origin `/api/v1`), `DashboardUrl`, `TableName`.

## Cost per 1,000 screenings

Prices: us-east-1 on-demand list prices from the AWS Price List API (October 2026), before free tiers.

Assumptions per screening (deliberately pessimistic): a first-time visitor with an empty browser cache,
one completed test, one result POST, one stats view whose response misses the CloudFront cache.

- Static download about 16 MB: MediaPipe SIMD wasm 11.8 MB (above CloudFront's 10 MB compression limit, so sent
  uncompressed), `face_landmarker.task` 3.8 MB, app shell, JS, CSS and audio about 0.5 MB. About 25 HTTPS requests.
- 2 requests reach the API. Lambda billed time: `results` 100 ms, `stats` 50 ms, both at 256 MB.
- DynamoDB: transactions cost 2x, so a new result = 2 x (1 WRU item put + 2 WRU aggregate update) = 6 WRU.
  Stats = 4 items, eventually consistent = 2 RRU.
- About 2.5 KB of logs (Lambda + access log).

| Item | Quantity per 1,000 | Unit price | Cost |
|---|---|---|---|
| CloudFront data transfer out (North America/Europe) | 16 GB | $0.085 / GB | $1.360 |
| CloudFront HTTPS requests | 25,000 | $0.0100 / 10,000 | $0.025 |
| HTTP API requests | 2,000 | $1.00 / million | $0.002 |
| Lambda requests | 2,000 | $0.20 / million | $0.0004 |
| Lambda compute (ARM) | 1,000 x 0.25 GB x (0.10 + 0.05) s = 37.5 GB-s | $0.0000133334 / GB-s | $0.0005 |
| DynamoDB writes | 6,000 WRU | $0.625 / million | $0.0038 |
| DynamoDB reads | 2,000 RRU | $0.125 / million | $0.0003 |
| CloudWatch Logs ingestion | 2.5 MB | $0.50 / GB | $0.0013 |
| **Total** | | | **about $1.39** |

The backend itself (API Gateway, Lambda, DynamoDB, logs) is about **$0.008 per 1,000 screenings**; 98 % of the
cost is delivering the 16 MB on-device model and runtime. CloudFront's always-free tier (1 TB and 10 million
requests a month) covers about 60,000 such screenings a month, so real cost is close to zero at hackathon scale.
Data transfer to other edge regions (South America, Asia, Africa) is priced higher per GB.

Fixed monthly costs, independent of traffic:

| Item | Monthly |
|---|---|
| Uptime checks: 8,640 runs x 256 MB x about 1 s (2,160 GB-s), plus 17,280 API and 25,920 CloudFront requests | about $0.08 |
| Custom metrics: Screenings x 4 traffic types, Uptime x 3, Latency x 3 = 10 x $0.30 | $3.00 (or $0 inside the 10-metric free tier) |
| Alarms: uptime (metric math over 3 metrics) + API 5xx = 4 alarm metrics x $0.10 | $0.40 (or $0 inside the free tier) |
| Dashboard | $0 for the first 3 dashboards in the account, else $3.00 |
| DynamoDB storage + PITR, S3 storage, Budgets (no actions) | < $0.01 |

Why not the alternatives: a CloudWatch Synthetics canary every 5 minutes would cost about $10/month and AWS WAF at
least $5/month; both would eat most of the $10 budget.

## Security and privacy

- **No personal data, no images.** The contract has no free-text or identifying fields; unknown fields are
  rejected and the stored item is rebuilt from validated fields only. Camera frames never leave the browser, and
  the 4 KB body cap could not carry an image anyway. No IP address or user agent is stored or logged: API access
  logs omit them, Lambda logs carry only validated enum values and error class names (never bodies), and CloudFront
  and S3 access logs are intentionally off because they would record viewer IPs.
- **Least privilege.** Each function has its own role with no AWS managed policies: log writes to its own log group,
  and only the DynamoDB actions it needs on this table, restricted by `dynamodb:LeadingKeys`
  (`results`: GetItem/PutItem/UpdateItem on `SESSION#*`/`AGG#*`; `stats`: BatchGetItem on `AGG#*`; `health`: GetItem on
  `HEALTH`). The uptime function has no data access; EMF metrics need no `cloudwatch:PutMetricData`.
- **Origin protection.** The bucket is private and readable only by this distribution (OAC); TLS is enforced for
  S3 and for CloudFront to the API.
- **Headers on every response** (site and API): `Strict-Transport-Security: max-age=31536000; includeSubDomains`,
  `Permissions-Policy: camera=(self), microphone=(), geolocation=()`, `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`.
- **Abuse and cost limits.** Stage throttling (20 rps, burst 40), strict validation, 4 KB body cap, stats served from
  the edge cache, the $10 budget and the uptime and 5xx alarms.
- **Data durability.** Point-in-time recovery (35 days), deletion protection, table retained if the stack is deleted.

### cdk-nag

`bin/app.ts` runs the AwsSolutions pack on every synth; it is clean apart from these acknowledged findings, each
with its reason in [`lib/nag.ts`](lib/nag.ts):

| Rule | Where | Reason (short) |
|---|---|---|
| S1 | Site bucket | OAC-only private bucket; every read is a CloudFront origin fetch, so access logs add cost without information. |
| CFR1 | Distribution | Global audience; no geo restriction wanted. |
| CFR2 | Distribution | WAF ($5+/month) does not fit the $10 budget; throttling, validation, caching and the budget bound abuse. |
| CFR3 | Distribution | CloudFront access logs record viewer IPs; we collect none. Metrics and uptime checks instead. |
| CFR4 | Distribution | Default `*.cloudfront.net` certificate; minimum TLS needs a custom domain. HSTS on. |
| APIG4 | HTTP API routes | Public anonymous API by design; bounded by throttling, validation and size cap. |
| L1 | Our functions | Node.js 22 LTS is the pinned, tested runtime. |
| L1, IAM4, IAM5 | CDK `BucketDeployment` handler | Runtime and S3/CloudFront grants are generated by aws-cdk-lib and scoped to the site and assets buckets. |

### Known limits and next steps

- The HTTP API's `execute-api` hostname is publicly reachable, bypassing CloudFront (stage throttling still
  applies). With a custom domain the default endpoint can be disabled; or CloudFront can add a secret origin header.
- One aggregate item per traffic type is a hot key. Fine at this scale (transactions are retried on conflict);
  shard the counters (`AGG#real#0..N`) above roughly 100 writes per second.
- The 11.8 MB MediaPipe wasm is above CloudFront's 10 MB compression limit. Pre-compressing it with Brotli at build
  time (stored with `Content-Encoding: br`) would cut the largest download to about a quarter.
- The budget is account-wide (tag-filtered budgets need the `Project` cost allocation tag activated in Billing).
