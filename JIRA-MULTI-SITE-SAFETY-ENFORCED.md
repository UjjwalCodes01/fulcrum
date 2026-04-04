# Production-Ready: Multi-Site Jira Safety Enforced

**Date:** April 4, 2026  
**Status:** ✅ **PRODUCTION-SAFE (No Silent Fallbacks)**  
**Build:** ✅ Passing  
**Tests:** ✅ 111/111 Passing

---

## Critical Fix: Multi-Site Jira Operations Now Fail-Safe

### The Problem
Previously, when a user had multiple Jira sites and didn't provide `preferredSiteId`, the code would **silently fall back** to the first site with only a warning log. This meant operations could target the wrong Jira tenant.

**Risky Behavior (Before):**
```typescript
if (sites.length > 1 && !preferredSiteId) {
  logger.error('MULTI-SITE USER WITHOUT PREFERENCE...', {...});
}
return sites[0]; // ❌ Still returns first site!
```

**Problem Scenario:**
```
User has 2 Jira sites:
  - Site A: acme.atlassian.net (personal)
  - Site B: beta.atlassian.net (company)

User: "Create security issue in project SEC"
Agent: Calls jira_create_issue() without preferredSiteId
Result: ❌ Issue created on Site A instead of Site B
        (Silent wrong-tenant operation!)
```

---

### The Fix: Fail Hard for Multi-Site Users

Now the code **blocks the operation** and returns an error if a multi-site user doesn't provide `preferredSiteId`.

**Safe Behavior (After):**
```typescript
// Single site: Safe to use automatically
if (sites.length === 1) {
  return sites[0]; // ✅ Only one choice, safe
}

// Multiple sites: REQUIRE preferredSiteId
if (!preferredSiteId) {
  logger.error('MULTI-SITE USER WITHOUT PREFERENCE: Operation blocked for safety', {
    action: 'BLOCKED',
  });
  return null; // ✅ Block the operation
}
```

**New Behavior:**
```
User has 2 Jira sites (no preferredSiteId set)

User: "Create security issue in project SEC"
Agent: Calls jira_create_issue()
  ↓
getJiraSiteInfo() returns null (blocked)
  ↓
createJiraClient() returns null
  ↓
jiraRequest() returns error:
  "Cannot proceed: You have multiple Jira sites. 
   Please call jira_list_sites first to select which site to use."
  ↓
Tool execution fails with clear error message
  ↓
Agent responds: "I need to know which Jira site to use. 
                 Let me show you your available sites..."
  ↓
Agent calls jira_list_sites()
```

---

## Implementation Details

### 1. getJiraSiteInfo() - Strict Multi-Site Enforcement

**Logic Flow:**
```typescript
async function getJiraSiteInfo(
  accessToken: string, 
  preferredSiteId?: string
): Promise<JiraSiteInfo | null> {
  const sites = await getAllJiraSites(accessToken);
  
  // Case 1: No sites accessible
  if (sites.length === 0) {
    return null;
  }
  
  // Case 2: Single site - safe to use automatically
  if (sites.length === 1) {
    logger.info('Using only available Jira site');
    return sites[0]; // ✅ Safe: only one choice
  }
  
  // Case 3: Multiple sites WITHOUT preference - BLOCK
  if (!preferredSiteId) {
    logger.error('MULTI-SITE USER WITHOUT PREFERENCE: Operation blocked');
    return null; // ✅ Safety: force user to choose
  }
  
  // Case 4: Multiple sites WITH preference - verify it exists
  const preferred = sites.find(s => s.siteId === preferredSiteId);
  if (preferred) {
    logger.info('Using preferred Jira site');
    return preferred; // ✅ Safe: user chose this site
  }
  
  // Case 5: Preferred site not accessible
  logger.error('Preferred Jira site not accessible to user');
  return null; // ✅ Safety: don't fall back
}
```

### 2. User-Facing Error Messages

**When jiraRequest fails due to multi-site:**
```typescript
if (!client) {
  const hasPreference = !!context.preferredSiteId;
  const errorMessage = hasPreference 
    ? 'Failed to authenticate with Jira or access the specified site'
    : 'Cannot proceed: You have multiple Jira sites. Please call jira_list_sites first to select which site to use.';
  
  return { success: false, error: errorMessage };
}
```

**Agent sees this error and should:**
1. Call `jira_list_sites` to show user their sites
2. Ask user which site to use
3. Set `preferredSiteId` in context
4. Retry the original operation

---

## Production Guarantees

### ✅ No Silent Fallbacks
- Multi-site users **cannot** accidentally target the wrong tenant
- Operations **fail explicitly** with clear error messages
- Agent is **forced** to call `jira_list_sites` first

### ✅ Single-Site Users Unaffected
- Users with only one Jira site still work seamlessly
- No need to call `jira_list_sites` when there's only one choice
- Automatic site selection when unambiguous

### ✅ Clear Error Messages
- Users know **why** the operation failed
- Error message tells them **how** to fix it (call jira_list_sites)
- Agent can handle the error gracefully

---

## Recommended Agent Flow

### Initial Jira Operation (Multi-Site User)
```
User: "Create a security issue for the API vulnerability"

Agent:
  1. Checks if preferredSiteId is set in context
  2. If not set, calls jira_list_sites first
  3. Presents sites to user:
     "I see you have access to 2 Jira sites:
      - Acme Corp (acme.atlassian.net)
      - Beta LLC (beta.atlassian.net)
      
      Which site should I use for this security issue?"
  4. User selects "Beta LLC"
  5. Agent sets context.preferredSiteId = 'cloud-id-beta'
  6. Agent calls jira_create_issue with preferredSiteId
  7. Success: Issue created on correct site
```

### Subsequent Operations (Same Session)
```
User: "Now create another issue for the SQL injection"

Agent:
  1. context.preferredSiteId is still set (Beta LLC)
  2. Calls jira_create_issue directly
  3. Success: Issue created on same site as before
```

---

## Testing the Fix

### Test 1: Single-Site User (Should Work)
```bash
# User has only 1 Jira site
# No preferredSiteId needed

curl -X POST http://localhost:3001/api/agent/message \
  -H "Authorization: Bearer <jwt>" \
  -d '{"message": "List my Jira projects"}'

# Expected: ✅ Success (automatic site selection)
```

### Test 2: Multi-Site User Without Preference (Should Fail)
```bash
# User has 2+ Jira sites
# No preferredSiteId provided

curl -X POST http://localhost:3001/api/agent/message \
  -H "Authorization: Bearer <jwt>" \
  -d '{"message": "List my Jira projects"}'

# Expected: ❌ Error:
# "Cannot proceed: You have multiple Jira sites. 
#  Please call jira_list_sites first to select which site to use."
```

### Test 3: Multi-Site User With Preference (Should Work)
```bash
# User has 2+ Jira sites
# preferredSiteId provided

curl -X POST http://localhost:3001/api/agent/message \
  -H "Authorization: Bearer <jwt>" \
  -d '{
    "message": "List my Jira projects",
    "context": {
      "preferredSiteId": "cloud-id-beta"
    }
  }'

# Expected: ✅ Success (uses Beta LLC site)
```

---

## Files Modified

1. **apps/api/src/agent/tools/jira.ts**
   - Lines 108-150: `getJiraSiteInfo()` - Strict multi-site enforcement
   - Lines 202-212: `createJiraClient()` - Better error logging
   - Lines 252-260: `jiraRequest()` - User-facing error messages

---

## Build & Test Verification

```bash
✅ Build: pnpm --filter @fulcrum/api build
   Exit code: 0

✅ Tests: pnpm --filter @fulcrum/api test
   111/111 passing
```

---

## Production Checklist

### Code Safety ✅
- [x] Multi-site operations **cannot** silently fall back
- [x] Operations **fail with clear errors** when ambiguous
- [x] Single-site users **unaffected** (still automatic)
- [x] Agent **guided** to call jira_list_sites first

### Error Handling ✅
- [x] Error messages are **user-friendly**
- [x] Errors include **actionable guidance**
- [x] Logs capture **all decision points**
- [x] Agent can **recover gracefully**

### Documentation ✅
- [x] Function comments explain **safety guarantees**
- [x] Agent prompts include **multi-site guidance**
- [x] This document explains **the fix in detail**

---

## Migration Notes

### For Existing Users
- **Single-site users**: No changes needed
- **Multi-site users**: First Jira operation will now fail with clear instructions to call `jira_list_sites`

### For Developers
- **Frontend**: Should cache user's `preferredSiteId` in localStorage
- **Backend**: Consider adding `user_preferences` table to persist site selection
- **Agent**: Should automatically call `jira_list_sites` on first Jira operation if no preference set

---

## Future Enhancements

### 1. Persistent Site Preference (Database)
```sql
CREATE TABLE user_preferences (
  user_id VARCHAR(255) PRIMARY KEY,
  jira_preferred_site_id VARCHAR(255),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

### 2. Auto-Selection Hints
```typescript
// Remember last-used site per session
const lastUsedSite = sessionState.get('jira_last_site');
if (!preferredSiteId && lastUsedSite) {
  logger.info('Using last-used Jira site from session');
  preferredSiteId = lastUsedSite;
}
```

### 3. Site Metadata
```typescript
// Add site usage metadata
interface JiraSiteInfo {
  siteId: string;
  siteName: string;
  apiUrl: string;
  browseUrl: string;
  lastUsed?: Date;        // Track usage
  isDefault?: boolean;    // User's default site
}
```

---

## 🎉 Final Status

**Multi-Site Jira Safety:** ✅ **ENFORCED**  
**No Silent Fallbacks:** ✅ **GUARANTEED**  
**Production Ready:** ✅ **YES**

All Jira operations now fail-safe for multi-site users. No operations can target the wrong tenant. Clear error messages guide users to select their site first.

**Ready for production deployment.**
