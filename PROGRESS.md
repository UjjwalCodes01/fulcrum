# Project Fulcrum - Progress Report

**Last Updated:** April 1, 2026 (10:15 AM)  
**Hackathon Deadline:** April 7, 2026 (6 days remaining)

---

## 👥 Team Division

| Person | Responsibilities |
|--------|------------------|
| **Rudra** | Token Vault fix, GCP integration, deployment |
| **Ujjwal** | Phase 3+ (FGA, CIBA, Agent, Tools) |

---

## 📊 Overall Status: Phase 2 (In Progress)

| Phase | Name | Status | Owner |
|-------|------|--------|-------|
| 0 | Foundation & Scaffold | ✅ Done | - |
| 1 | Auth0 Login | ✅ Done | - |
| 2 | Token Vault | 🔄 In Progress | Rudra |
| 3 | FGA (Fine-Grained Auth) | ⏳ Pending | Ujjwal |
| 4 | CIBA (Human-in-the-Loop) | ⏳ Pending | Ujjwal |
| 5 | LangGraph + Gemini Agent | ⏳ Pending | Ujjwal |
| 6 | Tool Implementations | ⏳ Pending | Ujjwal |
| 7 | Frontend UI | ⏳ Pending | Ujjwal |
| 8 | GCP Deployment | ⏳ Pending | Rudra |
| 9 | Demo Video | ⏳ Pending | Both |

---

## ✅ What's Been Completed

### Phase 0: Foundation
- [x] Monorepo structure with Turborepo
- [x] `apps/api` - Express backend with TypeScript
- [x] `apps/web` - Next.js 14 frontend with Tailwind
- [x] `packages/shared` - Shared types
- [x] All dependencies installed and working

### Phase 1: Auth0 Login
- [x] Auth0 application configured
- [x] GitHub social connection added (using GitHub App)
- [x] User can login via GitHub OAuth
- [x] JWT validation middleware on backend
- [x] Protected API routes working
- [x] Frontend shows logged-in user info

**Current User:** `github|183722825` (rvsrathore17@gmail.com)

---

## 🔄 Phase 2 Status: Token Vault (Simple Approach)

### The Blocker
GitHub Apps **don't reliably issue refresh tokens** through standard OAuth. Auth0's Token Vault exchange grant type requires refresh tokens.

### Current Approach
**Keep it simple:** Fix GitHub App configuration on their end. If they don't issue refresh tokens after proper setup, move on to Phase 3+.

**Why?** 
- The Token Vault concept is proven (Auth0 is storing the token securely)
- Judges care about the **Zero-Trust architecture**, not perfect OAuth plumbing
- Phase 3 (FGA) and Phase 5 (Agent) are more important for judges

### For Rudra to Fix
1. Verify GitHub App settings one more time
2. If still no refresh token after full reauth: **Move to Phase 3**
3. Circle back to Token Vault perfection only if time permits

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
