---
status: accepted
---

# Make and merge Sections on purpose

ADR-0029 said a Section is created only by putting a Question somewhere no existing Section is, and removed only by deleting it. That left a teacher no direct way to cut one Section in two, to gather some Questions into a Section of their own, to open an empty Section to drag into, or to join two Sections back together. Each took a drag to the new-Section target, or a delete and a re-add. This amends ADR-0029: a Section can now also be made and merged on purpose. Every one of these is a single structural edit — one undo step, written to the Working Copy like any other — and numbering, Vary and the Answer Key follow from the Sections as before, because they were always derived from them.

## Making a Section

- **Insert new section below**, from a Question's context menu, splits its Section after it: the Questions after it in the same Section move into a new Section directly below. On the last Question of its Section it inserts an empty Section below instead. Nothing moves on the page but a heading. (It was first “Start new section here”, which split before the Question; teachers reach for a Section below the one they are pointing at.)
- **Move to new section**, from the context menu of a selection of several Questions, makes them one new Section in the order they print, placed where the first of them was. The Section that Question was in is split around them: what came before stays in it, and what came after begins a Section of its own. A selection that begins its Section becomes a new Section directly above it, so no split is needed. A selection that is already exactly one whole Section changes nothing, and the row is disabled. Any other Section the move empties stays with its wording, exactly as a Section a drag empties does — ADR-0029's reason holds: an emptied Section is ordinary editing, and removing it would destroy wording the teacher may want back.
- **Insert section above**, from a Section's more menu, makes an empty Section directly above it; a Section below one is inserted above the Section after it. With no Question to take wording from, it begins with the heading "New section" and no directions, and its heading takes focus with that text selected, ready to be typed over. A Section with neither part would be drawn at no height — no heading to drop into and nothing to type on — so a visible placeholder heading was preferred to an empty one. Like any empty Section, it stays and prints until deleted.

## Wording a new Section

ADR-0029 worded a new Section for the type of the first Question put in it. That was right for one Question and wrong for several of mixed types: the directions of the first one's type told a student how to answer only some of them. Every Section made from Questions — the first Add or Add all onto an empty Exam, several Questions dragged onto the new-Section target, a move into a new Section, Insert new section below and Move to new section, and the rest of a split Section — now begins with the default heading and directions of their type only when every Question in it is the same Question Type. When they mix types it begins untitled: both parts empty, so it prints nothing above its Questions, and the Answer Key names it by its place, as it does any cleared heading. On the sheet an untitled Section is labelled faintly, in the gap above it and taking no room, so where it begins can be seen without pointing at it; its gutter already offers to add a heading.

Questions dragged or added together keep the order they were dragged or listed in. They are never sorted by type and never split into a Section per type: one gesture makes at most one Section.

## Merging Sections

**Merge with section above**, from a Section's more menu, moves the Questions of the Section above into this one, in the order they already print, under this Section's wording, and deletes the emptied neighbour; merging with the Section below is the same action taken from that Section. Merge is the second way a Section is removed on purpose, beside delete; unlike delete it Removes no Questions. It is disabled on the first Section.

## The Section's more menu

The gutter's up, down and delete stay as they were, and a fourth button, "⋯", opens the rest. A flat list of four rows each saying "section" was rejected as noisy for actions taken rarely, and so, once used, were two rows each offering Above and Below as small inline choices: a direction is one more thing to read for an action the next Section's own menu already offers. The menu is two plain actions, "Insert section above", with a glyph of a row added over a Section, and "Merge with section above", the latter disabled where there is no Section above. Moving a Section stays with the arrows. The Section stays highlighted while its menu is open, as it is while its controls are pointed at. On the sheet a Section's dashed rules mark only its real top and foot: a Section that runs over a page break draws no rule at the break on either sheet, so the missing rule reads as "continued", while its highlight still covers each sheet's part and its controls still appear at the top of each part.

## Dropping below the last Section

A drag held at the foot of the last Section opens the new-Section target beneath it, as before. Released below that target, the drag used to land at the nearest line — the foot of the last Section — and the Question went into that Section instead of a new one. Now, when the open target is at the foot of the whole Exam, with nothing beneath it to land on but the Questions being carried, a release anywhere below it makes the new Section. Between Sections nothing changes: going lower there means the next Section, and the nearest line still decides.
