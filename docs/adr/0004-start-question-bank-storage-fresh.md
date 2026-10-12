---
status: superseded by ADR-0015
---

# Start Question Bank storage fresh

The Question Bank and Exam Draft model will use a new storage generation and will not migrate drafts or mutable saved Versions written by earlier schemas. The application will ignore, rather than actively delete, the old browser storage so implementation can replace the rejected ownership model without compatibility machinery; teachers will begin with an empty Question Bank and Exam Draft after the upgrade.
