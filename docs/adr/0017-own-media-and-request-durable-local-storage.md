---
status: accepted
---

# Own media and request durable local storage

Question Banks, Exams, Working Copies, workspace state, Export Records, Layout Plans, and content-addressed Media Assets live in the fresh IndexedDB generation. Image bytes enter the Media Store when added, deduplicate by content hash, and remain protected while referenced by any Question, saved Exam, Working Copy, or Export Record; only unreferenced assets may be garbage-collected. After the first meaningful Exam or Question Bank state is committed—not for a pristine disposable placeholder—the application requests persistent browser storage. Home explains that data is saved in this browser and important work should be exported or backed up externally, and it warns when persistent storage is denied rather than claiming cloud or archival durability. Failure to commit a shared Question edit or destructive cascade leaves all durable and visible state unchanged; propagation and editor/tab cleanup occur only after commit.
