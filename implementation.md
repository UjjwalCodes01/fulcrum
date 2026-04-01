# Project Fulcrum - Implementation Plan

> Phased execution plan with detailed steps, dependencies, and validation checkpoints.
> **Timeline:** 6 days (April 1-7, 2026)
> **Goal:** Production-ready submission with demo video

---

## PHASE 0: FOUNDATION (Day 1 Morning)
**Duration:** 3-4 hours  
**Goal:** Project scaffolding, credentials setup, local dev environment

### 🚨 CRITICAL FIRST STEP: COST PROTECTION
**Before anything else, protect your budget!**

```bash
# 1. Set billing alerts (DO THIS FIRST!)
gcloud billing budgets create \
  --billing-account=YOUR_ACCOUNT_ID \
  --display-name="Fulcrum Budget Alert" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.5 \
  --threshold-rule=percent=0.9 \
  --threshold-rule=percent=1.0

# 2. Set up billing alerts email
# Go to: https://console.cloud.google.com/billing/budgets

# 3. Enable daily cost monitoring
gcloud services enable cloudresourcemanager.googleapis.com

# 4. Create .gitignore IMMEDIATELY
cat > .gitignore << EOF
.env
.env.local
.env.production
service-account.json
*.pem
*.key
node_modules/
dist/
.DS_Store
EOF
```

**Budget Breakdown ($50 total):**
- Cloud SQL: $10 (26 days)
- Vertex AI: $23 (26 days)
- Cloud Run: $8 (26 days)
- Other: $1 (Pub/Sub, Secrets)
- Buffer: $8 ✅

### 0.1 Project Setup
- [ ] Initialize monorepo with pnpm + Turborepo
- [ ] Create folder structure (apps/web, apps/api, packages/shared)
- [ ] Configure TypeScript (strict mode)
- [ ] Setup ESLint + Prettier
- [ ] Create .env.example with all required variables

### 0.2 Auth0 Configuration (UI Dashboard)
**In Auth0 Dashboard:**
- [ ] Create Application (Regular Web App) for frontend
- [ ] Create Application (Machine-to-Machine) for backend
- [ ] Enable "Auth0 for AI Agents" add-on
- [ ] Configure Token Vault connections:
  - [ ] GitHub OAuth App connection
  - [ ] Jira OAuth connection  
  - [ ] Slack OAuth connection
- [ ] Create FGA Store and Model
- [ ] Enable CIBA for the tenant
- [ ] Configure Guardian for push notifications

**Record these values:**
```
AUTH0_DOMAIN=
AUTH0_CLIENT_ID=
AUTH0_CLIENT_SECRET=
AUTH0_M2M_CLIENT_ID=
AUTH0_M2M_CLIENT_SECRET=
AUTH0_FGA_STORE_ID=
AUTH0_FGA_MODEL_ID=
```

### 0.3 GCP Project Setup
```bash
# Create project
gcloud projects create fulcrum-hackathon --name="Project Fulcrum"
gcloud config set project fulcrum-hackathon

# Link billing (REQUIRED)
gcloud beta billing projects link fulcrum-hackathon \
  --billing-account=YOUR_BILLING_ACCOUNT_ID

# Enable required APIs
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  sqladmin.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  cloudbuild.googleapis.com

# Create service account with minimal permissions
gcloud iam service-accounts create fulcrum-backend \
  --display-name="Fulcrum Backend Service"

# Grant only needed roles (principle of least privilege)
gcloud projects add-iam-policy-binding fulcrum-hackathon \
  --member="serviceAccount:fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com" \
  --role="roles/aiplatform.user"

gcloud projects add-iam-policy-binding fulcrum-hackathon \
  --member="serviceAccount:fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com" \
  --role="roles/cloudsql.client"

gcloud projects add-iam-policy-binding fulcrum-hackathon \
  --member="serviceAccount:fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com" \
  --role="roles/pubsub.editor"

gcloud projects add-iam-policy-binding fulcrum-hackathon \
  --member="serviceAccount:fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"

# Download service account key (NEVER commit to git!)
gcloud iam service-accounts keys create service-account.json \
  --iam-account=fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com

# Move to safe location
mv service-account.json ~/.gcp/fulcrum-sa.json
chmod 600 ~/.gcp/fulcrum-sa.json
```

**Cost Protection Checklist:**
- [ ] Billing alerts set at $25, $45, $50
- [ ] .gitignore created with .env and service-account.json
- [ ] Daily cost monitoring enabled
- [ ] Max instances set to 1 for all services

### 0.4 External OAuth Apps
**GitHub:**
- [ ] Create OAuth App at github.com/settings/developers
- [ ] Set callback URL to Auth0's callback
- [ ] Record Client ID and Secret → Add to Auth0 connection

**Atlassian (Jira):**
- [ ] Create OAuth 2.0 app at developer.atlassian.com
- [ ] Set callback URL to Auth0's callback
- [ ] Add scopes: `read:jira-work`, `write:jira-work`
- [ ] Record credentials → Add to Auth0 connection

**Slack:**
- [ ] Create app at api.slack.com/apps
- [ ] Set OAuth redirect to Auth0's callback
- [ ] Add scopes: `channels:read`, `chat:write`
- [ ] Record credentials → Add to Auth0 connection

### Checkpoint 0 ✓
```bash
# Verify:
- [ ] pnpm install works
- [ ] TypeScript compiles
- [ ] All .env variables documented
- [ ] Auth0 dashboard accessible
- [ ] GCP project created with APIs enabled
```

---

## PHASE 1: AUTH0 CORE INTEGRATION (Day 1 Afternoon)
**Duration:** 4-5 hours  
**Goal:** Working Auth0 login + Token Vault connection flow

### 1.1 Backend Auth Setup
```bash
cd apps/api
pnpm add express express-oauth2-jwt-bearer auth0 @auth0/fga
pnpm add -D @types/express
```

**Files to create:**
- [ ] `src/index.ts` - Express server entry
- [ ] `src/middleware/auth.ts` - JWT validation middleware
- [ ] `src/routes/auth.ts` - Login/callback/logout routes
- [ ] `src/auth0/client.ts` - Auth0 Management API client

### 1.2 Token Vault Integration
**Files to create:**
- [ ] `src/auth0/token-vault.ts` - Token Vault wrapper

```typescript
// Key functions to implement:
export async function getAccessToken(
  userId: string,
  connection: 'github' | 'jira' | 'slack',
  scopes: string[]
): Promise<TokenResponse>

export async function hasConnection(
  userId: string,
  connection: string
): Promise<boolean>

export async function initiateConnection(
  userId: string,
  connection: string,
  scopes: string[]
): Promise<{ authorizationUrl: string }>
```

### 1.3 Frontend Auth Setup
```bash
cd apps/web
pnpm add @auth0/nextjs-auth0
```

**Files to create:**
- [ ] `app/api/auth/[auth0]/route.ts` - Auth0 route handler
- [ ] `app/providers.tsx` - UserProvider wrapper
- [ ] `middleware.ts` - Route protection

### 1.4 Connection Flow UI
- [ ] `app/connections/page.tsx` - List connected services
- [ ] `components/ConnectionCard.tsx` - Connect/disconnect buttons

### Checkpoint 1 ✓
```bash
# Verify:
- [ ] User can log in via Auth0
- [ ] User can connect GitHub via Token Vault
- [ ] Token Vault returns access token for connected user
- [ ] Connection status shows in UI
```

---

## PHASE 2: FGA INTEGRATION (Day 2 Morning)
**Duration:** 3-4 hours  
**Goal:** Permission checks before every action

### 2.1 FGA Schema Definition
Create authorization model in Auth0 FGA:

```yaml
# fga-model.yaml
model:
  schema: 1.1

type user

type agent
  relations:
    define can_act_on_behalf_of: [user]

type project
  relations:
    define owner: [user]
    define viewer: [user]
    define member: [user] or owner

type action
  relations:
    define can_execute: [user]
    define requires_approval: [user]
```

### 2.2 FGA Client Implementation
**Files to create:**
- [ ] `src/auth0/fga.ts` - FGA wrapper

```typescript
// Key functions:
export async function checkPermission(
  userId: string,
  action: string,
  resource: string
): Promise<{ allowed: boolean; reason?: string }>

export async function requiresApproval(
  userId: string,
  action: string
): Promise<boolean>

export async function addRelationship(
  user: string,
  relation: string,
  object: string
): Promise<void>
```

### 2.3 Permission Middleware
- [ ] `src/middleware/fga.ts` - Check permissions on routes

```typescript
// Usage:
app.post('/api/agent/execute', 
  requireAuth,
  checkFGA('can_execute', (req) => `action:${req.body.tool}`),
  executeHandler
);
```

### 2.4 FGA Seeding Script
- [ ] `scripts/seed-fga.ts` - Initialize relationships

```typescript
// Default relationships to create:
// - agent:fulcrum can_act_on_behalf_of user:* (template)
// - action:github_merge_pr requires_approval user:*
// - action:github_delete_branch requires_approval user:*
// - action:jira_delete_issue requires_approval user:*
// - action:slack_invite_user requires_approval user:*
```

### Checkpoint 2 ✓
```bash
# Verify:
- [ ] FGA check returns true for allowed actions
- [ ] FGA check returns false for denied actions
- [ ] requiresApproval correctly identifies Level 5 actions
- [ ] Unauthorized requests return 403 with clear message
```

---

## PHASE 3: CIBA INTEGRATION (Day 2 Afternoon)
**Duration:** 4-5 hours  
**Goal:** Human-in-the-loop approval for high-stakes actions

### 3.1 CIBA Client Implementation
**Files to create:**
- [ ] `src/auth0/ciba.ts` - CIBA wrapper

```typescript
// Key functions:
export async function initiateApproval(
  userId: string,
  bindingMessage: string,
  scope: string
): Promise<{ authReqId: string; expiresIn: number }>

export async function checkApprovalStatus(
  authReqId: string
): Promise<'pending' | 'approved' | 'denied' | 'expired'>

export async function getApprovedToken(
  authReqId: string
): Promise<TokenResponse>
```

### 3.2 Pub/Sub for Async CIBA
- [ ] Create Pub/Sub topic: `fulcrum-ciba-events`
- [ ] Create subscription: `fulcrum-ciba-sub`
- [ ] `src/pubsub/ciba-handler.ts` - Process approval events

### 3.3 CIBA Database Tracking
- [ ] Add CIBA request tracking table
- [ ] `src/db/ciba.ts` - CRUD for CIBA requests

### 3.4 CIBA Flow in Agent
```typescript
// Flow:
// 1. Agent wants to execute Level 5 action
// 2. FGA confirms user has permission
// 3. FGA confirms action requires approval
// 4. Agent initiates CIBA request
// 5. Agent enters AWAITING_APPROVAL state
// 6. User approves on phone
// 7. Webhook/poll detects approval
// 8. Agent resumes with fresh token
```

### Checkpoint 3 ✓
```bash
# Verify:
- [ ] CIBA request initiates successfully
- [ ] Push notification received on Auth0 Guardian app
- [ ] Approval status updates correctly
- [ ] Agent state transitions to AWAITING_APPROVAL
- [ ] Agent resumes after approval
- [ ] Agent stops after denial/timeout
```

---

## PHASE 4: LANGGRAPH + GEMINI AGENT (Day 3)
**Duration:** 8-10 hours  
**Goal:** Working agent with state machine and LLM reasoning

### 4.1 LangGraph Setup
```bash
cd apps/api
pnpm add @langchain/langgraph @langchain/google-vertexai @langchain/core
```

### 4.2 State Machine Definition
- [ ] `src/agent/state.ts` - State types and reducers

```typescript
interface FulcrumState {
  sessionId: string;
  userId: string;
  messages: Message[];
  currentState: AgentState;
  pendingTool: ToolCall | null;
  pendingApproval: CIBARequest | null;
  executionHistory: ToolExecution[];
}
```

### 4.3 Graph Definition
- [ ] `src/agent/graph.ts` - LangGraph workflow

```typescript
// Nodes:
// - planNode: Gemini analyzes user intent
// - checkPermissionNode: FGA validation
// - executeNode: Run tool with Token Vault token
// - awaitApprovalNode: CIBA wait
// - respondNode: Generate response

// Edges:
// plan → checkPermission
// checkPermission → execute (if allowed, no approval needed)
// checkPermission → awaitApproval (if approval needed)
// checkPermission → respond (if denied)
// awaitApproval → execute (if approved)
// awaitApproval → respond (if denied/timeout)
// execute → plan (if more work) or respond (if done)
```

### 4.4 Tool Definitions
- [ ] `src/agent/tools/github.ts`
- [ ] `src/agent/tools/jira.ts`
- [ ] `src/agent/tools/slack.ts`

Each tool follows pattern:
```typescript
const githubScanSecrets = {
  name: 'github_scan_secrets',
  description: 'Scan repository for hardcoded secrets',
  riskLevel: 2,
  requiredScopes: ['repo:read'],
  requiresCIBA: false,
  parameters: z.object({
    owner: z.string(),
    repo: z.string()
  }),
  execute: async (params, context) => {
    // 1. Get token from Token Vault
    // 2. Call GitHub API
    // 3. Return results
  }
};
```

### 4.5 Gemini Integration
- [ ] `src/agent/llm.ts` - Vertex AI client
- [ ] `src/agent/prompts.ts` - System prompts

```typescript
const SYSTEM_PROMPT = `
You are the Fulcrum Core, a Zero-Trust AI Security Agent.
You have access to tools for GitHub, Jira, and Slack.
Before using any tool, permissions will be checked automatically.
For high-stakes actions (delete, merge, invite), user approval is required.
...
`;
```

### 4.6 PostgreSQL State Persistence
- [ ] `src/db/schema.ts` - Drizzle ORM schema
- [ ] `src/db/client.ts` - Database client
- [ ] `src/agent/persistence.ts` - Save/load state

### Checkpoint 4 ✓
```bash
# Verify:
- [ ] Agent responds to "Hello"
- [ ] Agent plans tool usage for "Scan my repos"
- [ ] Agent state persists across restarts
- [ ] Tool execution logs to audit trail
- [ ] State machine transitions correctly
```

---

## PHASE 5: TOOLS IMPLEMENTATION (Day 4)
**Duration:** 6-8 hours  
**Goal:** All tools working with Token Vault

### 5.1 GitHub Tools
- [ ] `github_list_repos` - List user repositories
- [ ] `github_scan_secrets` - Find hardcoded secrets (use regex patterns)
- [ ] `github_read_file` - Read file contents
- [ ] `github_create_issue` - Create new issue
- [ ] `github_create_pr` - Create pull request
- [ ] `github_merge_pr` - Merge PR (CIBA required)

```bash
pnpm add @octokit/rest
```

### 5.2 Jira Tools
- [ ] `jira_list_projects` - List accessible projects
- [ ] `jira_search_issues` - JQL search
- [ ] `jira_create_issue` - Create ticket
- [ ] `jira_update_issue` - Update ticket
- [ ] `jira_delete_issue` - Delete ticket (CIBA required)

```bash
pnpm add jira-client
```

### 5.3 Slack Tools
- [ ] `slack_list_channels` - List channels
- [ ] `slack_send_message` - Send message
- [ ] `slack_send_to_security` - Alert security channel
- [ ] `slack_invite_user` - Invite user (CIBA required)

```bash
pnpm add @slack/web-api
```

### 5.4 Secret Detection Logic
- [ ] `src/agent/tools/utils/secret-scanner.ts`

```typescript
const SECRET_PATTERNS = [
  { name: 'AWS Key', regex: /AKIA[0-9A-Z]{16}/ },
  { name: 'GitHub Token', regex: /ghp_[a-zA-Z0-9]{36}/ },
  { name: 'Slack Token', regex: /xox[baprs]-[a-zA-Z0-9-]+/ },
  { name: 'Generic API Key', regex: /[aA][pP][iI][-_]?[kK][eE][yY].*[:=]\s*['"]?[\w-]{20,}/ },
  // Add more patterns
];
```

### Checkpoint 5 ✓
```bash
# Verify:
- [ ] All GitHub tools work with real API
- [ ] Jira tools work with real API
- [ ] Slack tools work with real API
- [ ] Token Vault provides correct tokens
- [ ] CIBA triggers for Level 5 tools
- [ ] Audit log captures all tool executions
```

---

## PHASE 6: FRONTEND UI (Day 5 Morning)
**Duration:** 4-5 hours  
**Goal:** Clean, professional dashboard

### 6.1 Dashboard Layout
- [ ] `app/page.tsx` - Landing page (if not logged in)
- [ ] `app/dashboard/page.tsx` - Main dashboard
- [ ] `app/dashboard/layout.tsx` - Sidebar navigation

### 6.2 Agent Chat Interface
- [ ] `components/AgentChat.tsx` - Chat UI
- [ ] `components/MessageBubble.tsx` - Message display
- [ ] `components/ToolExecution.tsx` - Show tool calls
- [ ] `components/ApprovalBanner.tsx` - Show CIBA waiting state

```bash
pnpm add @radix-ui/react-* tailwindcss class-variance-authority
```

### 6.3 Connections Page
- [ ] `app/connections/page.tsx`
- [ ] `components/ConnectionCard.tsx`
- [ ] Show connected status for GitHub/Jira/Slack

### 6.4 Audit Log Viewer
- [ ] `app/audit/page.tsx`
- [ ] `components/AuditTable.tsx`
- [ ] `components/AuditDetail.tsx` - Expandable details

### 6.5 WebSocket for Real-time Updates
- [ ] `src/websocket/server.ts` - Socket.io server
- [ ] `lib/socket.ts` - Client connection

### Checkpoint 6 ✓
```bash
# Verify:
- [ ] Dashboard loads correctly
- [ ] Chat shows agent responses
- [ ] Tool executions display in chat
- [ ] CIBA waiting state shows clearly
- [ ] Audit log displays correctly
- [ ] Real-time updates work
```

---

## PHASE 7: DEPLOYMENT (Day 5 Afternoon)
**Duration:** 4-5 hours  
**Goal:** Deployed on GCP with public URL

### 7.1 Cloud SQL Setup (Agent Memory)
```bash
# Create smallest instance (cost: ~$10/26 days)
gcloud sql instances create fulcrum-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-size=10GB \
  --storage-type=HDD \
  --activation-policy=ALWAYS \
  --no-backup \
  --maintenance-window-day=SAT \
  --maintenance-window-hour=2

# Create database
gcloud sql databases create fulcrum --instance=fulcrum-db

# Create user
gcloud sql users create fulcrum_user \
  --instance=fulcrum-db \
  --password=$(openssl rand -base64 32)

# Get connection name
gcloud sql instances describe fulcrum-db --format="value(connectionName)"
# Output: fulcrum-hackathon:us-central1:fulcrum-db

# Run migrations
# Connection string for Cloud Run:
# postgresql://fulcrum_user:PASSWORD@/fulcrum?host=/cloudsql/fulcrum-hackathon:us-central1:fulcrum-db
```

**LangGraph PostgresCheckpointer Setup:**
```typescript
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";
import { Pool } from "pg";

const pool = new Pool({
  // Cloud SQL connection
  host: process.env.INSTANCE_UNIX_SOCKET || 'localhost',
  database: 'fulcrum',
  user: 'fulcrum_user',
  password: process.env.DB_PASSWORD,
});

const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL
);

// This creates the checkpoints table automatically
await checkpointer.setup();
```

**Cost Monitoring:**
- [ ] Set CloudSQL auto-sleep for dev (not production)
- [ ] Monitor connection pool size (max 10 connections)
- [ ] Use db-f1-micro tier ($0.40/day = $10/26 days)

### 7.2 Secret Manager
- [ ] Store all environment variables as secrets
- [ ] Grant Cloud Run service account access

### 7.3 Cloud Run Deployment (with Cost Protection)
**API Service:**
```bash
gcloud run deploy fulcrum-api \
  --source apps/api \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --service-account fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com \
  --add-cloudsql-instances fulcrum-hackathon:us-central1:fulcrum-db \
  --set-secrets "AUTH0_CLIENT_SECRET=auth0-client-secret:latest,AUTH0_M2M_SECRET=auth0-m2m-secret:latest,DB_PASSWORD=db-password:latest" \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --cpu 1 \
  --timeout 60s \
  --concurrency 80 \
  --max-instances 1  # 🚨 CRITICAL: Prevent scaling abuse

# Cost optimization flags explained:
# --min-instances 0: Scale to zero when idle (save money)
# --max-instances 1: Never scale beyond 1 (prevent cost bombs)
# --memory 512Mi: Smallest memory tier (cheapest)
# --concurrency 80: Handle 80 requests per instance
```

**Frontend: Deploy to Vercel (Free)**
```bash
cd apps/web

# Install Vercel CLI
npm i -g vercel

# Deploy
vercel deploy --prod

# Add environment variables in Vercel dashboard:
# - AUTH0_SECRET (generate with: openssl rand -base64 32)
# - AUTH0_BASE_URL
# - AUTH0_ISSUER_BASE_URL
# - AUTH0_CLIENT_ID
# - AUTH0_CLIENT_SECRET
# - NEXT_PUBLIC_API_URL (Cloud Run URL)
```

**Cost: $0 for frontend** (Vercel free tier)

### 7.4 Custom Domain (Optional)
- [ ] Map custom domain to Cloud Run
- [ ] Update Auth0 callback URLs

### 7.5 Monitoring Setup
- [ ] Cloud Logging filter for errors
- [ ] Create alert policy for error rate
- [ ] Verify audit logs appear in Cloud Logging

### Checkpoint 7 ✓
```bash
# Verify:
- [ ] API deployed and responding
- [ ] Web deployed and accessible
- [ ] Auth0 login works on production URL
- [ ] Token Vault works on production
- [ ] Database connected and persisting
- [ ] Logs appearing in Cloud Logging
```

---

## PHASE 8: POLISH & DEMO (Day 6)
**Duration:** 6-8 hours  
**Goal:** Demo video, documentation, submission

### 8.1 Demo Scenario Setup
- [ ] Create test repository with planted secrets
- [ ] Create test Jira project
- [ ] Create test Slack channel
- [ ] Prepare "happy path" for demo

### 8.2 Demo Video Recording
**Script:**
```
0:00-0:30 - Problem statement
0:30-1:00 - Show agent has no permissions
1:00-1:45 - Agent scans and finds secret
1:45-2:30 - CIBA approval flow
2:30-3:00 - Audit trail
```

- [ ] Record demo (OBS or similar)
- [ ] Edit video
- [ ] Upload to YouTube (unlisted or public)

### 8.3 Documentation
- [ ] Polish README.md
- [ ] Write SECURITY.md (FGA schema)
- [ ] Write DEPLOYMENT.md (GCP setup)
- [ ] Write API.md (endpoint reference)

### 8.4 Blog Post (Bonus)
- [ ] Write 500+ word blog post in submission text
- [ ] Title: "Solving the AI Agent Blast Radius Problem"
- [ ] Cover: Problem → Solution → How Token Vault + FGA + CIBA work

### 8.5 Final Testing
- [ ] Full flow works on production
- [ ] CIBA approval works
- [ ] Audit trail complete
- [ ] No console errors
- [ ] No broken links

### 8.6 Submission
- [ ] Devpost submission with:
  - [ ] Text description
  - [ ] Video URL
  - [ ] GitHub repo URL
  - [ ] Live demo URL
  - [ ] Blog post (in text description)

### Checkpoint 8 ✓
```bash
# Final verification:
- [ ] Video is under 3 minutes
- [ ] Video shows Token Vault usage
- [ ] Video shows CIBA approval
- [ ] GitHub repo is public
- [ ] README has setup instructions
- [ ] Live demo works
- [ ] Submission complete before deadline
```

---

## DEPENDENCIES GRAPH

```
Phase 0 (Foundation)
    ↓
Phase 1 (Auth0 Core) ←── Depends on Auth0 dashboard setup
    ↓
Phase 2 (FGA) ←── Depends on Auth0 M2M credentials
    ↓
Phase 3 (CIBA) ←── Depends on Auth0 Guardian setup
    ↓
Phase 4 (LangGraph) ←── Depends on Vertex AI API enabled
    ↓
Phase 5 (Tools) ←── Depends on OAuth connections in Token Vault
    ↓
Phase 6 (Frontend) ←── Can parallelize with Phase 5
    ↓
Phase 7 (Deployment) ←── Depends on all above working locally
    ↓
Phase 8 (Demo) ←── Depends on production deployment
```

---

## ESTIMATED TIMELINE

| Day | Date | Phases | Hours |
|-----|------|--------|-------|
| 1 | Apr 1 | 0 + 1 | 8h |
| 2 | Apr 2 | 2 + 3 | 8h |
| 3 | Apr 3 | 4 | 8h |
| 4 | Apr 4 | 5 | 8h |
| 5 | Apr 5 | 6 + 7 | 8h |
| 6 | Apr 6 | 8 | 8h |
| 7 | Apr 7 | Buffer + Submit | 4h |

**Total:** ~52 hours over 6-7 days

---

## RISK MITIGATION

### Risk: Auth0 Token Vault setup issues
**Mitigation:** Start with Token Vault on Day 1. If blocked, contact Auth0 support immediately.

### Risk: CIBA not working
**Mitigation:** Have backup manual approval endpoint. Worst case, show the flow with manual button.

### Risk: Gemini API limits
**Mitigation:** Use caching for repeated queries. Have fallback prompts ready.

### Risk: GCP deployment fails
**Mitigation:** Test deployment on Day 4. Have Railway/Vercel as backup platforms.

### Risk: Demo scenario breaks
**Mitigation:** Have pre-recorded backup demo. Test demo flow multiple times on Day 6.

---

## SUCCESS CRITERIA

### Minimum Viable Submission ✓
- [ ] Login with Auth0
- [ ] Connect GitHub via Token Vault
- [ ] Agent can scan repos (read-only)
- [ ] FGA check visible in logs
- [ ] Basic audit trail

### Target Submission ✓✓
- [ ] All above, plus:
- [ ] CIBA approval for merge/delete
- [ ] Jira integration
- [ ] Professional UI
- [ ] Video demo
- [ ] Blog post

### Winning Submission ✓✓✓
- [ ] All above, plus:
- [ ] Slack integration
- [ ] Real-time WebSocket updates
- [ ] State persistence across sessions
- [ ] Comprehensive audit trail with trace IDs
- [ ] Security documentation
- [ ] Performance benchmarks
