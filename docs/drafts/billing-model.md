# Billing Model: BYOK vs Platform-Managed

## Two usage modes

### BYOK (Bring Your Own Key)

User supplies their own provider API key (Anthropic, OpenRouter, etc.).
Agentobox never sees or bills for model inference costs.

**What the user pays directly to their provider:**
- All LLM inference (input/output tokens, cache, thinking)
- Provider-specific rate limits and quotas

**What Agentobox tracks (informational, not billed):**
- Token counts and estimated cost via `SessionResult`
- Model usage breakdown per agent/session
- Purpose: user visibility, not billing

**What Agentobox bills:**
- Runtime compute: container time (CPU-seconds, memory-seconds)
- Platform fee (if any): flat or usage-based access fee
- Future: MCP proxy costs if Agentobox operates managed MCP servers

### Platform-Managed

Agentobox provides the API key and bills the user for everything.
User does not need their own provider account.

**What Agentobox bills:**
- LLM inference cost (at provider rates + margin)
- Runtime compute cost
- Platform fee
- Future: MCP costs

**What Agentobox tracks (canonical for billing):**
- `SessionResult.total_cost_usd` — LLM cost per turn
- `RuntimeSegment.compute_seconds` + resource profile → compute cost
- Both feed into the billing ledger

## Cost categories

| Category | Source of truth | BYOK billable? | Platform-managed billable? |
|----------|----------------|----------------|---------------------------|
| LLM inference | `SessionResult` (per-turn token costs) | no (informational) | yes |
| Runtime compute | `RuntimeSegment` (per-container time) | yes | yes |
| Platform access | plan/subscription | yes (if charged) | yes |
| MCP proxy (future) | per-call metering | TBD | yes |

## Canonical records

### SessionResult (already exists)

One row per agent turn. Fields:
- `total_cost_usd` — cumulative LLM cost (corrected for provider pricing)
- `model_usage` — per-model token breakdown
- `duration_ms`, `duration_api_ms` — wall time vs API time

This is the source of truth for LLM cost attribution.

### RuntimeSegment (already exists)

One row per container lifecycle segment. Fields:
- `compute_seconds` — wall time
- `cpu_cores`, `memory_mb` — resource profile
- `provider` — runtime provider (modal, docker)
- `close_reason` — why the segment ended

This is the source of truth for compute cost attribution.

### BillingLedger (does not exist yet)

Canonical immutable record of billable events. Needed for:
- invoice generation
- historical rate snapshots
- dispute resolution
- audit trail

Proposed shape:
```
BillingLedgerEntry
  id: UUID
  project: FK
  agent: FK (nullable for project-level charges)
  category: "llm_inference" | "runtime_compute" | "platform_access" | "mcp_proxy"
  quantity: Decimal (tokens, seconds, calls)
  unit_rate: Decimal (rate at time of event — immutable)
  amount_usd: Decimal (quantity * unit_rate)
  source_id: str (SessionResult.id or RuntimeSegment.id)
  source_type: str ("session_result" | "runtime_segment")
  period_start: datetime
  period_end: datetime
  created_at: datetime
```

Key rule: `unit_rate` is captured at event time and never updated.
If pricing changes, new events get the new rate. Old events keep
their original rate.

## Pricing structure

### Runtime compute pricing

Based on Modal's published rates (or equivalent):
- CPU: ~$0.000463/sec per core
- Memory: ~$0.000058/sec per GB
- GPU: provider-specific rates

Default agent profile: 2 cores, 4GB RAM
→ ~$0.001158/sec → ~$4.17/hour → ~$0.07/min

### LLM inference pricing (platform-managed only)

Pass-through at provider rates + margin.
`MODEL_PRICING` in `registries.py` already has per-model rates.
Margin is a configuration parameter, not hardcoded.

### Platform access (TBD)

Options:
- Free tier with usage caps
- Flat monthly fee
- Usage-based only
- Hybrid (base fee + usage)

Not decided yet — alpha will likely be free + BYOK to learn usage patterns.

## Alpha launch model

For private alpha (#122):
- **BYOK only** — users bring their own Anthropic key
- **Runtime cost: absorbed by Agentobox** — we eat Modal costs during alpha
- **No billing integration** — cost tracking is informational only
- **Goal: learn usage patterns** — how many agents, how long they run, what models, what tasks

This gives us:
- real usage data for pricing decisions
- no billing friction during onboarding
- time to build the billing ledger before charging

## Post-alpha billing sequence

1. **Track** — all cost categories visible in dashboard (informational)
2. **Alert** — spend alerts and project-level budgets
3. **Bill** — Stripe integration with ledger-backed invoices
4. **Control** — auto-stop agents that exceed limits

## Rollup hierarchy

```
User account
  └─ Project
       └─ Agent
            ├─ SessionResult (LLM cost per turn)
            └─ RuntimeSegment (compute cost per segment)
```

Aggregation:
- per-agent: sum of session costs + runtime costs
- per-project: sum of all agent costs
- per-account: sum of all project costs

Already partially implemented:
- `Agent.session_cost_usd` — materialized LLM cost cache
- `Agent.compute_seconds` — materialized runtime cache
- `compute_agent_total_cost()` in serializers.py — async rollup

## Open questions

1. Should BYOK users ever pay for runtime? (Alpha: no. Post-alpha: likely yes.)
2. What's the margin on platform-managed LLM costs? (Competitive analysis needed.)
3. Should per-task cost attribution exist? (Nice for users, complex to implement.)
4. How do MCP costs work? (Per-call? Per-minute? Bundled with runtime?)
5. What spending controls are minimum viable? (Project budget + alert? Per-agent limit?)
