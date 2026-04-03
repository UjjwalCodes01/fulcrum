# Project Fulcrum - Progress Report

**Last Updated:** April 3, 2026 (12:50 PM)  
**Hackathon Deadline:** April 7, 2026 (4 days remaining)

---

## 👥 Team Division

| Person | Responsibilities |
|--------|------------------|
| **Rudra** | GCP integration, deployment, infrastructure |
| **Ujjwal** | Phase 3+ (FGA, CIBA, Agent, Tools) |

---

## 📊 Overall Status: Phase 4 FULLY COMPLETE ✅

| Phase | Name | Status | Owner |
|-------|------|--------|-------|
| 0 | Foundation & Scaffold | ✅ Done | - |
| 1 | Auth0 Login | ✅ Done | - |
| 2 | Token Vault | ✅ **FIXED** | Ujjwal |
| 3 | FGA (Fine-Grained Auth) | ✅ **COMPLETE** | Ujjwal |
| 4 | CIBA (Human-in-the-Loop) | ✅ **COMPLETE** | Ujjwal |
| 5 | LangGraph + Gemini Agent | ⏳ Pending | Ujjwal |
| 6 | Tool Implementations | ⏳ Pending | Ujjwal |
| 7 | Frontend UI | ⏳ Pending | Ujjwal |
| 8 | GCP Deployment | ⏳ Pending | Rudra |
| 9 | Demo Video | ⏳ Pending | Both |

---

## ✅ PHASE 4: CIBA COMPLETE (April 3, 2026)

### What's CIBA?
**Client Initiated Backchannel Authentication** - Auth0's human-in-the-loop approval.
**Before the agent executes ANY Level 5 action, the user must approve via push notification.**

### 🎯 What Was Implemented

#### 1. CIBA Database (`apps/api/src/db/ciba.ts`)
- ✅ In-memory store for CIBA requests (hackathon mode - easily upgradeable to PostgreSQL)
- ✅ Full CRUD operations: create, get, update, delete
- ✅ Indexes by ID and Auth0's auth_req_id for fast lookup
- ✅ User pending index for listing pending approvals
- ✅ Automatic expiration handling
- ✅ Status tracking: pending → approved/denied/expired/cancelled

#### 2. CIBA Service (`apps/api/src/services/ciba.ts`)
- ✅ `initiateCIBA()` - Start backchannel auth request with Auth0
- ✅ `pollCIBAStatus()` - Check approval status via Auth0 token endpoint
- ✅ `getCIBARequestById()` - Fetch request by internal ID
- ✅ `getUserPendingRequests()` - List user's pending approvals
- ✅ `manuallyApprove()` / `manuallyDeny()` - Dev mode manual approval
- ✅ `cancelRequest()` - Cancel pending request
- ✅ `generateBindingMessage()` - User-friendly approval text
- ✅ `isCIBAConfigured()` / `getCIBAStatus()` - Check configuration

#### 3. CIBA Pub/Sub Handler (`apps/api/src/pubsub/ciba-handler.ts`)
- ✅ Event bus for CIBA status changes (in-memory for hackathon)
- ✅ Session listeners for real-time notifications
- ✅ `pollPendingRequests()` - Background polling for status updates
- ✅ `startCIBAPolling()` / `stopCIBAPolling()` - Control background polling
- ✅ `handleAuth0Webhook()` - Process Auth0 CIBA webhook notifications
- ✅ `getCIBAStats()` - Statistics for monitoring

#### 4. Agent Routes Updated (`apps/api/src/routes/agent.ts`)
- ✅ `POST /api/agent/execute/:tool` - NOW FULLY WIRED with CIBA
  - Level 5 actions call `initiateCIBA()` and return 202 with CIBA details
  - Returns `requestId`, `authReqId`, `expiresIn`, `pollInterval`
  - Includes instructions for polling and manual approve (dev mode)
- ✅ `GET /api/agent/ciba/:requestId` - Get CIBA request status (polls Auth0)
- ✅ `GET /api/agent/approvals` - List pending approvals for current user
- ✅ `POST /api/agent/approve` - Manually approve (dev mode)
- ✅ `POST /api/agent/deny` - Manually deny (dev mode)
- ✅ `POST /api/agent/cancel` - Cancel pending request

#### 5. CIBA Routes (`apps/api/src/routes/ciba.ts`)
- ✅ `GET /api/ciba/status` - CIBA service status and statistics
- ✅ `POST /api/ciba/webhook` - Auth0 CIBA webhook endpoint
- ✅ `POST /api/ciba/poll` - Manual polling trigger (dev mode)
- ✅ `POST /api/ciba/polling/start` - Start background polling
- ✅ `POST /api/ciba/polling/stop` - Stop background polling

#### 6. Frontend ApprovalBanner (`apps/web/app/components/ApprovalBanner.tsx`)
- ✅ `ApprovalBanner` - Single request approval UI component
  - Auto-polls for status updates
  - Shows time remaining until expiration
  - Manual approve/deny buttons (dev mode)
  - Color-coded status (pending=amber, approved=green, denied=red)
- ✅ `PendingApprovalsList` - List all pending approvals
  - Auto-refreshes every 5 seconds
  - Click to select and view individual request

#### 7. Server Integration (`apps/api/src/index.ts`)
- ✅ CIBA router registered at `/api/ciba`
- ✅ Background polling auto-starts on server launch (configurable)
- ✅ Environment variable: `CIBA_POLLING_ENABLED`, `CIBA_POLL_INTERVAL_MS`

#### 8. Tests (`apps/api/src/__tests__/ciba.test.ts`)
- ✅ 16 CIBA tests covering:
  - Database operations (create, get, approve, deny, expire, cancel)
  - Status transitions
  - Statistics
  - Binding message generation
  - Security rules (unique IDs, valid transitions)

### How CIBA Works Now
```
User triggers Level 5 action (e.g., github_merge_pr)
  ↓
POST /api/agent/execute/github_merge_pr
  ↓
FGA check passes (user has github_merge_pr permission)
  ↓
requiresApproval('github_merge_pr') → true (Level 5)
  ↓
initiateCIBA() called
  ↓
Auth0 /bc-authorize endpoint called
  ↓
CIBA request stored in database
  ↓
202 "AWAITING_APPROVAL" returned with:
  - requestId: "abc123"
  - authReqId: "auth0-xyz"
  - expiresIn: 300
  - bindingMessage: "Fulcrum wants to merge a pull request"
  ↓
User receives push notification on device
  ↓
User approves/denies with biometric auth
  ↓
Backend polls Auth0 (or receives webhook)
  ↓
GET /api/agent/ciba/abc123 returns:
  - status: "approved" or "denied"
  ↓
If approved → execute the tool
If denied/expired → block execution
```

### Environment Variables for CIBA
```bash
# Auth0 CIBA (optional - dev mode works without these)
AUTH0_CIBA_CLIENT_ID=xxx
AUTH0_CIBA_CLIENT_SECRET=xxx

# Polling configuration
CIBA_POLLING_ENABLED=true
CIBA_POLL_INTERVAL_MS=5000
CIBA_TIMEOUT_SECONDS=300
```

### Test CIBA Endpoints
```bash
# Check CIBA status
curl http://localhost:3001/api/ciba/status

# Execute Level 5 tool (triggers CIBA)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sessionId":"test","repo":"owner/name","prNumber":42}' \
  http://localhost:3001/api/agent/execute/github_merge_pr

# Check CIBA request status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/agent/ciba/<requestId>

# List pending approvals
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/agent/approvals

# Manually approve (dev mode)
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"requestId":"<requestId>"}' \
  http://localhost:3001/api/agent/approve
```

### ⚠️ Implementation Details

**PostgreSQL Persistence (Production-Ready):**
- ✅ CIBA requests stored in PostgreSQL table `ciba_requests`
- ✅ Automatic schema initialization on server start
- ✅ Survives server restart/redeploy
- ✅ Multi-instance safe (shared database)
- ✅ Automatic fallback to in-memory if DB not configured

**Storage Mode Selection:**
```typescript
// Automatically detected based on DATABASE_URL
if (DATABASE_URL is set && connection succeeds) {
  mode = 'postgres' // ✅ Production safe
} else {
  mode = 'memory'   // ⚠️ Development only
  if (CIBA_STRICT_MODE === 'true') {
    logger.error('FATAL: strict mode requires database')
    process.exit(1)
  }
}
```

### Security Guarantees

| Mode | Manual Approve/Deny | Webhook Verification | Data Persistence | Multi-Instance |
|------|---------------------|---------------------|------------------|----------------|
| **Development** (CIBA_STRICT_MODE=false) | ✅ Allowed | ⚠️ Optional | ❌ Lost on restart | ❌ Single instance |
| **Production** (CIBA_STRICT_MODE=true) | ❌ Blocked (403) | ✅ Required | ✅ PostgreSQL | ✅ Multi-instance |

### Database Schema
```sql
CREATE TABLE ciba_requests (
  id VARCHAR(255) PRIMARY KEY,
  user_id VARCHAR(255) NOT NULL,
  tool VARCHAR(100) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  auth_req_id VARCHAR(255) UNIQUE NOT NULL,
  session_id VARCHAR(255) NOT NULL,
  binding_message TEXT NOT NULL,
  tool_input JSONB,
  expires_at TIMESTAMP NOT NULL,
  approved_at TIMESTAMP,
  denied_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_ciba_user_status ON ciba_requests(user_id, status);
CREATE INDEX idx_ciba_auth_req ON ciba_requests(auth_req_id);
CREATE INDEX idx_ciba_expires ON ciba_requests(expires_at) WHERE status = 'pending';
```

### Production Environment Variables
```bash
# Database (PostgreSQL)
DATABASE_URL=postgresql://user:pass@host:5432/fulcrum
# OR individual vars:
DB_HOST=localhost
DB_PORT=5432
DB_NAME=fulcrum
DB_USER=postgres
DB_PASSWORD=password

# CRITICAL: Enable strict mode in production
CIBA_STRICT_MODE=true

# Required for webhook verification in strict mode
CIBA_WEBHOOK_SECRET=your-auth0-webhook-secret

# Optional tuning
CIBA_TIMEOUT_SECONDS=300
CIBA_POLL_INTERVAL_MS=5000
```

---

## ✅ PHASE 3: FGA COMPLETE (April 2, 2026)

### What's FGA?
**Fine-Grained Authorization** - Auth0's relationship-based access control.
**Before the agent executes ANY tool, it must prove permission via FGA.**

### 🎯 What Was Implemented

#### 1. Core FGA Service (`apps/api/src/services/fga.ts`)
- ✅ `checkPermission(userId, action)` - Core permission check (FIXED: uses correct tuple format)
- ✅ `requiresApproval(action)` - Check if CIBA needed (Level 5)
- ✅ `grantConnectionPermissions(userId, connection)` - Auto-grant on connect
- ✅ `revokeConnectionPermissions(userId, connection)` - Auto-revoke on disconnect
- ✅ Permission caching (1 min TTL) for performance
- ✅ **30 tools defined** with risk levels 1-5 (including agent_interact, agent_approve, agent_deny)
- ✅ **FGA_STRICT_MODE** - deny by default in production, allow in dev

#### 2. FGA Middleware (`apps/api/src/middleware/fga.ts`)
- ✅ `checkFGAPermission(action)` - Static action check
- ✅ `checkFGADynamic(getAction)` - Dynamic action from request
- ✅ `requireCIBAApproval` - Block Level 5 without approval
- ✅ `verifyPermission(userId, action)` - Inline check helper
- ✅ `FGARequest` type export for type safety

#### 3. Agent Routes Protected (`apps/api/src/routes/agent.ts`)
- ✅ `POST /api/agent/message` - Protected with `agent_interact` permission
- ✅ `POST /api/agent/approve` - Protected with `agent_approve` permission
- ✅ `POST /api/agent/deny` - Protected with `agent_deny` permission
- ✅ `POST /api/agent/execute/:tool` - Dynamic FGA check per tool + CIBA check for Level 5

#### 4. Connection Lifecycle Integration (`apps/api/src/routes/connections.ts`)
- ✅ GitHub token exchange → auto-grants FGA permissions
- ✅ Slack token exchange → auto-grants FGA permissions  
- ✅ Jira token exchange → auto-grants FGA permissions
- ✅ Disconnect endpoint → auto-revokes FGA permissions

#### 5. FGA API Endpoints (`apps/api/src/routes/fga.ts`)
- ✅ `GET /api/fga/status` - FGA config status (public)
- ✅ `GET /api/fga/tools` - List all tools & risk levels (public)
- ✅ `GET /api/fga/check?action=X` - Check permission (auth required)
- ✅ `POST /api/fga/check-batch` - Batch check (auth required)
- ✅ `POST /api/fga/grant-connection` - Manual grant (auth required)
- ✅ `POST /api/fga/revoke-connection` - Manual revoke (auth required)
- ✅ `POST /api/fga/clear-cache` - Clear permission cache (auth required)

#### 6. FGA Model (`apps/api/fga/model.fga`)
- ✅ Complete model definition with types: user, agent, action, connection, resource, session
- ✅ Relationships defined: can_execute, requires_approval, can_act_on_behalf_of
- ✅ Ready to upload to https://dashboard.fga.dev/

#### 7. TypeScript Build Fixed
- ✅ All API files compile without errors
- ✅ All Web files compile without errors
- ✅ Type-safe FGARequest interface
- ✅ Router type annotations (IRouter) throughout

### Risk Levels & CIBA
| Level | Type | Examples | CIBA Required? |
|-------|------|----------|----------------|
| 1 | READ | github_list_repos, jira_get_issue, agent_interact | No |
| 2 | SEARCH | github_scan_secrets, slack_search_messages, agent_approve | No |
| 3 | CREATE | github_create_issue, slack_send_message | No |
| 4 | UPDATE | github_create_pr, jira_update_issue | No |
| 5 | DELETE | github_merge_pr, github_delete_branch, jira_delete_issue | **YES** |

### How It Works Now
```
User connects GitHub
  ↓
Connection succeeds
  ↓
grantConnectionPermissions() called
  ↓
FGA tuples written: user can_execute action:github_*
  ↓
Agent receives message
  ↓
checkFGAPermission('agent_interact') → allowed ✅
  ↓
Agent wants to run github_list_repos
  ↓
checkPermission(userId, 'github_list_repos') → allowed ✅
  ↓
Tool executes
  ↓
Agent wants to run github_merge_pr (Level 5)
  ↓
checkPermission → allowed ✅
requiresApproval → true ⚠️
  ↓
Return 202 "AWAITING_APPROVAL" → CIBA flow triggers
```

### FGA Strict Mode
```bash
# Development (permissive - allows if FGA not configured)
FGA_STRICT_MODE=false

# Production (strict - denies if FGA not configured)
FGA_STRICT_MODE=true
```

### Test Endpoints
```bash
# Check FGA status
curl http://localhost:3001/api/fga/status

# List all 30 tools
curl http://localhost:3001/api/fga/tools

# Check permission (needs JWT)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/fga/check?action=github_list_repos"

# Grant connection permissions manually
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connection":"github"}' \
  http://localhost:3001/api/fga/grant-connection
```

### 🔧 Key Fixes Applied
1. **Tuple Format Fixed**: Was using `${action}:${resource}`, now correctly uses `action:${action}` to match model.fga
2. **Strict Mode Added**: Production denies by default, development allows (controllable via env)
3. **Agent Routes Protected**: All agent endpoints now enforce FGA checks
4. **Connection Lifecycle**: Grant/revoke automatically called on connect/disconnect
5. **TypeScript Errors Fixed**: All 11 build errors resolved
   - Web: Fixed unused imports, type annotations, SSR window access
   - API: Fixed Router types, unused parameters, function signatures

---

## ✅ TOKEN VAULT FIX (April 2, 2026)

### The Problem
The original implementation required **refresh tokens** from GitHub OAuth. However, GitHub Apps don't reliably issue refresh tokens, blocking the Token Vault flow.

### The Solution
Implemented **ACCESS TOKEN exchange** as a fallback:
- Auth0's Token Vault supports BOTH refresh token and access token exchange
- The access token exchange uses `subject_token_type: 'urn:ietf:params:oauth:token-type:access_token'`
- This bypasses the refresh token requirement completely

### Changes Made
1. **`apps/api/src/services/token-vault.ts`**
   - Already had `exchangeAccessTokenForFederatedToken()` function
   - Fixed TypeScript type issues (Auth0ErrorResponse, URLSearchParams)

2. **`apps/api/src/routes/connections.ts`**
   - All token endpoints (GitHub, Slack, Jira) now support BOTH modes:
     - Mode 1: If `refreshToken` in body → use refresh token exchange
     - Mode 2: If only access token in Authorization header → use access token exchange
   - Returns `exchangeMethod` in response to show which flow was used

3. **`apps/web/app/api/test-vault/route.ts`**
   - Updated to use access token exchange flow
   - Better error handling and debug info

### How to Test
```bash
# 1. Start both servers
cd apps/api && pnpm dev    # Terminal 1
cd apps/web && pnpm dev    # Terminal 2

# 2. Login via GitHub at http://localhost:3000

# 3. Test Token Vault at http://localhost:3000/api/test-vault
# Should return repos if successful!
```

---

## 🔐 Auth0 Configuration

### Applications
| Name | Client ID | Purpose |
|------|-----------|---------|
| Fulcrum | (see .env) | Main web app |
| Fulcrum API Client | (see .env) | Token Vault exchange |

### APIs
| Name | Identifier | Purpose |
|------|------------|---------|
| Fulcrum API | `https://fulcrum-api` | Backend API |

### GitHub App
| Setting | Value |
|---------|-------|
| Name | Fulcrum Security Agent |
| Client ID | (see .env) |
| Expire tokens | ✅ Enabled |
| URL | https://github.com/apps/fulcrum-security-agent |

### GitHub Connection in Auth0
| Setting | Value |
|---------|-------|
| Client ID | (same as GitHub App - see .env) |
| Purpose | Authentication and Connected Accounts for Token Vault |
| Token Vault | ✅ Enabled |

---

## 📁 Key Files

### Backend (`apps/api/`)
| File | Purpose |
|------|---------|
| `src/index.ts` | Express server entry |
| `src/routes/connections.ts` | Token Vault exchange (HAS WORKAROUND CODE) |
| `src/services/token-vault.ts` | Token exchange logic |
| `src/middleware/auth.ts` | JWT validation |
| `.env` | Credentials (NOT committed) |

### Frontend (`apps/web/`)
| File | Purpose |
|------|---------|
| `app/page.tsx` | Landing page |
| `app/dashboard/page.tsx` | Main dashboard |
| `app/connections/page.tsx` | Service connections UI |
| `app/api/auth/[auth0]/route.ts` | Auth0 route handler |
| `app/api/test-vault/route.ts` | Token Vault test endpoint |

---

## 🎯 Next Steps

### For Rudra (Token Vault + GCP)
1. Fix Token Vault issue using one of the options above
2. Set up GCP Cloud Run
3. Set up Cloud SQL
4. Deploy backend to Cloud Run
5. Test production Token Vault flow

### For Ujjwal (Phase 3+)
1. **Phase 3: FGA Setup**
   - Create FGA store in Auth0
   - Define permission model (user → project → agent)
   - Implement FGA checks in `apps/api/src/middleware/`
   - Test permission checks

2. **Phase 4: CIBA**
   - Enable CIBA on Auth0 tenant
   - Create approval flow for dangerous actions
   - Test push notification approval

3. **Phase 5: Agent**
   - Set up Vertex AI (Gemini 2.5 Pro)
   - Implement LangGraph state machine
   - Create agent orchestration in `apps/api/src/services/agent/`

4. **Phase 6: Tools**
   - GitHub tool (audit repos, find secrets)
   - Slack tool (send alerts)
   - Jira tool (create tickets)

---

## 💰 Budget Status

| Service | Estimated Cost | Status |
|---------|---------------|--------|
| Vertex AI (Gemini) | ~$20 | Not started |
| Cloud Run | ~$5 | Not started |
| Cloud SQL | ~$10 | Not started |
| Vercel (Frontend) | Free | Not started |
| Auth0 | Free tier | Active |
| **Total** | ~$35-42 | Under $50 budget ✅ |

---

## 🚀 To Run Locally

```bash
# Terminal 1 - API
cd apps/api
pnpm dev

# Terminal 2 - Web
cd apps/web
pnpm dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001
- Test Token Vault: http://localhost:3000/api/test-vault

---

## 📝 For Ujjwal - Getting Started

1. Clone the repo
2. Run `pnpm install`
3. Create `.env` files (ask Rudra for credentials or check Discord)
4. Run `pnpm dev`
5. Read `implementation.md` for full phase breakdown
6. Start with Phase 3 (FGA) - code goes in `apps/api/src/`

Key docs to read:
- `hackathon.md` - What judges are looking for
- `implementation.md` - Detailed phase breakdown
- `claude.md` - Project context for AI assistants
- Auth0 FGA docs: https://docs.fga.dev/
