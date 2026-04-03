# GDA Open Questions

This document tracks the unresolved design questions around Agentobox's
goal-driven autonomy surface.

Unlike `GDA_AXIOMS.md`, these are not settled truths.
They are active design problems.

Use this document to:

- preserve the real questions
- avoid re-litigating settled axioms
- keep the design space explicit
- record what still needs proof through usage

## How To Use This Doc

For each question, try to keep track of:

- what we already know
- what proof is missing
- what the next smallest experiment should be

The goal is not to solve these all in abstraction first.
The goal is to keep the decision surface honest while the system is dogfooded.

## 1. State Reduction

Main question:
- how should admitted observations and executions deterministically change
  canonical project state?

Hard questions:
- what is `State` beyond a generic `facts` blob?
- is state a flat fact bag, structured slices, a graph, or something else?
- how should conflicting observations be represented in reduced state?
- when does a new observation overwrite prior state vs coexist with it?
- how much of reduction can be generic vs world-specific?
- how is provenance preserved through reduction?
- how do freshness and temporal validity affect reduced state?

Why it matters:
- without a real reducer, agents will keep reinterpreting raw history instead of
  reading a mechanically maintained world model

## 2. Goal And Objective Progress

Main question:
- how should goal satisfaction and objective progress be computed mechanically?

Hard questions:
- what is the exact distinction between goal satisfaction and objective
  completion?
- can progress always be predicate-based, or do we need partial/unknown states?
- how should "unknown", "unsatisfied", and "partially satisfied" differ?
- should progress evaluate over current state only, or also over history?
- how do we keep progress generic enough for many project types without becoming
  meaningless?

Why it matters:
- otherwise progress will drift into narrative instead of mechanical truth

## 3. Observation Taxonomy

Main question:
- how should observation kinds be structured so they stay dynamic without
  becoming unreadable?

Hard questions:
- do we need a global taxonomy, a per-world taxonomy, or layered taxonomies?
- when can agents propose new observation kinds?
- how should direct vs derived observations differ?
- what metadata should be mandatory by kind?
- should certain kinds require stricter provenance or source classes?
- how do we prevent arbitrary kind sprawl from degrading state quality?

Why it matters:
- observation admission is deterministic now, but the semantic surface is still
  too loose

## 4. Commitment Authorization

Main question:
- what must be checked mechanically before a commitment can become active?

Hard questions:
- how should capability arguments be validated?
- how should touched scope be validated?
- how should budget be enforced before execution?
- which policy constraints need to be first-class?
- when is a proposal malformed vs unauthorized vs merely low-quality?
- should authorization ever rewrite a proposal into a safer bounded form?

Why it matters:
- capability membership alone is not enough for a safe authority seam

## 5. Policy Context Shape

Main question:
- what exact structure should the meta agent reason over?

Hard questions:
- what fields must always be present?
- what belongs in canonical context vs convenience projection?
- should this be a typed `PolicyContext` instead of a dict?
- how much history should be included by default?
- how should uncertainty and conflicts be surfaced without overwhelming the
  policy layer?

Why it matters:
- the fuzzy side needs a stable seam, not accidental backend formatting

## 6. Lifecycle Result Codes

Main question:
- how should deterministic lifecycle and closure reasons be represented?

Hard questions:
- should close reasons be enums/codes plus structured metadata?
- what are the canonical terminal reason families?
- how do we distinguish execution failure, policy failure, evaluation failure,
  and missing evidence?
- how much detail belongs in the code vs attached metadata?

Why it matters:
- UI, casebase, analytics, and debugging all depend on stable machine-readable
  lifecycle reasons

## 7. Capability Surface

Main question:
- what is a capability in a way that stays generic and mechanically enforceable?

Hard questions:
- does a capability require an argument schema, scope contract, cost hints, and
  expected effects?
- when can agents propose new capabilities?
- how do proposed capabilities become admitted capabilities?
- can some capabilities be mechanical compositions of others?
- where should world-specific capabilities live?

Why it matters:
- the capability boundary is the main mechanical guardrail around execution

## 8. Generic vs World-Specific Extension Points

Main question:
- what belongs in the generic GDA layer versus project/world-specific logic?

Hard questions:
- which abstractions actually survive across coding, ops, research, finance,
  and self-hosting projects?
- where does generality become vagueness?
- what should be pushed into reducers, evaluators, or world packages instead?

Why it matters:
- the kernel stays valuable only if it stays small

## 9. Casebase Derivation

Main question:
- what canonical records are sufficient to derive a useful reusable case?

Hard questions:
- what is the minimum complete record of problem, solution, and outcome?
- how should causal structure be preserved?
- what should be retrieved mechanically vs semantically?
- what should be indexed directly vs embedded?

Why it matters:
- a weak casebase becomes a pile of traces; a strong one becomes reusable memory

## 10. Dynamic Measurement

Main question:
- how should the system represent the need to measure something it does not yet
  know?

Hard questions:
- when should the meta agent propose a new measurement commitment?
- when does measurement require a new capability or monitor?
- how should unknowns be represented before measurement exists?
- how do measurements update state without overcommitting to noisy inputs?

Why it matters:
- many real projects depend on discovering what to measure next, not just
  acting on known facts

## 11. Dogfooding Proof

Main question:
- what is the smallest real workflow that will honestly test the current GDA
  seam?

Hard questions:
- which live project should be used first?
- what exact end-to-end flow must pass?
- what proof level should count as meaningful dogfooding?
- what friction in MCP, context shape, or lifecycle will show us the next real
  gap?

Why it matters:
- real usage should narrow these questions faster than more theory

## Next Practical Step

The next best move is not to answer every question in documents.

It is to:

1. keep the axioms stable
2. dogfood the current GDA seam with a real project
3. record which open questions actually block usage
4. solve those in the smallest honest increments
