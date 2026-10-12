---
status: superseded by ADR-0012
---

# Use the Exam Draft to prepare one Version at a time

The Exam Draft is the only workspace for preparing a Version: there is no separate mutable Export Preview or multi-Version export stage. Each export publishes the current Exam Draft as one immutable, friendly-named Version, then leaves the draft in place; Version History is append-only, and unchanged re-export neither creates a duplicate Version nor needs a separate Export Event. A History drawer can replace the center document with a clean read-only Version without disturbing the draft. **Use as draft** first runs Question Reconciliation and initializes the Exam Draft only with current or newly created Question Bank records, so neither the editor nor historical view needs stale-revision annotations and no historical Version is modified or deleted.
