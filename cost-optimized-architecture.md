# Project Fulcrum - GCP Cost-Optimized Architecture

> Stay within GCP, use cheaper alternatives. Target: **$35-45 for 26 days** (under $50 budget)

---

## ARCHITECTURE (GCP-First + Vercel Frontend)

### Strategy
- ✅ Keep: GCP for backend, Auth0, Gemini
- ✅ Optimize: Use cheaper GCP services where possible
- ✅ Frontend: Vercel (better DX, free tier, faster deploys)

### ✅ FINAL STACK (Quality + Budget)

| Component | Solution | Cost/26 Days | Why This Choice |
|-----------|----------|--------------|-----------------|
| **Frontend** | Vercel | **FREE** | Best Next.js experience |
| **Backend API** | GCP Cloud Run | **$8-12** | Serverless, scale-to-zero |
| **Agent Memory** | **Cloud SQL** (PostgreSQL) | **$10** | LangGraph state persistence (stateful agent) |
| **AI Model** | **Vertex AI** (Gemini 2.0 Pro) | **$20-25** | Premium quality, full feature support |
| **Pub/Sub** | GCP Pub/Sub | **$0.50** | CIBA events |
| **Secret Manager** | GCP Secret Manager | **$0.10** | Auth0 credentials |
| **Cloud Logging** | GCP Cloud Logging | **FREE** | Audit trail, 50GB free |
| **Cloud Storage** | GCP Cloud Storage | **FREE** | Assets, 5GB free |

---

## DETAILED COST BREAKDOWN (26 Days)

### GCP Services

| Service | Tier/Usage | Cost/Day | 26-Day Total |
|---------|-----------|----------|--------------|
| **Cloud Run (API)** | 1 instance, scale-to-zero, 512MB | $0.30 | **$8** |
| **Cloud SQL** | db-f1-micro (smallest), 10GB storage | $0.40 | **$10** |
| **Vertex AI (Gemini 2.0 Pro)** | 1M input tokens, 500K output tokens | $0.90 | **$23** |
| **Pub/Sub** | 2K messages/day (CIBA events) | $0.02 | **$0.50** |
| **Secret Manager** | 10 secrets, 100 accesses/day | $0.004 | **$0.10** |
| **Cloud Logging** | 1GB/day (free tier) | $0 | **$0** ✅ |
| **Cloud Storage** | <1GB (free tier) | $0 | **$0** ✅ |
| **Cloud Build** | 10 builds (free tier) | $0 | **$0** ✅ |

### External Services
| Service | Usage | Cost |
|---------|-------|------|
| **Vercel (Frontend)** | Free tier | **$0** ✅ |
| **Auth0** | Free tier (7,000 MAU) | **$0** ✅ |

### **TOTAL: ~$41.50** 🎯
### **Budget: $50** ✅ **$8.50 buffer**

---

## AGENT MEMORY: HOW IT WORKS

### The Problem
Agent needs to remember:
- Current state (IDLE, PLANNING, EXECUTING, AWAITING_APPROVAL, etc.)
- Execution history (what tools were called)
- Messages from user
- Pending approvals (CIBA requests)
- Session persistence (if server restarts, agent remembers where it was)

### The Solution: LangGraph + Cloud SQL

```typescript
// LangGraph State
interface FulcrumState {
  sessionId: string;
  userId: string;
  messages: BaseMessage[];      // Chat history
  currentState: AgentState;     // IDLE, PLANNING, EXECUTING, etc.
  pendingTool: ToolCall | null;
  pendingApproval: CIBARequest | null;
  executionHistory: ToolExecution[];
  metadata: Record<string, any>;
}

// Persisted to Cloud SQL via PostgresCheckpointer
// This is the "memory" of the agent
```

### LangGraph Checkpointer Options

| Option | Storage | Use Case | Cost |
|--------|---------|----------|------|
| **MemorySaver** | In-memory | Dev/testing only | Free |
| **PostgresCheckpointer** | Cloud SQL | Production ✅ | $10/26 days |
| **SqliteSaver** | SQLite file | Single machine | Free (but limited) |

### Why Cloud SQL for Agent Memory?

```typescript
// WITHOUT persistent memory (MemorySaver):
User: "Scan my repos"
Agent: Planning...
[Server restarts]
Agent: "What were we doing again?" ❌ Lost state!

// WITH Cloud SQL persistence (PostgresCheckpointer):
User: "Scan my repos"
Agent: Planning...
[Server restarts]
Agent: "I was scanning your repos. Let me continue..." ✅ Remembers!
```

### What Gets Persisted in Cloud SQL?

```sql
-- LangGraph checkpoints table (auto-created)
CREATE TABLE checkpoints (
  thread_id VARCHAR(255),
  checkpoint_ns VARCHAR(255),
  checkpoint_id VARCHAR(255),
  parent_checkpoint_id VARCHAR(255),
  checkpoint JSONB,  -- The full state
  metadata JSONB,
  created_at TIMESTAMP
);

-- Example checkpoint (the agent's memory):
{
  "sessionId": "sess_123",
  "userId": "user_456",
  "currentState": "EXECUTING",
  "messages": [
    {"role": "user", "content": "Scan my repos"},
    {"role": "assistant", "content": "I'll scan your repositories..."}
  ],
  "executionHistory": [
    {
      "tool": "github_list_repos",
      "status": "completed",
      "result": {"repos": [...]}
    }
  ],
  "pendingApproval": null
}
```

---

## GEMINI OPTIMIZATION STRATEGY

### Problem: $52 is Too Much
- Original estimate: 500 requests/day × 26 days = 13,000 requests 😱
- That's overestimated by 100x!

### Solution 1: Use Gemini API (Not Vertex AI)
**Vertex AI** = Enterprise pricing with infrastructure overhead  
**Gemini API** = Direct API, pay-per-token only (10x cheaper)

```
Same Gemini 2.0 Pro model
Same features
Same response quality
Just different billing method
```

### Solution 2: Use Gemini Smartly (100-200 requests total)
**Key insight:** Agent doesn't need to call Gemini for EVERY message.

```typescript
// WRONG (Expensive)
app.post('/agent/message', async (req) => {
  const response = await gemini.generateContent(req.body.message);
  // Every user message = 1 Gemini call = $$
});

// RIGHT (Cheap)
app.post('/agent/message', async (req) => {
  // 1. Is this a simple query? Use pattern matching
  if (isSimpleQuery(req.body.message)) {
    return handleSimpleQuery(); // No Gemini call
  }
  
  // 2. Is this a tool execution? No Gemini needed
  if (isToolCall(req.body.message)) {
    return executeTool(); // No Gemini call
  }
  
  // 3. Only call Gemini for planning/reasoning
  if (needsPlanning(req.body.message)) {
    const response = await gemini.generateContent(req.body.message);
    // Cache the plan for follow-up questions
  }
});
```

### When to Call Gemini (Limited)
| Scenario | Need Gemini? | Alternative |
|----------|--------------|-------------|
| User: "Hello" | ❌ No | Canned response |
| User: "Scan my repos" | ❌ No | Pattern match → call tool |
| User: "What did you find?" | ❌ No | Return cached results |
| User: "Find security issues in my workspace" | ✅ Yes | Complex intent → needs planning |
| User: "Approve the fix" | ❌ No | Direct CIBA trigger |
| Agent planning multi-step flow | ✅ Yes | Needs reasoning |

### Estimated Gemini Usage (Realistic)
```
Demo: 5-10 planning calls
Testing: 20-30 calls
Development: 50-70 calls
Total: ~100 calls max

Cost with Gemini API (not Vertex AI):
- Gemini 2.5 Pro: $0.00007 per 1K input tokens, $0.00035 per 1K output
- Average call: 500 input + 200 output = $0.000105
- 100 calls = ~$0.01 (basically free)

Wait, that's too cheap. Let me recalculate with longer context:
- 10K input tokens (full context) + 1K output
- 10K × 0.00007 + 1K × 0.00035 = $0.0007 + $0.00035 = $0.001 per call
- 100 calls = $0.10 😱 TEN CENTS!

Even with 500 calls = $0.50
```

**You were overestimating by 100x!**

---

## REVISED GCP ARCHITECTURE

### What We Use (All GCP)
- ✅ **Cloud Run** - Backend API (serverless, scale-to-zero)
- ✅ **Firestore** - Database (NoSQL, generous free tier)
- ✅ **Gemini API** - AI (not Vertex AI - 10x cheaper)
- ✅ **Pub/Sub** - CIBA events (low volume)
- ✅ **Secret Manager** - Store Auth0 credentials
- ✅ **Cloud Logging** - Audit trail (free tier)
- ✅ **Cloud Storage** - Assets if needed (free tier)

### What We DON'T Use (Too Expensive)
- ❌ **Cloud SQL** - Replaced with Firestore ($21 → $0)
- ❌ **Vertex AI** - Replaced with Gemini API Direct ($52 → $5)
- ❌ **GKE** - Overkill, Cloud Run is simpler
- ❌ **Cloud Functions** - Cloud Run is better for this use case

### Gemini API vs Vertex AI (Both Google!)

| Method | Cost Structure | 26-Day Cost | Best For |
|--------|---------------|-------------|----------|
| **Vertex AI** | Enterprise pricing + infrastructure | $52 | Production at scale |
| **Gemini API Direct** | Pay-per-token only | $5 | Hackathons, prototypes ✅ |

**Setup:**
```bash
# Option 1: Google AI Studio (Easiest)
# Go to https://aistudio.google.com/app/apikey
# Get API key, use directly

# Option 2: GCP Project with Gemini API
gcloud services enable generativelanguage.googleapis.com
# Then create API key in GCP Console
```

Both use the same Gemini 2.0 Pro model, just different billing!

---

## GCP DEPLOYMENT PLAN

### 1. Frontend (Vercel)
**Why not Cloud Run for frontend?**
- Vercel is optimized for Next.js (faster builds)
- Free tier is more generous
- Better DX (developer experience)
- Automatic edge caching

```bash
cd apps/web
vercel deploy
```

**Cost: $0**

### 2. Backend API (GCP Cloud Run)
```bash
# Build and deploy
gcloud run deploy fulcrum-api \
  --source apps/api \
  --region us-central1 \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 1 \
  --memory 512Mi \
  --timeout 60s

# Cost optimization flags:
# --min-instances 0  → Scale to zero when idle
# --max-instances 1  → Prevent scaling (save money)
# --memory 512Mi     → Smallest memory (cheapest)
```

**Cost: ~$8-12/26 days**

### 3. Database (Firestore)
```bash
# Enable Firestore
gcloud firestore databases create \
  --location=us-central1 \
  --type=firestore-native

# No ongoing charges within free tier!
```

**Cost: $0** (within free tier)

### 4. Firestore Setup (Code)
```typescript
// Initialize Firestore
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const app = initializeApp();
const db = getFirestore(app);

// Collections:
// - sessions
// - tool_executions
// - audit_log
// - ciba_requests
```

### 5. Pub/Sub (CIBA Events)
```bash
# Create topic
gcloud pubsub topics create fulcrum-ciba-events

# Create subscription
gcloud pubsub subscriptions create fulcrum-ciba-sub \
  --topic=fulcrum-ciba-events \
  --ack-deadline=60
```

**Cost: ~$0.50/26 days** (low volume)

### 6. Secret Manager
```bash
# Store all sensitive env vars
echo -n "YOUR_SECRET" | gcloud secrets create auth0-client-secret --data-file=-

# Grant Cloud Run access
gcloud secrets add-iam-policy-binding auth0-client-secret \
  --member="serviceAccount:PROJECT_ID-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

**Cost: ~$0.10/26 days**

---

## ENVIRONMENT SETUP (GCP + Vercel)

### What You Need:
1. **GCP Project** - Create `fulcrum-hackathon`
2. **Gemini API Key** - From GCP or AI Studio
3. **Auth0 credentials** - You have
4. **Vercel account** - For frontend

### GCP Project Setup:
```bash
# Create project
gcloud projects create fulcrum-hackathon
gcloud config set project fulcrum-hackathon

# Enable billing (REQUIRED)
gcloud billing projects link fulcrum-hackathon --billing-account=ACCOUNT_ID

# Enable APIs
gcloud services enable \
  run.googleapis.com \
  firestore.googleapis.com \
  generativelanguage.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com
```

### Environment Variables:
```bash
# ================================
# AUTH0 (Same as before)
# ================================
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=xxxxx
AUTH0_CLIENT_SECRET=xxxxx
AUTH0_M2M_CLIENT_ID=xxxxx
AUTH0_M2M_CLIENT_SECRET=xxxxx
AUTH0_FGA_STORE_ID=xxxxx
AUTH0_FGA_MODEL_ID=xxxxx

# ================================
# GEMINI API
# ================================
GEMINI_API_KEY=xxxxx  # From aistudio.google.com OR GCP

# ================================
# GCP
# ================================
GCP_PROJECT_ID=fulcrum-hackathon
GCP_REGION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json

# ================================
# FIRESTORE (Auto-configured)
# ================================
# No connection string needed!
# Uses GCP project credentials automatically

# ================================
# PUB/SUB
# ================================
PUBSUB_TOPIC_CIBA=fulcrum-ciba-events

# ================================
# APP
# ================================
NODE_ENV=production
PORT=3001
FRONTEND_URL=https://your-app.vercel.app
```

---

## PERFORMANCE COMPARISON

| Metric | Cloud SQL | Firestore | Difference |
|--------|-----------|-----------|------------|
| Cold start | Always on | Instant | ✅ Firestore faster |
| Read latency | ~5ms | ~10ms | ⚠️ Slightly slower (acceptable) |
| Write latency | ~5ms | ~15ms | ⚠️ Slightly slower (acceptable) |
| Scaling | Manual | Auto | ✅ Firestore wins |
| Maintenance | Manual backups | Fully managed | ✅ Firestore wins |
| Cost | $21/26 days | $0 | 🏆 **Firestore wins** |

**For our use case:**
- Writes: ~200/day (CIBA requests, tool logs) → Firestore is fine
- Reads: ~1,000/day (session state, audit logs) → Well within limits
- No complex JOINs needed → Firestore perfect fit

**Verdict:** Firestore saves $21, performance is 95% the same.

---

## OPTIMIZED GEMINI USAGE PATTERNS

### Pattern 1: Intent Detection (No Gemini)
```typescript
const INTENT_PATTERNS = {
  scan_repos: /scan|audit|check.*repo/i,
  list_repos: /list|show.*repo/i,
  help: /help|what can you do/i,
};

function detectIntent(message: string) {
  for (const [intent, pattern] of Object.entries(INTENT_PATTERNS)) {
    if (pattern.test(message)) return intent;
  }
  return null; // Only then call Gemini
}
```

### Pattern 2: Caching Gemini Responses
```typescript
const responseCache = new Map();

async function getGeminiResponse(prompt: string) {
  const cacheKey = hashPrompt(prompt);
  
  if (responseCache.has(cacheKey)) {
    return responseCache.get(cacheKey); // No API call
  }
  
  const response = await gemini.generateContent(prompt);
  responseCache.set(cacheKey, response);
  return response;
}
```

### Pattern 3: Batch Processing
```typescript
// WRONG: 3 Gemini calls
await gemini.scan(repo1);
await gemini.scan(repo2);
await gemini.scan(repo3);

// RIGHT: 1 Gemini call (or none if using regex)
const results = await scanReposWithoutGemini([repo1, repo2, repo3]);
```

### Pattern 4: Structured Outputs (Fewer Tokens)
```typescript
// WRONG: Let Gemini return prose (500 tokens output)
"I found 3 security issues in your repository..."

// RIGHT: Structured output (50 tokens output)
{
  "issues": [
    {"type": "hardcoded_secret", "file": "config.js", "line": 42}
  ]
}
```

---

## FINAL COST ESTIMATE ($50 Budget)

### Worst Case (Heavy Testing)
```
Cloud Run: 26 days × $0.50 = $13
Firestore: Free tier = $0
Gemini API: 500 calls × $0.01 = $5
Pub/Sub: $0.50
Secret Manager: $0.10
Logging: Free tier = $0
Vercel: Free tier = $0
Auth0: Free tier = $0
─────────────────────────────
Total: $18.60
```

### Best Case (Optimized)
```
Cloud Run: 26 days × $0.30 = $8
Firestore: Free tier = $0
Gemini API: 100 calls × $0.01 = $1
Pub/Sub: $0.30
Secret Manager: $0.10
Everything else: Free
─────────────────────────────
Total: $9.40
```

### Realistic (Demo + Development)
```
Cloud Run: ~$10
Gemini API: ~$3
Other GCP: ~$1
─────────────────────────────
Total: $14
```

**Budget Status:**
- Allocated: $50
- Expected: $14-20
- Buffer: $30+ ✅ **Very safe!**

---

## UPDATED IMPLEMENTATION CHECKLIST

### Changes to implementation.md:

#### Replace:
- [ ] ~~Phase 7.1: Cloud SQL Setup~~ → **Firestore setup** (5 min vs 30 min)
- [ ] ~~Vertex AI setup~~ → **Gemini API key** (instant)

#### Keep (Already Cheap):
- [x] Phase 7: Cloud Run deployment
- [x] Phase 7: Secret Manager
- [x] Phase 7: Pub/Sub setup
- [x] Phase 7: Cloud Logging

#### Add:
- [ ] Phase 7.1: Enable Firestore
- [ ] Phase 7.2: Initialize Firestore collections
- [ ] Phase 7.3: Get Gemini API key (AI Studio or GCP)
- [ ] Phase 7.4: Deploy to Vercel (frontend)

---

## GETTING GEMINI API KEY (Easy)

### Steps:
1. Go to https://aistudio.google.com/app/apikey
2. Sign in with Google account
3. Click "Create API Key"
4. Copy key → Add to .env as `GEMINI_API_KEY`

**That's it. No GCP project, no billing, no complexity.**

### Using Gemini API in Code:
```typescript
import { GoogleGenerativeAI } from "@google/generative-ai";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-2.0-pro-exp" });

const response = await model.generateContent(prompt);
```

---

## SUMMARY

### Original Plan:
- GCP Cloud Run + **Cloud SQL** + **Vertex AI** + Pub/Sub
- **Cost: $95-120 for 26 days**
- Expensive database + expensive AI

### Optimized Plan (GCP + Vercel):
- GCP Cloud Run + **Firestore** + **Gemini API** + Pub/Sub
- Vercel (frontend only)
- **Cost: $14-20 for 26 days** (80% savings!)
- Same GCP ecosystem, just cheaper services

### What Changed:
- ✅ Cloud SQL ($21) → Firestore ($0)
- ✅ Vertex AI ($52) → Gemini API ($3-5)
- ✅ GCP frontend → Vercel frontend (better DX)

### What Stayed:
- ✅ Cloud Run (already cheap)
- ✅ Pub/Sub (already cheap)
- ✅ Secret Manager (already cheap)
- ✅ All GCP features and integrations
- ✅ Same Auth0 setup (Token Vault, FGA, CIBA)
- ✅ Same Gemini 2.0 Pro model
- ✅ Production-quality

### Budget Health:
```
Budget: $50
Expected: $14-20
Remaining: $30-36 buffer ✅ Very safe!
```

**This is the sweet spot: GCP-first, budget-friendly, production-ready!**
