# AWS Well-Architected review of Small Print (public summary)

**How it was produced:** with the official AWS Agent Toolkit skill **`aws-well-architected-review`**, loaded through the **AWS MCP Server** (`aws___retrieve_skill`). The coding agent ran it in full-review mode on Oct 2, 2026:
- **Framework:** read live from AWS documentation with `aws___read_documentation` (28 pages).
- **Account:** inspected read-only with `aws___run_script`.
- **Regions:** checked with `aws___get_regional_availability`.
- **Total:** about 36 AWS MCP calls.

The full report contains account-level details, so it is kept private. This page is the workload-level summary and what we changed because of it.

## Scorecard

| Pillar | Score (1–5) | Strength | Gap found → status |
|---|---|---|---|
| Operational Excellence | 3 | IaC with a cdk-nag gate, unit, API and e2e tests, KPI dashboard, symptom-based alarms | A deploy could silently replace the live site; the camera app wasn't monitored → **fixed** (F1, F6) |
| Security | 3 | Least privilege per function, Origin Access Control, security headers, no personal data by design, MCP write guardrail on the agent | No Content-Security-Policy → **added in report-only mode** (F8). Account-level identity items → sent to the account owner |
| Reliability | 4 | Idempotent writes, offline outbox, graceful degradation, point-in-time recovery, uptime alarm | No concurrency bulkhead in a shared account; judged URL unprotected → **fixed** (F3, F4) |
| Performance Efficiency | 4 | Edge caching, HTTP/3, brotli-precompressed wasm, ARM64, on-device inference | No backend load test (traffic is far below the throttle) |
| Cost Optimization | 3 | Cost per 1,000 screenings modelled; throttling and caching as cost controls | Budget not scoped to the project → **pending** a cost-allocation tag (F7) |
| Sustainability | 4 | Inference on the device, pre-generated audio, Graviton, scale-to-zero | No data lifecycle → **fixed** (F2 S3 lifecycle, F9 DynamoDB TTL) |

307 best practices assessed, with **0 critical** findings. 206/206 uptime checks passed in the previous 7 days.

## Changes made from the review (deployed Oct 2, 2026)

| # | Change | Best practice | Where |
|---|---|---|---|
| F1 | Synth refuses to deploy the placeholder site or uncompressed WebAssembly | OPS06-BP01 | `infra/lib/site-stack.ts` |
| F2 | S3 versioning; old versions expire after 30 days | OPS06-BP01, SUS04-BP03 | `infra/lib/site-stack.ts` |
| F3 | Stack termination protection (the judged CloudFront URL can't be recreated) | REL13-BP02 | `infra/bin/app.ts` |
| F4 | Reserved concurrency 40 / 10 / 5 / 2 per function (bulkhead and kill switch) | REL10-BP03 | `infra/lib/api.ts`, `monitoring.ts` |
| F5 | New alarms: CloudFront 5xx rate; Lambda and DynamoDB throttles | OPS08-BP04, REL01-BP04 | `infra/lib/monitoring.ts` |
| F6 | Uptime check now covers the camera app: test page, brotli wasm, face model | OPS06-BP02 | `api/src/handlers/uptime.ts` |
| F8 | Content-Security-Policy in report-only mode (hash-pinned inline script, `wasm-unsafe-eval`) | SEC01-BP06 | `infra/lib/site-stack.ts` |
| F9 | DynamoDB TTL: anonymous session rows expire after about 400 days; aggregates never expire | SEC07-BP04 | `infra/lib/api.ts`, `api/src/store.ts` |

## Considered and deliberately not done before judging

- **Lambda JSON log format:** it would stop the embedded-metric uptime metrics and fire the uptime alarm.
- **Disabling the execute-api endpoint:** CloudFront's API origin uses it.
- **AWS WAF:** at least $5 a month against a $10 budget; throttling, validation and the budget bound abuse.
- **CloudFront access logs:** they would record viewer IPs, contrary to the privacy design.

## Where the users are: regional availability (checked with `aws___get_regional_availability`)

Every service the app uses is available in **Cape Town (af-south-1)**, **São Paulo (sa-east-1)** and **Mumbai (ap-south-1)**: CloudFront, S3, Lambda, API Gateway HTTP API, DynamoDB, Polly, EventBridge and CloudWatch. Those are close to the regions with the biggest unmet need for reading glasses. This is a data-residency option for partner deployments: Cape Town is an opt-in Region, and São Paulo has no neural Polly voices, which doesn't matter because voice clips are generated at build time.
