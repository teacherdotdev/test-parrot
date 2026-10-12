# Question Bank Record 0.10.0 fixtures

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/question-bank/0.10.0/schema.json`.
- [`examples/`](examples/) contains the sixteen canonical conforming records.
- [`invalid/`](invalid/) contains one-purpose counterexamples and an expected
  application error-code manifest.

A `0.10.0` bank may hold `fill-in-the-blank` Questions, each a sentence
written with one or more `blank` nodes in its stem, holding the answers a
student writes there. As in `0.9.0`, a choice may say it is a Locked Answer with `locked`, which keeps its
position when answers are shuffled; a Multipart Part may hold `subparts`
in place of its own answers; and a Question, a Part or a Subpart that answers
may carry `points`, what answering it is worth — never a Multipart Question or a
Part that holds Subparts, whose worth is always the sum of their parts. A
paragraph, block image or table may be centred with `"align": "center"`. As in `0.8.0`, a Media Asset names its
`file` in the package's zip instead of carrying base64 `bytes`. Each fixture
directory is laid out as that zip is: a record's
`file` paths resolve against the directory the record sits in, so
[`examples/media/`](examples/media/) and [`invalid/media/`](invalid/media/)
hold the picture files the records name.

The prose contract is in
[`docs/question-bank-record-0.10.0.md`](../../../../docs/question-bank-record-0.10.0.md).
All conforming records can be inspected through Test Parrot's public
record-import boundary, given the files beside them.

[`../0.9.0/`](../0.9.0/), [`../0.8.0/`](../0.8.0/), [`../0.7.0/`](../0.7.0/), [`../0.6.0/`](../0.6.0/), [`../0.5.0/`](../0.5.0/), [`../0.4.0/`](../0.4.0/), [`../0.3.0/`](../0.3.0/), [`../0.2.0/`](../0.2.0/) and [`../0.1.0/`](../0.1.0/)
are the superseded versions Test Parrot still reads.
