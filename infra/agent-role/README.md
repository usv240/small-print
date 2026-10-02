# The coding agent's IAM role (`small-print-agent`)

Claude Code worked on AWS through the AWS MCP Server (Agent Toolkit for AWS) using only this role, so its actions are separable in CloudTrail (session name `claude-code-agent`).

| Policy | What it allows |
|---|---|
| `ReadOnlyAccess` (AWS managed) | Inspect resources, logs, metrics, CloudTrail |
| `agent-extras.json` | Assume only the CDK deployment roles (`cdk-hnb659fds-*`); Polly for voice clips; CloudFront invalidations |
| `mcp-guardrail.json` | **Explicit Deny** on every one of those write paths when the call arrives through the AWS MCP Server (`aws:ViaAWSMCPService = true`) |

**Result:** through the MCP server the agent can only *read*. Anything that changes the account must go through reviewed infrastructure code (`cdk deploy`) from the developer's terminal.

Verified on Oct 2, 2026:

| Same action | Through the AWS MCP Server | From the CLI / CDK |
|---|---|---|
| `sts:GetCallerIdentity` (read) | allowed | allowed |
| `polly:SynthesizeSpeech` | **AccessDenied (explicit deny)** | allowed |
| `sts:AssumeRole` on the CDK deploy role | **AccessDenied** | allowed |

The condition key is documented in [How AWS MCP Server works with IAM](https://docs.aws.amazon.com/agent-toolkit/latest/userguide/security_iam_service-with-iam.html) and [Understanding IAM for Managed AWS MCP Servers](https://aws.amazon.com/blogs/security/understanding-iam-for-managed-aws-mcp-servers/).

Recreate (replace placeholders):
```bash
aws iam create-role --role-name small-print-agent --assume-role-policy-document file://trust.json --max-session-duration 43200
aws iam attach-role-policy --role-name small-print-agent --policy-arn arn:aws:iam::aws:policy/ReadOnlyAccess
aws iam put-role-policy --role-name small-print-agent --policy-name small-print-agent-extras --policy-document file://agent-extras.json
aws iam put-role-policy --role-name small-print-agent --policy-name small-print-agent-mcp-guardrail --policy-document file://mcp-guardrail.json
```
