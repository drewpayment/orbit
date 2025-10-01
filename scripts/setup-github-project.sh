#!/bin/bash
# Setup GitHub Projects Board for Orbit IDP
# Usage: ./scripts/setup-github-project.sh [REPO_OWNER/REPO_NAME]

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REPO="${1:-drewpayment/orbit}"
CURRENT_DATE=$(date +%Y-%m-%d)

echo -e "${BLUE}╔══════════════════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║  GitHub Projects Board Setup for Orbit IDP          ║${NC}"
echo -e "${BLUE}╚══════════════════════════════════════════════════════╝${NC}"
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo -e "${RED}✗ GitHub CLI (gh) is not installed${NC}"
    echo -e "${YELLOW}  Install with: brew install gh${NC}"
    exit 1
fi

# Check if authenticated
if ! gh auth status &> /dev/null; then
    echo -e "${YELLOW}! GitHub CLI not authenticated${NC}"
    echo -e "${YELLOW}  Running: gh auth login${NC}"
    gh auth login
fi

echo -e "${GREEN}✓ GitHub CLI authenticated${NC}"
echo -e "${BLUE}Repository: ${REPO}${NC}"
echo ""

# Confirm before proceeding
read -p "$(echo -e ${YELLOW}Do you want to proceed with setup? \(y/n\) ${NC})" -n 1 -r
echo ""
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${RED}Setup cancelled${NC}"
    exit 0
fi

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Step 1: Creating Labels${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Function to create label (skip if exists)
create_label() {
    local name=$1
    local color=$2
    local description=$3

    if gh label list --repo $REPO --search "$name" --limit 1 --json name --jq '.[].name' | grep -q "^$name$"; then
        echo -e "${YELLOW}  ⊙ Label '$name' already exists (skipping)${NC}"
    else
        gh label create "$name" --color "$color" --description "$description" --repo $REPO 2>/dev/null && \
        echo -e "${GREEN}  ✓ Created label: $name${NC}" || \
        echo -e "${RED}  ✗ Failed to create: $name${NC}"
    fi
}

# By Type
echo -e "${BLUE}Creating type labels...${NC}"
create_label "bug" "d73a4a" "Bug or unexpected behavior"
create_label "feature" "0075ca" "New feature or enhancement"
create_label "documentation" "0e8a16" "Documentation updates"
create_label "tech-task" "7057ff" "Internal technical work"

# By Service
echo -e "${BLUE}Creating service labels...${NC}"
create_label "service:repository" "fbca04" "Repository management service"
create_label "service:api-catalog" "f9d0c4" "API Catalog service"
create_label "service:knowledge" "1d76db" "Knowledge management service"
create_label "service:temporal" "e99695" "Temporal workflows"
create_label "frontend" "5319e7" "Frontend (orbit-www)"
create_label "infra" "8B4513" "Infrastructure and deployment"

# By Priority
echo -e "${BLUE}Creating priority labels...${NC}"
create_label "priority:critical" "b60205" "Critical priority (P0)"
create_label "priority:high" "d93f0b" "High priority (P1)"
create_label "priority:medium" "fbca04" "Medium priority (P2)"
create_label "priority:low" "c5def5" "Low priority (P3)"

# By Status
echo -e "${BLUE}Creating status labels...${NC}"
create_label "blocked" "d73a4a" "Blocked by dependency"
create_label "needs-refinement" "fbca04" "Needs more details"
create_label "ready-for-review" "0e8a16" "Ready for code review"
create_label "breaking-change" "d73a4a" "Breaking API change"

# By Testing
echo -e "${BLUE}Creating testing labels...${NC}"
create_label "tdd-required" "7057ff" "Must follow TDD approach"
create_label "needs-tests" "f9d0c4" "Missing test coverage"
create_label "performance-critical" "b60205" "Performance sensitive code"
create_label "security-sensitive" "b60205" "Security-related changes"

# By Phase
echo -e "${BLUE}Creating phase labels...${NC}"
create_label "phase:setup" "ededed" "Phase 3.1: Setup"
create_label "phase:tdd" "7057ff" "Phase 3.2: TDD Tests"
create_label "phase:implementation" "0075ca" "Phase 3.3: Core Implementation"
create_label "phase:integration" "0e8a16" "Phase 3.4: Integration"
create_label "phase:qa" "f9d0c4" "Phase 3.5: Quality Assurance"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Step 2: Creating Milestones${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

# Function to create milestone (skip if exists)
create_milestone() {
    local title=$1
    local description=$2
    local due_date=$3

    # Check if milestone exists
    if gh api repos/$REPO/milestones --jq ".[].title" | grep -q "^$title$"; then
        echo -e "${YELLOW}  ⊙ Milestone '$title' already exists (skipping)${NC}"
    else
        gh api repos/$REPO/milestones -X POST \
            -f title="$title" \
            -f description="$description" \
            -f due_on="$due_date" &>/dev/null && \
        echo -e "${GREEN}  ✓ Created milestone: $title${NC}" || \
        echo -e "${RED}  ✗ Failed to create: $title${NC}"
    fi
}

create_milestone "Foundation (Phase 3.1)" \
    "Setup tasks (T001-T010): Project structure, tooling, dev environment" \
    "2025-10-15T00:00:00Z"

create_milestone "TDD Gate (Phase 3.2)" \
    "All contract and integration tests (T011-T028) - Constitutional requirement" \
    "2025-11-05T00:00:00Z"

create_milestone "Core Services (Phase 3.3)" \
    "Data models, services, APIs (T029-T044)" \
    "2025-12-03T00:00:00Z"

create_milestone "Frontend & Workflows" \
    "UI components and Temporal workflows (T045-T052)" \
    "2025-12-24T00:00:00Z"

create_milestone "Integration (Phase 3.4)" \
    "Middleware, auth, caching (T053-T062)" \
    "2026-01-07T00:00:00Z"

create_milestone "Production Ready (Phase 3.5)" \
    "QA, performance, security (T063-T074)" \
    "2026-01-21T00:00:00Z"

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Step 3: Manual Project Board Setup${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"

echo ""
echo -e "${YELLOW}⚠️  GitHub Projects v2 requires manual setup through the web UI${NC}"
echo ""
echo -e "${BLUE}Please follow these steps:${NC}"
echo ""
echo -e "${GREEN}1. Create Project:${NC}"
echo "   → Go to: https://github.com/orgs/$(echo $REPO | cut -d'/' -f1)/projects"
echo "   → Or: https://github.com/$(echo $REPO | cut -d'/' -f1)?tab=projects"
echo "   → Click 'New project'"
echo "   → Choose 'Table' view"
echo "   → Name: 'Orbit IDP - Development'"
echo ""

echo -e "${GREEN}2. Add Custom Fields:${NC}"
echo "   Open project Settings (⚙️) and add:"
echo ""
echo "   ${BLUE}Type${NC} (Single select):"
echo "   • 🐛 Bug  • ✨ Feature  • 📚 Documentation"
echo "   • 🔧 Technical Task  • 🧪 Test  • 🏗️ Infrastructure"
echo ""
echo "   ${BLUE}Priority${NC} (Single select):"
echo "   • 🔴 Critical (P0)  • 🟠 High (P1)"
echo "   • 🟡 Medium (P2)  • 🟢 Low (P3)"
echo ""
echo "   ${BLUE}Service/Area${NC} (Single select):"
echo "   • 🎨 Frontend  • 📦 Repository  • 📊 API Catalog"
echo "   • 📖 Knowledge  • ⏱️ Temporal  • 🔌 Proto  • 🏗️ Infra"
echo ""
echo "   ${BLUE}Effort${NC} (Single select):"
echo "   • XS (<2h)  • S (<1d)  • M (1-3d)  • L (3-5d)  • XL (>1w)"
echo ""
echo "   ${BLUE}Sprint${NC} (Iteration): 2-week duration"
echo ""
echo "   ${BLUE}TDD Phase${NC} (Single select):"
echo "   • 🔴 Test First  • 🟢 Make it Pass  • 🔵 Refactor  • ✅ Complete"
echo ""
echo "   ${BLUE}Test Coverage %${NC} (Number)"
echo "   ${BLUE}Performance Target${NC} (Text)"
echo ""

echo -e "${GREEN}3. Configure Status Field:${NC}"
echo "   • 📋 Backlog  • 🔍 Refined  • 🏗️ In Progress"
echo "   • 👀 In Review  • ✅ Testing/QA  • 🚀 Ready for Deploy  • ✨ Done"
echo ""

echo -e "${GREEN}4. Create Views:${NC}"
echo "   See: .github/PROJECT_BOARD_SETUP.md (Section 3.4)"
echo ""

echo -e "${GREEN}5. Set Up Automations:${NC}"
echo "   In Project Settings → Workflows:"
echo "   • Issue opened → Set Status = Backlog"
echo "   • PR linked → Set Status = In Review"
echo "   • PR merged → Set Status = Testing/QA"
echo "   • Issue closed → Set Status = Done"
echo ""

echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Setup Complete!${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

echo -e "${GREEN}✓ Labels created${NC}"
echo -e "${GREEN}✓ Milestones created${NC}"
echo -e "${YELLOW}⊙ Manual project board setup required (see instructions above)${NC}"
echo ""

echo -e "${BLUE}📚 Documentation:${NC}"
echo "   • Full Setup Guide: .github/PROJECT_BOARD_SETUP.md"
echo "   • Workflow Guide: .github/WORKFLOW_GUIDE.md"
echo "   • Visual Summary: .github/PROJECT_BOARD_SUMMARY.md"
echo ""

echo -e "${BLUE}🚀 Next Steps:${NC}"
echo "   1. Complete manual project board setup (see instructions above)"
echo "   2. Share documentation with your team"
echo "   3. Run sprint planning session"
echo "   4. Start developing! 🎉"
echo ""

# Optional: Open browser to project creation page
read -p "$(echo -e ${YELLOW}Open GitHub Projects in browser? \(y/n\) ${NC})" -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ORG=$(echo $REPO | cut -d'/' -f1)
    open "https://github.com/orgs/$ORG/projects?query=is%3Aopen" 2>/dev/null || \
    open "https://github.com/$ORG?tab=projects" 2>/dev/null || \
    echo -e "${YELLOW}Could not open browser. Visit: https://github.com/$ORG?tab=projects${NC}"
fi

echo ""
echo -e "${GREEN}✨ Happy coding!${NC}"
