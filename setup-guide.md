# Project Fulcrum - Required Documentation & Setup Guide

> Everything you need to collect BEFORE writing code

---

## 1. AUTH0 CREDENTIALS & SETUP

### 1.1 Credentials You Already Have (From Auth0 Dashboard)
Record these in a secure location (NOT in git):

```
# Basic Application
AUTH0_DOMAIN=______________.auth0.com
AUTH0_CLIENT_ID=______________
AUTH0_CLIENT_SECRET=______________

# These you need to set:
AUTH0_CALLBACK_URL=http://localhost:3000/api/auth/callback
AUTH0_LOGOUT_URL=http://localhost:3000
AUTH0_AUDIENCE=https://fulcrum-api
```

### 1.2 Additional Auth0 Setup Required

#### A) Machine-to-Machine (M2M) Application
**Where:** Auth0 Dashboard → Applications → Create Application → Machine to Machine

**Why:** Backend needs to call Auth0 APIs (Token Vault, FGA)

**Record:**
```
AUTH0_M2M_CLIENT_ID=______________
AUTH0_M2M_CLIENT_SECRET=______________
```

**Grant APIs:**
- Auth0 Management API
- Auth0 Token Vault API

#### B) Token Vault Connections
**Where:** Auth0 Dashboard → Authentication → Enterprise/Social → Add Connection

**GitHub Connection:**
1. Go to github.com/settings/developers → New OAuth App
2. Set Authorization callback URL: `https://YOUR_DOMAIN.auth0.com/login/callback`
3. Copy Client ID and Secret to Auth0
4. Enable scopes: `repo`, `read:user`

**Jira/Atlassian Connection:**
1. Go to developer.atlassian.com → Create OAuth 2.0 app
2. Set callback URL: `https://YOUR_DOMAIN.auth0.com/login/callback`
3. Add scopes: `read:jira-work`, `write:jira-work`
4. Copy credentials to Auth0

**Slack Connection:**
1. Go to api.slack.com/apps → Create New App
2. Set OAuth Redirect URL: `https://YOUR_DOMAIN.auth0.com/login/callback`
3. Add Bot Token Scopes: `channels:read`, `chat:write`
4. Copy credentials to Auth0

#### C) Fine-Grained Authorization (FGA)
**Where:** Auth0 Dashboard → Fine-Grained Authorization → Create Store

1. Create a new FGA Store
2. Create Authorization Model (use YAML from claude.md)
3. Record:
```
AUTH0_FGA_STORE_ID=______________
AUTH0_FGA_MODEL_ID=______________
AUTH0_FGA_API_URL=https://api.us1.fga.dev  # or your region
```

#### D) CIBA Setup
**Where:** Auth0 Dashboard → Settings → Advanced → OAuth

1. Enable "Client-Initiated Backchannel Authentication"
2. Configure push notification provider (Auth0 Guardian)
3. Record any additional CIBA-specific credentials

**Auth0 Guardian App:**
- User needs to download Auth0 Guardian on phone
- Link to tenant during first login

---

## 2. GOOGLE CLOUD PLATFORM SETUP

### 2.1 Project Creation
```bash
# Create project
gcloud projects create fulcrum-hackathon --name="Project Fulcrum"
gcloud config set project fulcrum-hackathon

# Link billing account (REQUIRED)
gcloud beta billing accounts list
gcloud beta billing projects link fulcrum-hackathon --billing-account=ACCOUNT_ID
```

### 2.2 Enable Required APIs
```bash
gcloud services enable \
  run.googleapis.com \
  aiplatform.googleapis.com \
  sqladmin.googleapis.com \
  pubsub.googleapis.com \
  secretmanager.googleapis.com \
  logging.googleapis.com \
  cloudbuild.googleapis.com
```

### 2.3 Service Account Setup
```bash
# Create service account
gcloud iam service-accounts create fulcrum-backend \
  --display-name="Fulcrum Backend Service"

# Grant roles
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
```

### 2.4 Cloud SQL (PostgreSQL)
```bash
# Create instance (smallest tier for hackathon)
gcloud sql instances create fulcrum-db \
  --database-version=POSTGRES_15 \
  --tier=db-f1-micro \
  --region=us-central1 \
  --storage-size=10GB \
  --storage-auto-increase

# Create database
gcloud sql databases create fulcrum --instance=fulcrum-db

# Create user
gcloud sql users create fulcrum_user \
  --instance=fulcrum-db \
  --password=GENERATE_SECURE_PASSWORD
```

**Record:**
```
DATABASE_URL=postgresql://fulcrum_user:PASSWORD@/fulcrum?host=/cloudsql/fulcrum-hackathon:us-central1:fulcrum-db
```

### 2.5 Pub/Sub Setup
```bash
# Create topic for CIBA events
gcloud pubsub topics create fulcrum-ciba-events

# Create subscription
gcloud pubsub subscriptions create fulcrum-ciba-sub \
  --topic=fulcrum-ciba-events \
  --ack-deadline=60
```

### 2.6 Secret Manager
```bash
# Store secrets (run for each secret)
echo -n "YOUR_SECRET_VALUE" | gcloud secrets create auth0-client-secret \
  --data-file=-

echo -n "YOUR_SECRET_VALUE" | gcloud secrets create auth0-m2m-secret \
  --data-file=-

# ... repeat for all secrets
```

---

## 3. BUDGET ESTIMATION (26 Days) - OPTIMIZED

### 3.1 GCP Costs Breakdown

| Service | Tier/Usage | Cost/Day | 26-Day Cost |
|---------|-----------|----------|-------------|
| **Cloud Run (API)** | 1 instance, 512MB, max-instances=1 | ~$0.30 | **~$8** |
| **Cloud SQL** | db-f1-micro (PostgreSQL, agent memory) | ~$0.40 | **~$10** |
| **Vertex AI (Gemini 2.0 Pro)** | 1M input tokens, 500K output (realistic) | ~$0.90 | **~$23** |
| **Pub/Sub** | 2K messages/day (CIBA events) | ~$0.02 | **~$0.50** |
| **Secret Manager** | 10 secrets, 100 access/day | ~$0.004 | **~$0.10** |
| **Cloud Logging** | 1GB/day (free tier) | $0 | **$0** ✅ |
| **Cloud Storage** | <1GB (free tier) | $0 | **$0** ✅ |
| **Cloud Build** | 10 builds (free tier) | $0 | **$0** ✅ |

### External (Free Tier)
| Service | Tier | Cost |
|---------|------|------|
| **Vercel** | Frontend hosting | **$0** ✅ |
| **Auth0** | Free tier (7,000 MAU) | **$0** ✅ |

### **TOTAL: ~$41.50** for 26 days
### **Budget: $50** → **$8.50 buffer** ✅

### 3.2 Cost Optimization vs Original Plan

| Change | Savings |
|--------|---------|
| Frontend: Cloud Run → Vercel | -$8 |
| Vertex AI: Realistic usage (not 500/day) | -$29 |
| Cloud SQL: db-f1-micro only | Already optimized |
| Max instances: 1 (no auto-scaling) | -$5-10 |
| **Total Savings** | **-$42-47** |

### 3.2 Cost Optimization Tips
1. **Cloud SQL:** Use db-f1-micro, stop instance when not developing
2. **Vertex AI:** Cache repeated queries, use shorter prompts
3. **Cloud Run:** Enable min-instances=0 (scale to zero)
4. **Development:** Run locally when possible, deploy only for testing

### 3.3 Setting Budget Alerts (CRITICAL - DO THIS FIRST!)

```bash
# 🚨 DO THIS BEFORE ENABLING ANY SERVICES!

# 1. Create budget with alerts at 50%, 90%, 100%
gcloud billing budgets create \
  --billing-account=YOUR_BILLING_ACCOUNT_ID \
  --display-name="Fulcrum Hackathon Budget" \
  --budget-amount=50USD \
  --threshold-rule=percent=0.5,basis=current-spend \
  --threshold-rule=percent=0.9,basis=current-spend \
  --threshold-rule=percent=1.0,basis=current-spend

# 2. Get your billing account ID
gcloud billing accounts list

# 3. Set up email notifications
# Go to: https://console.cloud.google.com/billing/budgets
# Add your email to receive alerts

# 4. Create cost monitoring dashboard
gcloud monitoring dashboards create --config-from-file=- <<EOF
{
  "displayName": "Fulcrum Cost Monitor",
  "mosaicLayout": {
    "columns": 12,
    "tiles": [
      {
        "width": 6,
        "height": 4,
        "widget": {
          "title": "Daily GCP Cost",
          "xyChart": {
            "dataSets": [{
              "timeSeriesQuery": {
                "timeSeriesFilter": {
                  "filter": "resource.type=\"billing_account\""
                }
              }
            }]
          }
        }
      }
    ]
  }
}
EOF
```

### 🚨 EMERGENCY COST STOP PROCEDURES

**If you see costs exceeding $45:**

```bash
# 1. IMMEDIATELY stop Cloud SQL
gcloud sql instances patch fulcrum-db --activation-policy=NEVER

# 2. Scale Cloud Run to zero
gcloud run services update fulcrum-api --max-instances=0

# 3. Check what's costing money
gcloud billing accounts get-costs --billing-account=ACCOUNT_ID \
  --start-time=2026-04-01 --end-time=2026-04-07

# 4. Check for unusual activity
gcloud logging read "resource.type=aiplatform.googleapis.com/Endpoint" \
  --limit=100 --format=json

# 5. Rotate all credentials if suspicious
gcloud iam service-accounts keys delete KEY_ID \
  --iam-account=fulcrum-backend@fulcrum-hackathon.iam.gserviceaccount.com
```

### 3.4 Free Tier Maximization
- **Cloud Run:** 2 million requests/month free
- **Cloud Build:** 120 build-minutes/day free
- **Secret Manager:** 10,000 access operations/month free
- **Pub/Sub:** 10GB/month free
- **Vertex AI:** No free tier, but $300 new account credit

**If you have GCP credits:** You should be well within limits.

---

## 4. REQUIRED DOCUMENTATION TO READ

### 4.1 Auth0 for AI Agents (CRITICAL)
| Doc | URL | Priority |
|-----|-----|----------|
| Auth0 for AI Agents Overview | https://auth0.com/ai | **HIGH** |
| Token Vault Documentation | https://auth0.com/docs/get-started/authentication-and-authorization-flow/token-vault | **HIGH** |
| Token Vault SDK (Node.js) | https://github.com/auth0/auth0-ai-js | **HIGH** |
| FGA Getting Started | https://auth0.com/docs/manage-users/access-control/fga | **HIGH** |
| CIBA Documentation | https://auth0.com/docs/get-started/authentication-and-authorization-flow/ciba | **HIGH** |

### 4.2 Auth0 SDKs
| SDK | Package | Purpose |
|-----|---------|---------|
| nextjs-auth0 | `@auth0/nextjs-auth0` | Frontend auth |
| node-auth0 | `auth0` | Management API |
| fga-js-sdk | `@auth0/fga` | FGA checks |
| auth0-ai-js | `@auth0/ai` | Token Vault |

### 4.3 Hackathon Examples (Study These)
| Example | URL | What to Learn |
|---------|-----|---------------|
| LangGraph + Next.js Tutorial | Auth0 docs | Full stack pattern |
| Tool Calling / Token Vault | Auth0 examples | Token acquisition |
| CIBA Example | Auth0 examples | Approval flow |

### 4.4 LangGraph Documentation
| Doc | URL | Priority |
|-----|-----|----------|
| LangGraph Concepts | https://langchain-ai.github.io/langgraph/ | **HIGH** |
| State Management | LangGraph docs | **HIGH** |
| Tool Calling | LangGraph docs | **HIGH** |
| Persistence | LangGraph docs | MEDIUM |

### 4.5 Vertex AI / Gemini
| Doc | URL | Priority |
|-----|-----|----------|
| Vertex AI Node.js SDK | Google Cloud docs | **HIGH** |
| Gemini API Reference | Google Cloud docs | **HIGH** |
| Function Calling | Google Cloud docs | **HIGH** |

---

## 5. NPM PACKAGES TO INSTALL

### 5.1 Backend (apps/api)
```json
{
  "dependencies": {
    "express": "^4.18.2",
    "express-oauth2-jwt-bearer": "^1.6.0",
    "auth0": "^4.3.0",
    "@auth0/fga": "^0.2.0",
    "@auth0/ai": "latest",
    "@langchain/langgraph": "^0.2.0",
    "@langchain/google-vertexai": "^0.1.0",
    "@langchain/core": "^0.3.0",
    "@octokit/rest": "^21.0.0",
    "jira-client": "^8.2.0",
    "@slack/web-api": "^7.0.0",
    "drizzle-orm": "^0.32.0",
    "postgres": "^3.4.0",
    "@google-cloud/pubsub": "^4.3.0",
    "socket.io": "^4.7.0",
    "uuid": "^9.0.0",
    "zod": "^3.23.0",
    "winston": "^3.13.0"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^20.12.0",
    "typescript": "^5.4.0",
    "tsx": "^4.7.0",
    "drizzle-kit": "^0.22.0",
    "vitest": "^1.5.0"
  }
}
```

### 5.2 Frontend (apps/web)
```json
{
  "dependencies": {
    "next": "^14.2.0",
    "react": "^18.3.0",
    "@auth0/nextjs-auth0": "^3.5.0",
    "@radix-ui/react-dialog": "^1.0.0",
    "@radix-ui/react-dropdown-menu": "^2.0.0",
    "@radix-ui/react-avatar": "^1.0.0",
    "tailwindcss": "^3.4.0",
    "class-variance-authority": "^0.7.0",
    "clsx": "^2.1.0",
    "lucide-react": "^0.378.0",
    "socket.io-client": "^4.7.0",
    "swr": "^2.2.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.4.0",
    "postcss": "^8.4.0",
    "autoprefixer": "^10.4.0"
  }
}
```

### 5.3 Shared (packages/shared)
```json
{
  "dependencies": {
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

---

## 6. ENVIRONMENT VARIABLES CHECKLIST

Create `.env.local` (frontend) and `.env` (backend):

```bash
# ================================
# 🚨 NEVER COMMIT THIS FILE TO GIT!
# ================================
# Add to .gitignore:
# .env
# .env.local
# .env.production
# service-account.json

# ================================
# AUTH0 - CORE (You have these)
# ================================
AUTH0_DOMAIN=your-tenant.auth0.com
AUTH0_CLIENT_ID=xxxxx
AUTH0_CLIENT_SECRET=xxxxx  # 🚨 NEVER expose in frontend
AUTH0_AUDIENCE=https://fulcrum-api
AUTH0_BASE_URL=http://localhost:3000
AUTH0_ISSUER_BASE_URL=https://your-tenant.auth0.com

# ================================
# AUTH0 - M2M (Create new M2M app)
# ================================
AUTH0_M2M_CLIENT_ID=xxxxx
AUTH0_M2M_CLIENT_SECRET=xxxxx  # 🚨 Backend only

# ================================
# AUTH0 - FGA (Create FGA store)
# ================================
AUTH0_FGA_STORE_ID=xxxxx
AUTH0_FGA_MODEL_ID=xxxxx
AUTH0_FGA_API_URL=https://api.us1.fga.dev

# ================================
# GOOGLE CLOUD (Backend only!)
# ================================
GCP_PROJECT_ID=fulcrum-hackathon
GCP_REGION=us-central1
VERTEX_AI_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json  # 🚨 NEVER commit

# ================================
# DATABASE (Cloud SQL)
# ================================
# Local dev:
DATABASE_URL=postgresql://postgres:password@localhost:5432/fulcrum

# Production (Cloud Run with Cloud SQL):
DATABASE_URL=postgresql://fulcrum_user:PASSWORD@/fulcrum?host=/cloudsql/fulcrum-hackathon:us-central1:fulcrum-db

# ================================
# PUB/SUB
# ================================
PUBSUB_TOPIC_CIBA=fulcrum-ciba-events
PUBSUB_SUBSCRIPTION_CIBA=fulcrum-ciba-sub

# ================================
# COST PROTECTION
# ================================
MAX_DAILY_VERTEX_REQUESTS=50      # Prevent cost bombs
MAX_INPUT_LENGTH=5000             # Prevent token bombs
RATE_LIMIT_PER_USER=100           # Requests per 15 minutes
ALERT_THRESHOLD_USD=45            # Send alert email

# ================================
# APP
# ================================
NODE_ENV=development
PORT=3001
FRONTEND_URL=http://localhost:3000

# ================================
# SECURITY
# ================================
SESSION_SECRET=$(openssl rand -base64 32)  # Generate this!
CORS_ORIGIN=http://localhost:3000         # Update for production
```

### 🔒 SECURITY CHECKLIST

Before committing ANY code:
- [ ] .gitignore includes .env files
- [ ] .gitignore includes service-account.json
- [ ] No API keys in frontend code
- [ ] No hardcoded credentials anywhere
- [ ] All secrets in GCP Secret Manager (production)
- [ ] Rate limiting enabled
- [ ] Input validation on all Vertex AI calls
- [ ] Budget alerts configured
- [ ] Max instances set to 1

---

## 7. PRE-FLIGHT CHECKLIST

Before starting Phase 1, verify:

### Auth0
- [ ] Regular Web App created
- [ ] M2M App created with Management API access
- [ ] Token Vault enabled
- [ ] GitHub OAuth app created and connected
- [ ] FGA store created
- [ ] All credentials recorded

### GCP
- [ ] Project created
- [ ] Billing linked
- [ ] All APIs enabled
- [ ] Service account created with roles
- [ ] `gcloud auth application-default login` run locally

### Local Development
- [ ] Node.js 20+ installed
- [ ] pnpm installed
- [ ] PostgreSQL running locally (or use Cloud SQL)
- [ ] All environment variables set

### OAuth Apps
- [ ] GitHub OAuth App created
- [ ] (Optional) Jira OAuth App created
- [ ] (Optional) Slack App created

---

## 8. QUICK REFERENCE LINKS

### Auth0
- Dashboard: https://manage.auth0.com/
- Token Vault Docs: https://auth0.com/docs/token-vault
- FGA Dashboard: https://dashboard.fga.dev/
- CIBA Docs: https://auth0.com/docs/ciba

### GCP
- Console: https://console.cloud.google.com/
- Cloud Run: https://console.cloud.google.com/run
- Cloud SQL: https://console.cloud.google.com/sql
- Vertex AI: https://console.cloud.google.com/vertex-ai

### Development
- LangGraph: https://langchain-ai.github.io/langgraph/
- Octokit: https://octokit.github.io/rest.js/
- Drizzle ORM: https://orm.drizzle.team/

---

## 9. SUPPORT CHANNELS

If stuck:
- Auth0 Community: https://community.auth0.com/
- Auth0 Discord: (check hackathon resources)
- GCP Support: https://cloud.google.com/support
- Hackathon Discord/Slack: (check Devpost page)
