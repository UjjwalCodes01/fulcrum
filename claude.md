# Project Fulcrum - Claude Context Document

> This document provides complete context for Claude to assist with Project Fulcrum development.
> Read this FIRST before making any changes to the codebase.

---

## 1. PROJECT OVERVIEW

### What Is Fulcrum?
A **Zero-Trust AI Security Agent** that audits and remediates security issues across GitHub, Jira, and Slack. The agent operates with **no standing permissions** - it borrows identity through Auth0's Token Vault and requires human approval for high-stakes actions.

### The Problem We Solve
Traditional AI agents have **excessive agency** - they hold admin keys in .env files. One prompt injection = catastrophic damage. Fulcrum solves this with "Identity-Mediated Execution."

### Core Philosophy
```
The agent is IDENTITY-LESS by default.
It BORROWS power through Auth0 Token Vault.
It ASKS permission through Auth0 FGA.
It REQUIRES approval through Auth0 CIBA for dangerous actions.
```

---

## 2. THE AUTH0 TRINITY (Memorize This)

### 2.1 Token Vault (The Kyber Vault)
**What:** Secure storage for OAuth tokens (GitHub, Jira, Slack)
**How:** Agent never sees raw tokens. It gets short-lived, scoped proxy tokens.
**Why:** If agent is compromised, attacker gets nothing useful.

```typescript
// WRONG (Slop)
const github = new Octokit({ auth: process.env.GITHUB_TOKEN });

// RIGHT (Fulcrum)
const token = await tokenVault.getToken({
  userId: session.userId,
  connection: 'github',
  scopes: ['repo:read'] // Only what we need
});
const github = new Octokit({ auth: token.access_token });
```

### 2.2 Fine-Grained Authorization - FGA (The Jedi Council)
**What:** Relationship-based access control
**How:** Define relationships like `user:alice owns repo:my-app`
**Why:** Agent must prove it has permission BEFORE acting

```typescript
// Before EVERY tool call:
const allowed = await fga.check({
  user: `user:${userId}`,
  relation: 'can_execute',
  object: `action:${actionName}`
});

if (!allowed) {
  return "The Jedi Council has denied this action.";
}
```

### 2.3 CIBA - Client Initiated Backchannel Auth (The Force Link)
**What:** Push notification to user's phone for approval
**How:** Agent pauses, Auth0 pings phone, user approves with biometric
**Why:** High-stakes actions (delete, modify, merge) need human confirmation

```typescript
// For Level 5 actions:
const cibaRequest = await auth0.ciba.initiate({
  userId: session.userId,
  bindingMessage: `Fulcrum wants to: ${actionDescription}`,
  scope: 'openid profile'
});

// Agent enters PENDING_APPROVAL state
await stateMachine.transition('AWAITING_APPROVAL', {
  cibaRequestId: cibaRequest.auth_req_id
});

// Poll or webhook for approval...
```

---

## 3. ARCHITECTURE OVERVIEW

```
┌─────────────────────────────────────────────────────────────┐
│                     USER INTERFACE                          │
│                   (Next.js Frontend)                        │
└─────────────────────┬───────────────────────────────────────┘
                      │ WebSocket / REST
┌─────────────────────▼───────────────────────────────────────┐
│                  FULCRUM CORE                               │
│              (Node.js + Express + LangGraph)                │
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │   Gemini    │  │  LangGraph  │  │   Tool Handlers     │ │
│  │  2.0 Pro    │──│   State     │──│ (GitHub/Jira/Slack) │ │
│  │  (Vertex)   │  │   Machine   │  │                     │ │
│  └─────────────┘  └──────┬──────┘  └──────────┬──────────┘ │
│                          │                     │            │
└──────────────────────────┼─────────────────────┼────────────┘
                           │                     │
┌──────────────────────────▼─────────────────────▼────────────┐
│                    AUTH0 LAYER                              │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ Token Vault │  │    FGA      │  │       CIBA          │ │
│  │ (Tokens)    │  │ (Perms)     │  │   (Approvals)       │ │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
└─────────┼────────────────┼─────────────────────┼────────────┘
          │                │                     │
┌─────────▼────────────────▼─────────────────────▼────────────┐
│                   EXTERNAL APIS                             │
│        GitHub API    │    Jira API    │    Slack API        │
└─────────────────────────────────────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────────┐
│                   PERSISTENCE LAYER                         │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │ PostgreSQL  │  │   Pub/Sub   │  │   Cloud Logging     │ │
│  │  (State)    │  │ (Events)    │  │   (Audit Trail)     │ │
│  └─────────────┘  └─────────────┘  └─────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 4. STATE MACHINE (LangGraph)

### States
```typescript
type FulcrumState = 
  | 'IDLE'                    // Waiting for user input
  | 'PLANNING'                // Gemini analyzing intent
  | 'CHECKING_PERMISSIONS'    // FGA validation
  | 'EXECUTING'               // Running tool
  | 'AWAITING_APPROVAL'       // CIBA pending
  | 'APPROVED'                // CIBA approved, resuming
  | 'DENIED'                  // FGA or CIBA denied
  | 'COMPLETED'               // Mission done
  | 'ERROR';                  // Something broke
```

### Transitions
```
IDLE → PLANNING (user sends message)
PLANNING → CHECKING_PERMISSIONS (Gemini decides tool call)
CHECKING_PERMISSIONS → EXECUTING (FGA allows)
CHECKING_PERMISSIONS → DENIED (FGA denies)
EXECUTING → AWAITING_APPROVAL (high-stakes action)
AWAITING_APPROVAL → APPROVED (user approves)
AWAITING_APPROVAL → DENIED (user denies or timeout)
APPROVED → EXECUTING (resume with token)
EXECUTING → COMPLETED (tool succeeds)
EXECUTING → ERROR (tool fails)
```

---

## 5. TOOL DEFINITIONS

### GitHub Tools (The Slicer)
| Tool | Risk Level | Requires CIBA? | Scopes Needed |
|------|------------|----------------|---------------|
| `github_list_repos` | 1 | No | `repo:read` |
| `github_scan_secrets` | 2 | No | `repo:read` |
| `github_read_file` | 1 | No | `repo:read` |
| `github_create_issue` | 3 | No | `repo:write` |
| `github_create_pr` | 4 | No | `repo:write` |
| `github_merge_pr` | 5 | **YES** | `repo:write` |
| `github_delete_branch` | 5 | **YES** | `repo:delete` |

### Jira Tools (The Navigator)
| Tool | Risk Level | Requires CIBA? | Scopes Needed |
|------|------------|----------------|---------------|
| `jira_list_projects` | 1 | No | `read:jira-work` |
| `jira_search_issues` | 1 | No | `read:jira-work` |
| `jira_create_issue` | 3 | No | `write:jira-work` |
| `jira_update_issue` | 4 | No | `write:jira-work` |
| `jira_delete_issue` | 5 | **YES** | `write:jira-work` |

### Slack Tools (The Comm Link)
| Tool | Risk Level | Requires CIBA? | Scopes Needed |
|------|------------|----------------|---------------|
| `slack_list_channels` | 1 | No | `channels:read` |
| `slack_send_message` | 3 | No | `chat:write` |
| `slack_send_to_security` | 4 | No | `chat:write` |
| `slack_invite_user` | 5 | **YES** | `users:write` |

---

## 6. FGA SCHEMA (Relationship Definitions)

```
# Type definitions
type user
type agent
type project
type repository
type action

# Users own projects
relation owns: user
  on project

# Projects contain repositories  
relation contains: project
  on repository

# Agents can act on behalf of users
relation can_act_on_behalf_of: user
  on agent

# Users can execute actions
relation can_execute: user
  on action

# Actions require approval
relation requires_approval: action
  implies needs_ciba: true

# Permission checks the agent runs:
# 1. Is user authenticated? (Auth0 session)
# 2. Can agent act on behalf of user? (FGA)
# 3. Can user execute this action? (FGA)
# 4. Does action require approval? (FGA → CIBA)
```

---

## 7. DATABASE SCHEMA (Cloud SQL - PostgreSQL)

### Primary Use: LangGraph State Persistence
```sql
-- LangGraph checkpoints (auto-created by PostgresCheckpointer)
-- This is the agent's memory - DO NOT modify manually
CREATE TABLE checkpoints (
  thread_id VARCHAR(255) NOT NULL,
  checkpoint_ns VARCHAR(255) NOT NULL DEFAULT '',
  checkpoint_id VARCHAR(255) NOT NULL,
  parent_checkpoint_id VARCHAR(255),
  checkpoint JSONB NOT NULL,  -- Full agent state
  metadata JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW(),
  PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
);

CREATE INDEX idx_checkpoints_thread ON checkpoints(thread_id);
```

### Application Tables (Our Custom Schema)
```sql
-- User sessions
CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  auth0_sub VARCHAR(255) NOT NULL,
  thread_id VARCHAR(255) NOT NULL,  -- Links to LangGraph checkpoint
  created_at TIMESTAMP DEFAULT NOW(),
  last_active TIMESTAMP DEFAULT NOW()
);

-- Tool executions (for analytics)
CREATE TABLE tool_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id UUID REFERENCES sessions(id),
  tool_name VARCHAR(100) NOT NULL,
  input JSONB,
  output JSONB,
  fga_check_passed BOOLEAN,
  ciba_required BOOLEAN DEFAULT false,
  ciba_approved BOOLEAN,
  token_vault_used BOOLEAN DEFAULT true,
  execution_time_ms INTEGER,
  cost_estimate DECIMAL(10, 4),  -- Track Vertex AI costs
  created_at TIMESTAMP DEFAULT NOW()
);

-- Audit log (immutable - NEVER delete)
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth0_trace_id VARCHAR(255),
  session_id UUID REFERENCES sessions(id),
  user_id VARCHAR(255) NOT NULL,
  agent_id VARCHAR(100) DEFAULT 'fulcrum:security-auditor',
  action VARCHAR(100) NOT NULL,
  resource VARCHAR(255),
  fga_result VARCHAR(20),
  ciba_status VARCHAR(20),
  result VARCHAR(20),
  details JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

-- CIBA requests tracking
CREATE TABLE ciba_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_req_id VARCHAR(255) UNIQUE NOT NULL,
  session_id UUID REFERENCES sessions(id),
  action_requested VARCHAR(100),
  binding_message TEXT,
  status VARCHAR(20) DEFAULT 'PENDING',
  expires_at TIMESTAMP,
  approved_at TIMESTAMP,
  denied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Cost tracking (monitor GCP spend)
CREATE TABLE cost_tracking (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  service VARCHAR(50) NOT NULL,  -- 'vertex_ai', 'cloud_sql', etc.
  estimated_cost DECIMAL(10, 4) NOT NULL,
  tokens_used INTEGER,
  requests_count INTEGER,
  date DATE DEFAULT CURRENT_DATE
);

-- Indexes
CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_thread ON sessions(thread_id);
CREATE INDEX idx_audit_session ON audit_log(session_id);
CREATE INDEX idx_audit_user ON audit_log(user_id);
CREATE INDEX idx_audit_created ON audit_log(created_at);
CREATE INDEX idx_ciba_auth_req ON ciba_requests(auth_req_id);
CREATE INDEX idx_tool_created ON tool_executions(created_at);
CREATE INDEX idx_cost_date ON cost_tracking(date);
```

### 🚨 COST MONITORING QUERIES
```sql
-- Daily Vertex AI cost estimate
SELECT 
  DATE(created_at) as date,
  COUNT(*) as requests,
  SUM(cost_estimate) as estimated_cost
FROM tool_executions
WHERE tool_name LIKE 'gemini_%'
GROUP BY DATE(created_at)
ORDER BY date DESC;

-- Check if approaching budget
SELECT SUM(estimated_cost) as total_cost
FROM cost_tracking
WHERE date >= CURRENT_DATE - INTERVAL '26 days';

-- Alert if > $45
SELECT CASE 
  WHEN SUM(estimated_cost) > 45 THEN 'BUDGET ALERT!'
  ELSE 'OK'
END as status
FROM cost_tracking
WHERE date >= CURRENT_DATE - INTERVAL '26 days';
```

---

## 8. API ENDPOINTS

```typescript
// Authentication
POST   /api/auth/login          // Redirect to Auth0
GET    /api/auth/callback       // Auth0 callback
POST   /api/auth/logout         // End session
GET    /api/auth/me             // Current user info

// Agent
POST   /api/agent/message       // Send message to agent
GET    /api/agent/state         // Get current state
POST   /api/agent/approve       // Manual approval (backup)
POST   /api/agent/deny          // Manual denial
GET    /api/agent/history       // Session history

// Connections (Token Vault)
GET    /api/connections         // List connected services
POST   /api/connections/github  // Connect GitHub
POST   /api/connections/jira    // Connect Jira
POST   /api/connections/slack   // Connect Slack
DELETE /api/connections/:id     // Disconnect service

// Audit
GET    /api/audit               // Audit log (paginated)
GET    /api/audit/:sessionId    // Audit for specific session

// Health
GET    /api/health              // Service health check
```

---

## 9. ENVIRONMENT VARIABLES

```bash
# Auth0 - Core
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=xxxxx
AUTH0_CLIENT_SECRET=xxxxx
AUTH0_AUDIENCE=https://fulcrum-api
AUTH0_CALLBACK_URL=http://localhost:3000/api/auth/callback

# Auth0 - Token Vault (AI Agents)
AUTH0_TOKEN_VAULT_URL=https://your-tenant.auth0.com
AUTH0_M2M_CLIENT_ID=xxxxx
AUTH0_M2M_CLIENT_SECRET=xxxxx

# Auth0 - FGA
AUTH0_FGA_STORE_ID=xxxxx
AUTH0_FGA_MODEL_ID=xxxxx
AUTH0_FGA_API_URL=https://api.us1.fga.dev

# Auth0 - CIBA
AUTH0_CIBA_CLIENT_ID=xxxxx
AUTH0_CIBA_CLIENT_SECRET=xxxxx

# Google Cloud
GCP_PROJECT_ID=fulcrum-hackathon
GCP_REGION=us-central1
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# Database (Cloud SQL - PostgreSQL)
DATABASE_URL=postgresql://fulcrum_user:PASSWORD@/fulcrum?host=/cloudsql/fulcrum-hackathon:us-central1:fulcrum-db
# For local dev: postgresql://postgres:password@localhost:5432/fulcrum

# Cost Control
MAX_DAILY_VERTEX_REQUESTS=50  # Prevent runaway costs
ALERT_THRESHOLD_USD=45        # Email alert at $45

# Pub/Sub (for CIBA events)
PUBSUB_TOPIC_CIBA=fulcrum-ciba-events
PUBSUB_SUBSCRIPTION_CIBA=fulcrum-ciba-sub

# App
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000
```

---

## 10. ERROR HANDLING PATTERNS

### FGA Denial
```typescript
if (!fgaResult.allowed) {
  await auditLog.record({
    action: toolName,
    fga_result: 'DENIED',
    result: 'BLOCKED',
    details: { reason: 'FGA check failed', tuple: fgaResult.tuple }
  });
  
  return {
    success: false,
    message: "The Jedi Council has denied this action.",
    code: 'FGA_DENIED'
  };
}
```

### CIBA Timeout
```typescript
const CIBA_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

if (Date.now() > cibaRequest.expires_at) {
  await stateMachine.transition('DENIED', {
    reason: 'CIBA timeout - user did not respond'
  });
  
  return {
    success: false,
    message: "The Force Link timed out. Please try again.",
    code: 'CIBA_TIMEOUT'
  };
}
```

### Token Vault Failure
```typescript
try {
  const token = await tokenVault.getToken(connection, scopes);
} catch (error) {
  if (error.code === 'TOKEN_EXPIRED') {
    // Trigger re-auth flow
    return { redirect: `/api/connections/${connection}/reauth` };
  }
  if (error.code === 'CONNECTION_NOT_FOUND') {
    return { 
      success: false,
      message: `Please connect your ${connection} account first.`,
      code: 'CONNECTION_REQUIRED'
    };
  }
  throw error;
}
```

---

## 11. SECURITY RULES (NEVER VIOLATE)

### Authentication & Authorization
1. **Never log raw tokens** - Use masked versions: `ghp_****xxxx`
2. **Never store tokens locally** - Always use Token Vault
3. **Never skip FGA checks** - Every tool call needs permission check
4. **Never bypass CIBA for Level 5 actions** - Even in "dev mode"
5. **Always set token expiry** - No permanent tokens
6. **Always log to audit trail** - Every action is recorded

### Data Protection
7. **Always use parameterized queries** - No SQL injection
8. **Always validate user input** - Sanitize before passing to Vertex AI
9. **Never commit .env files** - Use .gitignore
10. **Never commit service account keys** - Use Secret Manager in production

### Cost Protection (CRITICAL)
11. **Never allow unlimited Vertex AI calls** - Rate limit per user
12. **Always validate input length** - Max 5000 chars to prevent token bombs
13. **Always set max-instances=1** - Prevent Cloud Run scaling abuse
14. **Always monitor daily costs** - Check GCP billing dashboard
15. **Never expose GCP credentials** - Backend only, never in frontend
16. **Always use budget alerts** - Get notified at 50%, 90%, 100%

### 🚨 IMMEDIATE ACTIONS IF COSTS SPIKE
```bash
# 1. Check current spend
gcloud billing accounts describe ACCOUNT_ID

# 2. Stop Cloud SQL immediately
gcloud sql instances patch fulcrum-db --activation-policy=NEVER

# 3. Disable Cloud Run auto-scaling
gcloud run services update fulcrum-api --max-instances=0

# 4. Check audit logs for abuse
gcloud logging read "resource.type=cloud_run_revision" --limit 100

# 5. Rotate all credentials if compromised
```

---

## 12. TESTING CHECKLIST

### Unit Tests Required
- [ ] FGA check passes for allowed user
- [ ] FGA check fails for unauthorized user
- [ ] CIBA request initiates correctly
- [ ] CIBA approval resumes execution
- [ ] CIBA denial stops execution
- [ ] CIBA timeout handled gracefully
- [ ] Token Vault returns scoped token
- [ ] Token Vault handles expired token
- [ ] State machine transitions correctly
- [ ] Audit log records all actions

### Integration Tests Required
- [ ] Full flow: Scan repo → Find secret → Create Jira → Approve → Fix
- [ ] FGA denial stops tool execution
- [ ] CIBA approval releases token
- [ ] Audit trail is complete and accurate
- [ ] Session persistence across server restart

---

## 13. COMMON MISTAKES (Avoid These)

### Mistake 1: Hardcoding Scopes
```typescript
// WRONG
const token = await tokenVault.getToken('github', ['admin:org']);

// RIGHT
const token = await tokenVault.getToken('github', TOOL_SCOPES[toolName]);
```

### Mistake 2: Forgetting State Persistence
```typescript
// WRONG
let currentState = 'IDLE'; // Lost on server restart!

// RIGHT
const state = await db.sessions.findById(sessionId);
```

### Mistake 3: Not Waiting for CIBA
```typescript
// WRONG
await ciba.initiate(request);
await executeTool(); // Agent proceeds without approval!

// RIGHT
await ciba.initiate(request);
await stateMachine.transition('AWAITING_APPROVAL');
// Tool execution happens in APPROVED handler
```

### Mistake 4: Logging Sensitive Data
```typescript
// WRONG
console.log('Token:', token.access_token);

// RIGHT
console.log('Token obtained for connection:', connection);
```

---

## 14. FILE STRUCTURE REFERENCE

```
fulcrum/
├── apps/
│   ├── web/                    # Next.js frontend
│   │   ├── app/
│   │   │   ├── page.tsx        # Landing/Dashboard
│   │   │   ├── agent/
│   │   │   │   └── page.tsx    # Agent chat interface
│   │   │   ├── connections/
│   │   │   │   └── page.tsx    # Manage OAuth connections
│   │   │   └── audit/
│   │   │       └── page.tsx    # Audit log viewer
│   │   ├── components/
│   │   │   ├── AgentChat.tsx
│   │   │   ├── ApprovalModal.tsx
│   │   │   ├── AuditTable.tsx
│   │   │   └── ConnectionCard.tsx
│   │   └── lib/
│   │       └── api.ts          # API client
│   │
│   └── api/                    # Node.js backend
│       ├── src/
│       │   ├── index.ts        # Express entry
│       │   ├── routes/
│       │   │   ├── auth.ts
│       │   │   ├── agent.ts
│       │   │   ├── connections.ts
│       │   │   └── audit.ts
│       │   ├── agent/
│       │   │   ├── graph.ts    # LangGraph definition
│       │   │   ├── state.ts    # State machine
│       │   │   ├── tools/
│       │   │   │   ├── github.ts
│       │   │   │   ├── jira.ts
│       │   │   │   └── slack.ts
│       │   │   └── prompts.ts  # System prompts
│       │   ├── auth0/
│       │   │   ├── token-vault.ts
│       │   │   ├── fga.ts
│       │   │   └── ciba.ts
│       │   ├── db/
│       │   │   ├── client.ts   # Postgres client
│       │   │   ├── schema.ts   # Drizzle schema
│       │   │   └── migrations/
│       │   └── utils/
│       │       ├── audit.ts
│       │       └── logger.ts
│       └── tests/
│           ├── unit/
│           └── integration/
│
├── packages/
│   └── shared/                 # Shared types
│       ├── types.ts
│       └── constants.ts
│
├── infra/                      # GCP infrastructure
│   ├── terraform/
│   │   ├── main.tf
│   │   ├── cloud-run.tf
│   │   ├── cloud-sql.tf
│   │   └── pubsub.tf
│   └── cloudbuild.yaml
│
├── docs/
│   ├── architecture.md
│   ├── fga-schema.md
│   ├── api-reference.md
│   └── deployment.md
│
├── .github/
│   └── workflows/
│       └── deploy.yaml
│
├── claude.md                   # THIS FILE
├── implementation.md           # Phase-by-phase plan
├── hackathon.md               # Hackathon requirements
├── package.json
├── turbo.json                  # Monorepo config
└── README.md
```

---

## 15. QUICK COMMANDS

```bash
# Development
pnpm install                    # Install dependencies
pnpm dev                        # Start all services
pnpm dev:api                    # Start API only
pnpm dev:web                    # Start frontend only

# Database
pnpm db:migrate                 # Run migrations
pnpm db:seed                    # Seed test data
pnpm db:studio                  # Open Drizzle Studio

# Testing
pnpm test                       # Run all tests
pnpm test:unit                  # Unit tests only
pnpm test:integration           # Integration tests

# Deployment
pnpm build                      # Build all
gcloud run deploy               # Deploy to Cloud Run
```

---

## 16. WHEN CLAUDE IS STUCK

If you (Claude) are unsure about something:

1. **Check the FGA schema** - Is the relationship defined?
2. **Check the tool risk level** - Does it need CIBA?
3. **Check the state machine** - What state should we be in?
4. **Check the audit log** - What happened before this point?
5. **Ask the user** - Use `ask_user` tool for clarification

**Never assume permissions exist. Always verify with FGA.**
**Never skip CIBA for Level 5 actions. Even for testing.**
**Never expose tokens in logs or responses.**
