---
status: accepted (resizing superseded by ADR-0050)
---

# Crop pictures without replacing their Media Asset

Teachers need to crop an imported picture down to the part a question uses. The first cut made a new Media Asset from what the crop kept. That lost the rest of the picture for good, so a crop could not be widened again, and it gave the editor nothing to show as a ghost of what was cut away. Teachers also kept missing the one bar Crepe gives for resizing a picture.

**A Picture Crop is an attribute, and the Media Asset stays whole.** A block image carries `crop`: the kept part as `{ left, top, right, bottom }`, fractions 0–1 of the upright picture (after a camera photo's EXIF turn), and Question Bank Record 0.7.0 carries it as the image node's `crop`. Media Assets stay immutable and content-addressed (ADR-0017), and a cropped picture protects the original bytes it names. We did not keep baking new bytes and also remember the original: that would be two truths about one picture.

**The size is a share of the container.** A block image's `size` is the width of what it shows over its container's width, 0.05–1, and Record 0.7.0's `authoredSize` means the same. It replaces Crepe's `ratio`, which measured a drag against the size the picture happened to fit at, could exceed 1, and so could be refused by the record. A picture that only has a `ratio` still draws by the old rule until it is resized or cropped, and records 0.1–0.6 read their `authoredSize` as that ratio, so nothing that already exists moves. Written to 0.7.0, such a picture's size is its share of the Question Content lane, which is exact everywhere but a narrower cell or Panel. A crop keeps what it shows at the size it printed at before, as Google Docs does, by shrinking `size` with it.

**The editor draws its own picture.** Crepe's image-block view is replaced. One click selects a picture and shows a handle at each corner and side. Every one resizes it in proportion, because a picture never distorts; a side follows the pointer along its own axis. A double click, or Enter, opens crop mode in place: black corner and side handles on the kept part, the rest shown faded around it, and a drag inside slides the picture under the crop. A context menu resets the crop and adds or removes the caption. There is no crop dialog. Rotation was left out: nobody has asked for it, and a turned picture's bounding box has no size a teacher would expect.

**Outputs bake the crop where they load media.** PDF, DOCX and Copy take a picture's pixels from one loader, which cuts the kept part from the Media Asset, keyed by source and crop. Word gets those pixels rather than its own `srcRect` crop: the `docx` library writes no crop, and one picture in both formats keeps print and DOCX parity simple. Print and pagination show the crop in CSS on the whole picture, so the Layout Plan measures what prints. An Export Record keeps its Layout Plans (ADR-0014), crop and size included, so a reprint cuts the same pixels again; Versions are named at export and never matched by fingerprint (ADR-0028), so nothing about a crop has to reach the Export Fingerprint.

Resolve Images still makes a picture from a page crop (ADR-0027). Keeping a whole 300 DPI page behind every imported picture would cost far more than widening one of them saves.
