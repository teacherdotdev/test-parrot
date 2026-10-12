---
status: accepted
---

# Share the Export Document and Layout Plan across output formats

Output formats must not independently reconstruct an Exam. Export derives one format-neutral Export Document and one Layout Plan, then translates that plan through separate print-reference, PDF, and DOCX Export Adapters. The shared representations make semantic content, page assignment, grids, headers, footers, and explicit breaks decisions made once rather than recreated per format.

The Reference PDF captured from the print Export Adapter is the layout oracle. Out-of-band acceptance compares product PDF directly and renders DOCX with a pinned LibreOffice Comparison Engine, requiring the same page count and dimensions, the same ordered content on each page, and the same structural topology. Automatic line wrapping, coordinate-level alignment, raster parity, typography standardization, and layout after a user edits the DOCX are outside this contract.
