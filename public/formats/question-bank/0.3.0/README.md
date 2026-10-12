# Question Bank Record 0.3.0 fixtures

Superseded by [`../0.4.0/`](../0.4.0/). Test Parrot no longer writes `0.3.0`
records; these fixtures stay so the tests can prove it still reads them.

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/question-bank/0.3.0/schema.json`.
- [`examples/`](examples/) contains the seven canonical conforming records.
- [`invalid/`](invalid/) contains one-purpose counterexamples and an expected
  application error-code manifest.

The prose contract is in
[`docs/question-bank-record-0.3.0.md`](../../../../docs/question-bank-record-0.3.0.md).
All conforming records can be inspected through Test Parrot's public
record-import boundary.
