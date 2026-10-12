---
status: accepted
---

# Give an AI the instructions as a file

Teachers copied the conversion instructions and pasted them into their AI chat. At about 46,000 characters they are longer than Gemini's chat box takes: it kept the first 32,000 and dropped the rest without a warning. What it dropped was the image rules and the Source Document's image tag list, so Gemini converted tests without knowing which pictures were tagged.

Every copy of the instructions Test Parrot gives a teacher is now a text file they download and attach, beside the labeled copy of their test. An attachment is read whole by every assistant, and the instructions can keep growing without meeting a limit that differs from one chat to the next. A file made for a Source Document is named after it, “Unit 3 Test (instructions).txt”, since its tag list belongs to that test. The file opens by saying what it is for, so the teacher sends the two attachments with nothing to type or paste.

We rejected trimming the instructions under the limit, because a third of them would have to go and they would grow back past it, and splitting them across two pastes, because a teacher who sends only one gets a conversion that looks right and is not. The public `/extract` page, which an assistant fetches itself, still offers the text to copy.
