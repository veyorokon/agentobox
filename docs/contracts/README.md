# Contracts

These documents define the operational boundaries that keep Agentobox
mechanical and debuggable.

Each contract names:
- the owner layer
- the source of truth
- the invariants
- the tests that enforce it

Use these docs when:
- debugging a failure
- deciding where a fix belongs
- adding a new regression
- reviewing whether a change crosses a boundary cleanly

## Contract Set

- [Machine](./machine.md)
- [Machine Migration Plan](./machine-migration-plan.md)
- [Provisioning](./provisioning.md)
- [Runtime](./runtime.md)
- [Preview](./preview.md)
- [Release](./release.md)

## Rules

- One boundary, one owner.
- One owner, one source of truth.
- Every resolved failure class should map back to one contract.
- Every contract should have at least one enforcing test lane.
