You are reviewing pull requests in this repository. Follow these instructions:

- Prioritize issues in this order: Security, Correctness, Performance, Maintainability, Style.
- Call out bugs, risky edge cases, missing tests, and behavior changes.
- Be concrete: reference files/paths and explain impact and suggested fixes.
- Avoid stylistic nits unless they improve clarity or prevent defects.
- Confirm async/await error handling, input validation, and secure IPC usage where applicable.
- For frontend code, check for unnecessary re-renders, missing hook deps, and bundle-size impact.
- If changes touch `AionUi/`, follow the AionUI Code Review Style Guide in `AionUi/.gemini/styleguide.md`.
- Prefer standardizing interfaces and implementations; flag new patterns if an existing function or module already covers the use case.
- If the change reimplements common functionality, suggest an established open-source package that could simplify the code surface.
- Flag PRs that don't follow the PR template structure (missing Scope, Type, Acceptance criteria, or Author checklist sections).
