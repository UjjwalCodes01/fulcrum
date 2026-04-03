# Auth0 FGA Setup for Fulcrum

This directory contains the FGA (Fine-Grained Authorization) model for Project Fulcrum.

## What is FGA?

**Fine-Grained Authorization** is Auth0's relationship-based access control system. Think of it as "Google Docs permissions" for your app - you can define who can do what on which resources.

For Fulcrum, we use FGA to ensure the AI agent **never** executes a tool without explicit permission from the user.

## Quick Setup

### 1. Create FGA Store

1. Go to https://dashboard.fga.dev/
2. Sign in with your Auth0 account
3. Click **"Create Store"**
4. Name: `fulcrum-production` (or `fulcrum-dev`)
5. Copy the **Store ID**

### 2. Upload the Model

1. In the FGA dashboard, click **"Authorization Models"**
2. Click **"Create New Model"**
3. Copy the contents of `model.fga` (this file)
4. Paste into the editor
5. Click **"Validate"** then **"Save"**
6. Copy the **Model ID**

### 3. Get API Credentials

1. In FGA dashboard, go to **"Settings" → "API Keys"**
2. Click **"Create API Key"**
3. Copy the **Client ID** and **Client Secret**

### 4. Update `.env`

Add these to your `apps/api/.env`:

```bash
AUTH0_FGA_STORE_ID=your_store_id_here
AUTH0_FGA_MODEL_ID=your_model_id_here
AUTH0_FGA_API_URL=https://api.us1.fga.dev
AUTH0_FGA_CLIENT_ID=your_client_id_here
AUTH0_FGA_CLIENT_SECRET=your_client_secret_here

# Development mode - allows all if FGA not configured
FGA_STRICT_MODE=false

# Production mode - denies all if FGA not configured
# FGA_STRICT_MODE=true
```

## How It Works

### The Flow

```
1. User connects GitHub via OAuth
   ↓
2. Backend calls grantConnectionPermissions(userId, 'github')
   ↓
3. FGA tuples are written:
   - user:github|123 can_execute action:github_list_repos
   - user:github|123 can_execute action:github_scan_secrets
   - user:github|123 can_execute action:github_create_issue
   - ... (all GitHub tools)
   ↓
4. Agent receives message from user
   ↓
5. Middleware checks: checkPermission(userId, 'agent_interact')
   ↓
6. Agent wants to run github_list_repos
   ↓
7. Service checks: checkPermission(userId, 'github_list_repos')
   ↓
8. FGA returns: { allowed: true }
   ↓
9. Tool executes ✅
```

### If User Never Connected GitHub

```
1. User sends message to agent
   ↓
2. Agent wants to run github_list_repos
   ↓
3. FGA checks: user:github|123 can_execute action:github_list_repos
   ↓
4. FGA returns: { allowed: false } (no tuple exists)
   ↓
5. Agent returns: "Permission denied. Please connect your GitHub account."
```

## The Model Explained

### Types

- **user**: A person who authenticates (e.g., `user:github|12345`)
- **agent**: The Fulcrum AI agent (`agent:fulcrum`)
- **action**: A tool/operation (e.g., `action:github_list_repos`)
- **connection**: A connected service (`connection:github:user123`)
- **resource**: A specific resource (`resource:repo:owner/name`)
- **session**: An active agent session (`session:uuid`)

### Relationships

- `can_execute`: User can execute an action
- `requires_approval`: Action requires CIBA approval (Level 5)
- `can_act_on_behalf_of`: Agent can act for user
- `owner`: User owns a connection/session
- `is_active`: Connection/session is active

### Example Tuples

When a user connects GitHub:
```
user:github|12345 can_execute action:github_list_repos
user:github|12345 can_execute action:github_scan_secrets
user:github|12345 can_execute action:github_create_issue
user:github|12345 can_execute action:github_create_pr
user:github|12345 can_execute action:github_merge_pr
user:github|12345 requires_approval action:github_merge_pr
```

When a user starts a session:
```
user:github|12345 owner session:abc-123-def
user:github|12345 is_active session:abc-123-def
```

## Testing FGA

### 1. Check Status (No Auth Required)

```bash
curl http://localhost:3001/api/fga/status
```

Expected response:
```json
{
  "configured": true,
  "storeId": "01HP...",
  "modelId": "01HQ...",
  "environment": "development",
  "mode": "permissive",
  "totalTools": 30
}
```

### 2. List All Tools (No Auth Required)

```bash
curl http://localhost:3001/api/fga/tools | jq
```

### 3. Check Permission (Auth Required)

First, get a token by logging in at http://localhost:3000

```bash
# Get your JWT from browser DevTools (Application → Cookies → appSession)
export TOKEN="your.jwt.here"

# Check if you can list repos
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/fga/check?action=github_list_repos" | jq
```

Expected response if you connected GitHub:
```json
{
  "allowed": true,
  "action": "github_list_repos",
  "riskLevel": 1,
  "requiresApproval": false,
  "mode": "permissive"
}
```

Expected response if you haven't connected:
```json
{
  "allowed": false,
  "action": "github_list_repos",
  "riskLevel": 1,
  "requiresApproval": false,
  "reason": "No permission tuples found",
  "mode": "strict"
}
```

### 4. Grant Permissions Manually

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connection":"github"}' \
  http://localhost:3001/api/fga/grant-connection
```

### 5. Revoke Permissions

```bash
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connection":"github"}' \
  http://localhost:3001/api/fga/revoke-connection
```

## Tool Risk Levels

| Level | Type | Description | CIBA Required |
|-------|------|-------------|---------------|
| **1** | READ | Safe read operations | No |
| **2** | SEARCH | Search/scan operations | No |
| **3** | CREATE | Create new resources | No |
| **4** | UPDATE | Modify existing resources | No |
| **5** | DELETE | Destructive operations | **YES** |

### Level 5 Actions (Require CIBA)

- `github_merge_pr` - Merge pull request
- `github_delete_branch` - Delete branch
- `github_delete_repo` - Delete repository
- `jira_delete_issue` - Delete Jira issue
- `slack_invite_user` - Invite user to Slack
- `slack_remove_user` - Remove user from Slack

When the agent tries to execute a Level 5 action:
1. FGA check passes (user has permission)
2. `requiresApproval(action)` returns true
3. Agent returns `202 AWAITING_APPROVAL`
4. CIBA flow triggers (Phase 4)
5. User approves on phone via Auth0 Guardian
6. Agent resumes execution

## Troubleshooting

### "FGA not configured" in logs

You're in development mode (permissive). FGA is allowing all actions even though it's not configured. This is by design.

To enforce FGA in development:
```bash
FGA_STRICT_MODE=true
```

### "Permission denied" but I connected GitHub

1. Check if permissions were granted:
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/api/fga/check?action=github_list_repos"
```

2. Clear the permission cache:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/fga/clear-cache
```

3. Manually grant permissions:
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"connection":"github"}' \
  http://localhost:3001/api/fga/grant-connection
```

### FGA API returns 401

Check your credentials:
```bash
echo $AUTH0_FGA_CLIENT_ID
echo $AUTH0_FGA_CLIENT_SECRET
```

Make sure they're set in `.env` and the server was restarted.

### Cache issues

FGA responses are cached for 1 minute. If you change permissions in the FGA dashboard directly, clear the cache:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3001/api/fga/clear-cache
```

## Advanced: Writing Tuples Directly

You can write tuples directly via the FGA API for testing:

```bash
curl -X POST https://api.us1.fga.dev/stores/$STORE_ID/write \
  -H "Authorization: Bearer $FGA_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "writes": {
      "tuple_keys": [
        {
          "user": "user:github|12345",
          "relation": "can_execute",
          "object": "action:github_list_repos"
        }
      ]
    }
  }'
```

But it's better to use our helper functions:
```typescript
import { grantConnectionPermissions } from '../services/fga.js';

await grantConnectionPermissions('github|12345', 'github');
```

## Production Checklist

- [ ] FGA Store created in production environment
- [ ] Model uploaded and validated
- [ ] API credentials stored in Cloud Secret Manager (not .env)
- [ ] `FGA_STRICT_MODE=true` set in production
- [ ] Permission cache uses Redis instead of in-memory Map
- [ ] Audit logging enabled for all FGA denials
- [ ] Monitoring alerts for FGA API errors

## Resources

- [Auth0 FGA Docs](https://docs.fga.dev/)
- [FGA Playground](https://play.fga.dev/)
- [OpenFGA SDK](https://github.com/openfga/js-sdk)
- [FGA Discord](https://discord.gg/auth0)
