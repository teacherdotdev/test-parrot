# Exam Record 0.3.0 fixtures

Superseded by [`../0.4.0/`](../0.4.0/). Test Parrot no longer writes `0.3.0`
records; these fixtures stay so the tests can prove it still reads them.

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/exam/0.3.0/schema.json`.
- [`examples/`](examples/) contains conforming Exam Records. An Exam Record is
  importable only inside a Test Parrot Package. A Section holds Questions of any
  type. `sections.json` has a Warm-up Section holding a Multiple Choice and a
  True/False Question, a Short Answer Section whose directions are cleared, a
  Challenge Section holding a Multiple Choice and a Matching Question, and an
  empty Extra Credit Section; it prints every heading large and its text small,
  and rewords the first page's header line.
- Invalid counterexamples are with the package, in
  [`../../package/0.1.0/invalid/`](../../package/0.1.0/invalid/).

The prose contract is in
[`docs/exam-record-0.3.0.md`](../../../../docs/exam-record-0.3.0.md).
