# PharmaCore ERP + POS 💊🏥

[![Electron](https://img.shields.io/badge/Electron-31.0+-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3+-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![Vite](https://img.shields.io/badge/Vite-5.3+-646CFF?logo=vite&logoColor=white)](https://vitejs.dev/)
[![TailwindCSS](https://img.shields.io/badge/Tailwind-3.4+-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)](https://supabase.com/)

**PharmaCore** is a modern, enterprise-grade desktop **Pharmacy ERP, POS (Point of Sale), and Multi-Tenant SaaS platform**. Built for independent retail pharmacies, hospital dispensaries, and multi-branch pharmacy chains, PharmaCore combines local offline resilience with real-time cloud synchronization.

---

## 🛠️ Tech Stack

| Layer | Technologies |
| :--- | :--- |
| **Desktop Shell** | [Electron 31](https://www.electronjs.org/) (Node.js Main Process, IPC Handlers, Context Isolation) |
| **Frontend UI** | [React 18](https://react.dev/), [Vite 5](https://vitejs.dev/), [Tailwind CSS 3.4](https://tailwindcss.com/), [Lucide React](https://lucide.dev/), [GSAP](https://greensock.com/gsap/) |
| **Cloud Backend & DB** | [Supabase](https://supabase.com/) (PostgreSQL 15+, PostgREST, Row-Level Security, RPC Functions) |
| **Offline & Local Store** | File-backed JSON Local Cache (`localCache.js`), Offline Action Queue (`offlineQueue.js`), Secure Keystore |
| **Packaging & Distribution**| [Electron Builder](https://www.electron.build/) (Windows NSIS Setup Installer & Portable Executables) |

---

## 📂 Project Structure

```text
POSsystem/
├── electron/                     # Electron main process backend & IPC services
│   ├── api.js                    # Business logic IPC handlers (Medicines, POS, SaaS, Batches)
│   ├── auth.js                   # Multi-tenant authentication, session management & password hashing
│   ├── db.js                     # Supabase data layer with column mapping & local cache fallback
│   ├── keystore.js               # Envelope encryption master key manager
│   ├── localApi.js               # Inbound Express REST API for third-party integrations
│   ├── localCache.js             # Offline JSON snapshot cache
│   ├── offlineQueue.js           # Offline write operation queue
│   ├── paths.js                  # Cross-platform application data directory resolver
│   └── supabaseClient.js         # Supabase client initializer & connection health monitor
├── src/                          # React frontend application
│   ├── components/               # UI screens & modular components
│   │   ├── POSScreen.jsx         # Counter register with barcode scanner & unit conversion
│   │   ├── MedicinesScreen.jsx   # Inventory management, batch details & stock tracking
│   │   ├── SalesHistoryScreen.jsx# Sale records, receipt reprint & encrypted export/import
│   │   ├── ReturnsScreen.jsx     # Return processing, restock / damage triage & approvals
│   │   ├── ExpiryAlertsScreen.jsx# Expiry monitoring, clearance discounts & write-offs
│   │   ├── PatientsScreen.jsx    # Patient profiles, medical history & credit ledgers
│   │   ├── BranchesScreen.jsx    # Multi-branch pharmacy network configuration
│   │   ├── CategoriesScreen.jsx  # Drug classification & tax rate settings
│   │   ├── SuppliersScreen.jsx   # Supplier vendor directory & contact management
│   │   ├── UsersScreen.jsx       # Staff administration, roles & password resets
│   │   ├── SaasAdminScreen.jsx   # Global platform tenant management & quotas
│   │   ├── SaasPlansScreen.jsx   # Subscription tiers & feature entitlements
│   │   ├── SaasSettingsScreen.jsx# Platform configuration & custom database setup
│   │   ├── CloudSyncScreen.jsx   # Sync engine status, queue inspector & latency monitor
│   │   └── TaxDashboard.jsx      # FBR tax compliance summaries & breakdown
│   ├── contexts/                 # React context providers (AuthContext, NavigationContext)
│   ├── index.css                 # Tailwind utility tokens & clinical design system
│   └── main.jsx                  # React application entry point
├── public/                       # Static public assets, icons, and logos
├── supabase/                     # PostgreSQL database schema & migrations
│   ├── complete_schema.sql       # Complete PostgreSQL schema (19 tables, RLS, triggers & RPCs)
│   ├── data.sql                  # Seed data set with pharmacies, products & categories
│   └── migrations/               # Incremental SQL migration scripts
├── scripts/                      # Maintenance, database migration & testing utilities
├── main.js                       # Electron window lifecycle & bootstrap
├── preload.js                    # Secure contextBridge API exposed to renderer window
├── vite.config.js                # Vite build and development configuration
├── tailwind.config.js            # Tailwind typography, theme & clinical color tokens
├── package.json                  # Node.js project manifest & scripts
├── .env.example                  # Environment variable template
└── .gitignore                    # Git exclusion rules for artifacts, env files & binaries
```

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18.0.0 or higher
- **npm**: v9.0.0 or higher
- A **Supabase** project instance (or self-hosted PostgreSQL database)

### 1. Installation
Clone the repository and install all dependencies:
```bash
git clone https://github.com/UmiCoder29/PharmaCore-.git
cd PharmaCore-
npm install
```

### 2. Environment Configuration
Copy `.env.example` to `.env` and fill in your Supabase project parameters:
```bash
cp .env.example .env
```
Populate the values in `.env`:
```ini
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
SUPABASE_JWKS_URL=https://your-project.supabase.co/auth/v1/.well-known/jwks.json
NODE_ENV=development
```

### 3. Database Initialization
1. Navigate to your **Supabase Dashboard** -> **SQL Editor**.
2. Run the complete schema script: [`supabase/complete_schema.sql`](supabase/complete_schema.sql) (or [`database_master.sql`](database_master.sql)).
3. This creates all 19 relational tables, Row-Level Security (RLS) policies, triggers, stored procedures (`process_sale`, `approve_return`), subscription plans, and baseline demo seed data.

### 4. Running the Application

#### Development Mode
Launches the Vite dev server with Hot Module Replacement (HMR) and starts Electron:
```bash
npm run dev
```

#### Production Build
Builds and minifies the React frontend into `dist/`:
```bash
npm run build
```

#### Packaging Windows Installers
Compiles the application and generates Windows NSIS installers and portable executables in `release/`:
```bash
npm run make
```

---

## ✅ Completed Features

### 🛒 High-Speed Point of Sale (POS)
- **Barcode & Generic Search**: Fast live search across trade names, generic formulas, and barcode scans.
- **Unit & Packaging Dynamics**: Real-time conversion between individual tablets, strips, and full boxes.
- **Flexible Payment Methods**: Cash, Card, Mobile Wallet (JazzCash, EasyPaisa), Bank Transfer, Split Payments, and Customer Credit/Ledger.
- **FBR Compliance**: Digital invoice sequence numbering, QR verification payload, and 80mm/58mm thermal receipt printing.
- **Discounts & Multi-Tax Handling**: Line-item and bill-level discounts with automated category tax calculation.

### 📦 Inventory & Batch Management
- **Multi-Batch Tracking**: Granular tracking of batch numbers, cost price, retail price, and expiry dates.
- **FIFO Batch Allocation**: Automated recommendation and deduction from nearest-expiry batches.
- **Regulatory Drug Control**: Strict flagging for controlled substances, schedules, and prescription-required medicines.
- **Low Stock & Reorder Triggers**: Automatic alert badges when batch quantities fall below defined reorder thresholds.

### 👥 Customer & Prescription Management
- **Patient Profiles**: Contact information, CNIC identification, medical history, and allergy notes.
- **Prescription Attachment**: Link dispensing transactions to prescribing doctor and digital prescription records.
- **Credit Ledger**: Record and reconcile customer credit accounts, running balances, and payment repayments.

### 🔄 Returns & Refund Processing
- **Invoice-Linked Returns**: Full or partial returns validated against historical sale invoices.
- **Triage Workflow**: Restock return items back into inventory or mark as damaged/discarded.
- **Approval System**: Automatic workflow requiring Administrator approval for returns exceeding defined value thresholds.

### 🏢 Multi-Tenant SaaS Architecture
- **Data Segregation**: Row-Level Security (RLS) ensures absolute isolation across tenant organizations.
- **Multi-Branch Hierarchy**: Centralized administrative oversight with branch-level inventory and staff filtering.
- **Subscription Plans**: Starter, Professional, and Enterprise tiers with branch and user quota enforcement.
- **SuperAdmin Portal**: Master dashboard for tenant onboarding, subscription status overrides, and global platform analytics.

### 🔒 Security & Local Vault
- **Context Isolation**: Strict separation between the Electron main process and renderer via `contextBridge`.
- **Local Envelope Encryption**: Scrypt-based password key derivation with AES-256-GCM encrypted keystore.
- **Encrypted Sales Export/Import**: Password-encrypted `.pce` files for secure offline data transport.

---

## ⚠️ Features Pending or Buggy / Technical Debt

The following areas are pending enhancement, in progress, or contain technical debt:

| Area | Description | Status |
| :--- | :--- | :--- |
| **Secret Management** | Maintenance scripts in `scripts/` and root helper files contain hardcoded fallback credentials; these need to be migrated to read exclusively from `process.env`. | In Progress |
| **Sync Engine Cleanup** | `electron/sync.js` is an orphaned legacy file referencing SQLite sync functions (`getPendingSyncs`, `markSynced`) superseded by `localCache.js` and `offlineQueue.js`. | Pending Deprecation |
| **GoTrue Email Validation** | Supabase GoTrue rejects non-standard local domains (e.g., `user@pharmacore.local`) when creating users via auth endpoints. Must use standard email format or configure custom auth domains. | Known Issue |
| **Offline Conflict Resolution** | The offline queue executes replay operations sequentially upon reconnection. Simultaneous multi-counter offline sales on the exact same batch may require manual reconciliation if stock becomes negative. | Pending Enhancement |
| **Inbound REST API Auto-Start** | The Express integration server in `electron/localApi.js` is defined but requires manual enablement via database settings rather than dynamic UI toggle with port selection. | Pending Enhancement |
| **Multi-Branch Realtime Live Push** | Realtime subscription updates for cross-branch stock changes rely on active WebSocket connection; connection recovery after laptop sleep/hibernate requires periodic ping verification. | In Progress |

---

## 📄 License
Private and Proprietary. All rights reserved.
