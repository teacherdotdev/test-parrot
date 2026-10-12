# Test Parrot Package 0.1.0 fixtures

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/package/0.1.0/schema.json`.
- [`examples/`](examples/) contains conforming packages: a bank with an Exam, a
  bank alone, two Exam versions sharing one bank, an Exam drawing on two banks, and
  a printed test as an assistant converts it, with its own Sections in printed order.
- [`invalid/`](invalid/) contains one-purpose counterexamples and an expected
  application error-code manifest.

Test Parrot writes a package as a zip: `parrot.json`, the package, at its root,
and each picture a Question Bank Record 0.8.0 Media Asset names under `media/`.
The zip is attached to Question Bank Files and to Exam PDFs that include the
answer key as `parrot.zip` (`application/zip`, description
`pdf-canonical-extraction`), and downloads on its own as `*.parrot.zip`. A bare
JSON package, as these fixtures are, is still accepted.

The prose contract is in
[`docs/test-parrot-package-0.1.0.md`](../../../../docs/test-parrot-package-0.1.0.md).
