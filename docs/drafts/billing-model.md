# Billing Model: BYOK vs Platform-Managed

## Document structure

This document has three sections with different authority levels:

1. **Current alpha policy** — what applies now during private alpha
2. **Target billing model** — planned default policy (not yet enforced)
3. **Ledger/accounting contract** — immutable accounting rules

---

## 1. Current Alpha Policy

For private alpha (#122):

- **BYOK only** — users supply their own provider API key
- **Runtime cost: absorbed by Agentobox** — Modal compute is not charged
- **No billing integration** — all cost tracking is informational only
- **No invoices** — no BillingLedger entries are minted

Goal: learn real usage patterns (agent count, session duration, model
mix, task types) without billing friction.

Agentobox observes token usage metadata for visibility even in BYOK
mode, but does not charge users for provider costs.

---

## 2. Target Billing Model

### Two usage modes

#### BYOK (Bring Your Own Key)

User supplies their own provider API key. Agentobox does not charge
for provider inference costs, even though it observes usage metadata
for dashboard visibility.

**Not billed by Agentobox:**
- LLM inference (tokens, cache, thinking) — user pays their provider

**Tracked (informational):**
- Token counts and estimated cost via `SessionResult`
- Model usage breakdown per agent/session

**Planned billable (not yet decided — see open questions):**
- Runtime compute (container time)
- Platform access fee (if any)
- MCP proxy costs (future)

> Note: whether BYOK users pay for runtime compute is an open product
> decision. The default plan is yes, but alpha absorbs this cost.

#### Platform-Managed

Agentobox provides the API key and bills the user for all usage.

**Billed by Agentobox:**
- LLM inference (at provider rates + margin)
- Runtime compute
- Platform access fee
- MCP proxy costs (future)

### Cost categories

| Category | Source of truth | BYOK | Platform-managed |
|----------|----------------|------|------------------|
| LLM inference | `SessionResult` | informational | billable |
| Runtime compute | `RuntimeSegment` | planned billable (TBD) | billable |
| Platform access | plan/subscription | TBD | billable |
| MCP proxy (future) | per-call metering | TBD | billable |

### Pricing

Runtime and model pricing come from **versioned rate tables**, not
hardcoded values. Rates are captured into ledger events at the time
of the billable event. If provider pricing changes, new events use
the new rate; old events keep their original rate.

Rate tables should be:
- versioned (effective date + rate)
- referenced by ledger entries (rate_version field)
- separate from business logic

Illustrative current rates (not authoritative — subject to change):
- Modal CPU: ~$0.000463/sec/core
- Modal memory: ~$0.000058/sec/GB
- Default agent (2 cores, 4GB): ~$0.07/min

A `RUNTIME_PRICING` registry (analogous to `MODEL_PRICING`) should
map runtime providers to per-resource rates.

---

## 3. Ledger / Accounting Contract

### Canonical rule

**Invoices come from BillingLedger, never directly from SessionResult
or RuntimeSegment.**

Source tables (`SessionResult`, `RuntimeSegment`) are operational
records. They track what happened. The `BillingLedger` is the
accounting record of what is chargeable. These are different concerns.

### Source records (operational — already exist)

#### SessionResult

One row per agent turn. Tracks LLM usage.
- `total_cost_usd` — cumulative LLM cost (corrected for provider)
- `model_usage` — per-model token breakdown
- Not directly billable. Feeds ledger minting.

#### RuntimeSegment

One row per container lifecycle segment. Tracks compute usage.
- `compute_seconds` — wall time
- `cpu_cores`, `memory_mb` — resource profile
- `provider` — runtime provider
- Not directly billable. Feeds ledger minting.

### BillingLedger (does not exist yet)

Immutable accounting record of billable events.

```
BillingLedgerEntry
  id: UUID
  project: FK
  agent: FK (nullable for project-level charges)
  category: "llm_inference" | "runtime_compute" | "platform_access"
  quantity: Decimal
  unit: str ("tokens" | "seconds" | "months")
  unit_rate: Decimal (captured at event time — immutable)
  rate_version: str (reference to the rate table version)
  amount_usd: Decimal (quantity * unit_rate)
  source_id: str (SessionResult.id or RuntimeSegment.id)
  source_type: str ("session_result" | "runtime_segment")
  period_start: datetime
  period_end: datetime
  created_at: datetime
```

### Minting rules

A ledger entry is minted when:
- A `RuntimeSegment` closes (compute cost)
- A `SessionResult` is created (LLM cost, platform-managed only)
- A billing period ends (platform access fee)

Ledger entries are:
- **append-only** — never updated or deleted
- **immutable rates** — `unit_rate` captured at minting time
- **auditable** — `source_id` + `source_type` trace back to operational record

### Invoice generation

Invoices aggregate ledger entries by project and billing period.
They never query SessionResult or RuntimeSegment directly.

```
Invoice = sum(BillingLedgerEntry.amount_usd)
  WHERE project = X
  AND period_start >= billing_period_start
  AND period_end <= billing_period_end
```

### Rollup hierarchy

```
User account
  └─ Project
       └─ Agent
            ├─ SessionResult → LedgerEntry (LLM)
            └─ RuntimeSegment → LedgerEntry (compute)
```

Aggregation:
- per-agent: sum of agent's ledger entries
- per-project: sum of all agents' ledger entries
- per-account: sum of all projects' ledger entries

---

## Open questions

1. Should BYOK users pay for runtime compute? (Alpha: no. Default plan: yes. Not yet decided.)
2. What margin on platform-managed LLM costs? (Competitive analysis needed.)
3. Per-task cost attribution? (Nice for users, complex.)
4. MCP cost model? (Per-call? Per-minute? Bundled?)
5. Minimum spending controls? (Project budget + alert? Per-agent limit?)
6. When does ledger minting begin? (Post-alpha when billing is wired.)

## Post-alpha billing sequence

1. **Track** — all cost categories visible in dashboard (informational)
2. **Alert** — spend alerts and project-level budgets
3. **Mint** — ledger entries from operational records
4. **Bill** — Stripe integration with ledger-backed invoices
5. **Control** — auto-stop agents that exceed limits
