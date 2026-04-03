#!/bin/bash
# FGA Quick Test Script
# Run this after starting both servers to verify FGA is working

set -e

API_URL="${API_URL:-http://localhost:3001}"
GREEN='\033[0;32m'
RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔐 Testing Fulcrum FGA Implementation"
echo "======================================"
echo ""

# Test 1: FGA Status (Public)
echo -e "${YELLOW}Test 1: FGA Status (no auth required)${NC}"
STATUS=$(curl -s "${API_URL}/api/fga/status")
echo "$STATUS" | jq '.'
if echo "$STATUS" | jq -e '.mode' > /dev/null; then
  echo -e "${GREEN}✅ FGA status endpoint working${NC}"
else
  echo -e "${RED}❌ FGA status endpoint failed${NC}"
  exit 1
fi
echo ""

# Test 2: List Tools (Public)
echo -e "${YELLOW}Test 2: List All Tools (no auth required)${NC}"
TOOLS=$(curl -s "${API_URL}/api/fga/tools")
TOOL_COUNT=$(echo "$TOOLS" | jq '.tools | length')
echo "Found $TOOL_COUNT tools"
if [ "$TOOL_COUNT" -eq 30 ]; then
  echo -e "${GREEN}✅ All 30 tools registered${NC}"
else
  echo -e "${RED}❌ Expected 30 tools, found $TOOL_COUNT${NC}"
  exit 1
fi
echo ""

# Test 3: Check if JWT is provided
echo -e "${YELLOW}Test 3: Protected Endpoints${NC}"
if [ -z "$TOKEN" ]; then
  echo -e "${YELLOW}⚠️  No TOKEN environment variable set${NC}"
  echo "To test protected endpoints:"
  echo "  1. Login at http://localhost:3000"
  echo "  2. Get JWT from browser DevTools"
  echo "  3. Export TOKEN=\"your.jwt.here\""
  echo "  4. Run this script again"
  echo ""
  echo -e "${GREEN}✅ Public endpoints working!${NC}"
  exit 0
fi

# Test 4: Check Permission (Protected)
echo "Testing with provided JWT..."
CHECK=$(curl -s -H "Authorization: Bearer $TOKEN" \
  "${API_URL}/api/fga/check?action=github_list_repos")
echo "$CHECK" | jq '.'
if echo "$CHECK" | jq -e '.action' > /dev/null; then
  echo -e "${GREEN}✅ Permission check endpoint working${NC}"
else
  echo -e "${RED}❌ Permission check failed${NC}"
  echo "Check if your token is valid"
  exit 1
fi
echo ""

# Test 5: Verify Risk Levels
echo -e "${YELLOW}Test 4: Risk Level Verification${NC}"
LEVEL_1=$(echo "$TOOLS" | jq '[.tools[] | select(.riskLevel == 1)] | length')
LEVEL_5=$(echo "$TOOLS" | jq '[.tools[] | select(.riskLevel == 5)] | length')
echo "Level 1 (READ) tools: $LEVEL_1"
echo "Level 5 (DELETE/CIBA) tools: $LEVEL_5"

LEVEL_5_TOOLS=$(echo "$TOOLS" | jq -r '.tools[] | select(.riskLevel == 5) | .name')
echo ""
echo "Level 5 tools requiring CIBA:"
echo "$LEVEL_5_TOOLS" | sed 's/^/  - /'
echo ""

# Test 6: Verify agent actions
echo -e "${YELLOW}Test 5: Agent Action Verification${NC}"
AGENT_ACTIONS=$(echo "$TOOLS" | jq -r '.tools[] | select(.name | startswith("agent_")) | .name')
AGENT_COUNT=$(echo "$AGENT_ACTIONS" | wc -l | tr -d ' ')
if [ "$AGENT_COUNT" -eq 3 ]; then
  echo -e "${GREEN}✅ All 3 agent actions registered:${NC}"
  echo "$AGENT_ACTIONS" | sed 's/^/  - /'
else
  echo -e "${RED}❌ Expected 3 agent actions, found $AGENT_COUNT${NC}"
  exit 1
fi
echo ""

echo "======================================"
echo -e "${GREEN}✅ All FGA Tests Passed!${NC}"
echo ""
echo "Next steps:"
echo "  1. Connect GitHub at http://localhost:3000/connections"
echo "  2. Check permissions are granted:"
echo "     curl -H \"Authorization: Bearer \$TOKEN\" \\"
echo "       \"${API_URL}/api/fga/check?action=github_list_repos\""
echo "  3. Move to Phase 4 (CIBA) implementation"
