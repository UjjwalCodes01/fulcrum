# 🔐 Project Fulcrum

**Zero-Trust AI Security Agent** - Auth0 for AI Agents Hackathon Submission

> *"The agent becomes Identity-less by default, only borrowing power when the Jedi Council (FGA) and The Force (You) allow it."*

---

## 🎯 What is Fulcrum?

Project Fulcrum is an AI-powered security auditor that operates on **Zero-Trust principles**. Unlike traditional AI agents that store API keys in `.env` files, Fulcrum:

- ✅ **Never stores raw tokens** - Uses Auth0 Token Vault
- ✅ **Verifies every action** - Uses Auth0 FGA (Fine-Grained Authorization)
- ✅ **Requires human approval** - Uses Auth0 CIBA for dangerous actions
- ✅ **Maintains audit trails** - Every action is logged

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        USER (The Force)                     │
│                    Human-in-the-Loop Approval               │
└─────────────────────────┬───────────────────────────────────┘
                          │ CIBA Push
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    AUTH0 (The Kyber Nexus)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ Token Vault  │  │     FGA      │  │     CIBA     │      │
│  │ (Kyber Vault)│  │(Jedi Council)│  │ (Force Link) │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────┬───────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                    FULCRUM CORE (Agent)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   LangGraph  │  │ Gemini 2.5   │  │    State     │      │
│  │ Orchestrator │  │    Pro       │  │   Machine    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────┬───────────────────────────────────┘
                          │
            ┌─────────────┼─────────────┐
            ▼             ▼             ▼
      ┌──────────┐  ┌──────────┐  ┌──────────┐
      │  GitHub  │  │   Slack  │  │   Jira   │
      │ (Slicer) │  │(CommLink)│  │(Tracker) │
      └──────────┘  └──────────┘  └──────────┘
```

## 🛠️ Tech Stack

| Component | Technology |
|-----------|------------|
| **Identity** | Auth0 Token Vault, FGA, CIBA |
| **AI Brain** | Google Gemini 2.5 Pro (Vertex AI) |
| **Agent** | LangGraph (Stateful Graph) |
| **Backend** | Node.js, Express, TypeScript |
| **Frontend** | Next.js 14, Tailwind CSS |
| **Database** | PostgreSQL (Cloud SQL) |
| **Hosting** | GCP Cloud Run, Vercel |

## 📁 Project Structure

```
fulcrum/
├── apps/
│   ├── api/           # Express backend
│   │   ├── src/
│   │   │   ├── routes/       # API endpoints
│   │   │   ├── services/     # Token Vault, FGA
│   │   │   ├── middleware/   # Auth middleware
│   │   │   └── utils/        # Logger, helpers
│   │   └── .env              # (gitignored)
│   │
│   └── web/           # Next.js frontend
│       ├── app/              # App router pages
│       └── .env.local        # (gitignored)
│
├── packages/
│   └── shared/        # Shared types
│
├── hackathon.md       # Hackathon requirements
├── implementation.md  # Phase breakdown
├── PROGRESS.md        # Current status
└── setup-guide.md     # Setup instructions
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- pnpm
- Auth0 account
- GCP account (for Vertex AI)

### Installation

```bash
# Clone the repo
git clone https://github.com/UjjwalCodes01/fulcrum.git
cd fulcrum

# Install dependencies
pnpm install

# Copy environment files
cp .env.example apps/api/.env
cp .env.example apps/web/.env.local

# Fill in your credentials (see setup-guide.md)

# Start development
pnpm dev
```

### Environment Variables

Create `.env` files in `apps/api/` and `apps/web/` based on `.env.example`. Required credentials:

- **Auth0:** Domain, Client ID, Client Secret, Audience
- **GCP:** Project ID, Vertex AI credentials
- **Database:** PostgreSQL connection string

See `setup-guide.md` for detailed instructions.

## 📊 Current Status

See [PROGRESS.md](./PROGRESS.md) for detailed status.

| Phase | Status |
|-------|--------|
| Phase 0: Foundation | ✅ Done |
| Phase 1: Auth0 Login | ✅ Done |
| Phase 2: Token Vault | 🔄 In Progress |
| Phase 3: FGA | ⏳ Pending |
| Phase 4: CIBA | ⏳ Pending |
| Phase 5: Agent | ⏳ Pending |

## 👥 Team

- **Rudra** - Auth0 Integration, GCP, Token Vault
- **Ujjwal** - Agent Development, Phase 3+

## 📄 License

MIT

---

**Built for the Auth0 "Authorized to Act" Hackathon 2026** 🏆
