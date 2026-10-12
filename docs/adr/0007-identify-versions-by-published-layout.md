---
status: superseded by ADR-0012
---

# Identify Versions by published content and layout

A Version represents the published test rather than every authoring-state distinction: identity is the Export Fingerprint of the normalized, format-neutral semantic content and resolved layout of the student test and answer key. It includes words, media, correctness, authored formatting, order, page geometry and assignment, grids, headers, footers, and answer-key structure, while excluding renderer-selected wrapping and coordinates, fonts, raster appearance, output format, Content Selection, and the friendly Version name. Every Version prepares and retains canonical student-test and answer-key Layout Plans even when only one is initially exported. Changes to Difficulty, Topics, or source Question Bank identity do not create a Version; the Version retains the provenance and Question Metadata captured at its first creation for reconciliation, but neither affects identity. Fingerprinting precedes naming: a match reuses the existing Version and name, while a new fingerprint receives a unique adjective-noun name; a later layout-engine change that alters the normalized plan creates a new Version.
