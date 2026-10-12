# Question Bank Record 0.8.0 fixtures

Superseded by [`../0.9.0/`](../0.9.0/). Test Parrot no longer writes `0.8.0`
records; these fixtures stay so the tests can prove it still reads them.

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/question-bank/0.8.0/schema.json`.
- [`examples/`](examples/) contains the eleven canonical conforming records.
- [`invalid/`](invalid/) contains one-purpose counterexamples and an expected
  application error-code manifest.

A `0.8.0` Media Asset names its `file` in the package's zip instead of carrying
base64 `bytes`. Each fixture directory is laid out as that zip is: a record's
`file` paths resolve against the directory the record sits in, so
[`examples/media/`](examples/media/) and [`invalid/media/`](invalid/media/)
hold the picture files the records name.

The prose contract is in
[`docs/question-bank-record-0.8.0.md`](../../../../docs/question-bank-record-0.8.0.md).
All conforming records can be inspected through Test Parrot's public
record-import boundary, given the files beside them.

[`../0.7.0/`](../0.7.0/), [`../0.6.0/`](../0.6.0/), [`../0.5.0/`](../0.5.0/), [`../0.4.0/`](../0.4.0/), [`../0.3.0/`](../0.3.0/), [`../0.2.0/`](../0.2.0/) and [`../0.1.0/`](../0.1.0/)
are the superseded versions Test Parrot still reads.
