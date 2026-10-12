# Exam Record 0.5.0 fixtures

- [`schema.json`](schema.json) is a version-pinned copy of the public schema whose
  stable identifier is `https://testparrot.com/formats/exam/0.5.0/schema.json`.
- [`examples/`](examples/) contains conforming Exam Records. An Exam Record is
  importable only inside a Test Parrot Package. A Section holds Questions of any
  type. `sections.json` has a Warm-up Section holding a Multiple Choice and a
  True/False Question, a Short Answer Section whose directions are cleared, a
  Challenge Section holding a Multiple Choice and a Matching Question, and an
  empty Extra Credit Section; it prints every heading large and its text small,
  and rewords the first page's header line. `margins.json` is the same Exam with
  its own Page Margins: an inch at the top and bottom, 0.6 inch on the right and
  an inch and a quarter on the left. `paper-style.json` prints its questions
  in the Classic Paper Style, and its Short Answer position sets its Work
  Space to none on purpose, so it prints no answer lines though the style would
  rule them there. `minimal.json` sets none of the new members, and prints
  today's margins in the Standard Paper Style with every answer shown.
- `hidden-answers.json` has a Multiple Choice position that shows its answers
  in a shuffled order and leaves one incorrect answer off.
- `picture-sizes.json` has a Short Answer position that prints its Question's
  first block picture at 45% of its container and its third across the whole
  container: Exam Picture Sizes, naming each picture by its place among the
  Question's block pictures.
- Invalid counterexamples are with the package, in
  [`../../package/0.1.0/invalid/`](../../package/0.1.0/invalid/).

The prose contract is in
[`docs/exam-record-0.5.0.md`](../../../../docs/exam-record-0.5.0.md).
