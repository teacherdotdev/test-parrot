/** What the list needs of an Image Tag. Structural, so the `/extract` page
 *  plugin can fill the slot without loading the Source Document module. */
type ListedTag = { tag: number; page: number }

/** Where the instructions list a Source Document's Image Tags. */
export const IMAGE_TAGS_SLOT = '{{IMAGE_TAGS}}'

/** What the slot says when no Source Document was uploaded first — a photo,
 *  pasted text, or an assistant fetching `/extract`. */
export const NO_LABELED_COPY =
  'There is no labeled copy of this source: Test Parrot has printed no image tags on it. Write every picture as a Pending Image that names only its page, `"pending": { "page": <n> }`, where `n` is the 1-based page (use 1 for a single photo or a pasted source). Do not estimate where on the page it is: the teacher will crop or add each picture in Test Parrot.'

const NO_TAGS =
  'Test Parrot found no pictures to tag in this document, so none carries a tag. Write any picture you do see, such as a diagram or a picture on a scanned page, as a Pending Image that names its page, `"pending": { "page": <n> }`. Do not estimate where on the page it is: the teacher will crop it in Test Parrot.'

/** A Word document has no fixed pages, so a picture without a tag is named
 *  by page 1, and the teacher uploads it. */
const WORD_UNTAGGED =
  'A Word document has no fixed pages: write any picture without a tag, such as a shape, chart or diagram drawn in Word, as a Pending Image with `"pending": { "page": 1 }`. Do not estimate where it is: the teacher will add it in Test Parrot.'

const NO_WORD_TAGS = `Test Parrot found no pictures stored in this Word document, so none carries a tag. ${WORD_UNTAGGED}`

/** What kind of Source Document the tags were printed on. */
export type TaggedSource = 'pdf' | 'word'

/**
 * The instructions an assistant is given, with their image tag list filled
 * in: the document's tags by page when a Source Document was uploaded first,
 * or a sentence saying there is no labeled copy. Every copy of the
 * instructions — either copy button and the public page — fills the slot
 * here, so an assistant never meets the slot itself.
 */
export function fillImageTags(
  instructions: string,
  tags: readonly ListedTag[] | null,
  source: TaggedSource = 'pdf',
): string {
  return instructions.replace(IMAGE_TAGS_SLOT, () => imageTagList(tags, source))
}

function imageTagList(tags: readonly ListedTag[] | null, source: TaggedSource): string {
  if (tags === null) return NO_LABELED_COPY
  if (source === 'word') {
    if (tags.length === 0) return NO_WORD_TAGS
    return [
      `This is a labeled Word document. Test Parrot put ${tags.length === 1 ? 'a tag' : `${tags.length} tags`} in it, each just before its picture:`,
      '',
      `- ${tags.map(({ tag }) => `IMG ${tag}`).join(', ')}`,
      '',
      WORD_UNTAGGED,
    ].join('\n')
  }
  if (tags.length === 0) return NO_TAGS
  const pages = new Map<number, number[]>()
  for (const { page, tag } of tags) pages.set(page, [...(pages.get(page) ?? []), tag])
  const lines = [...pages].map(
    ([page, numbers]) => `- page ${page}: ${numbers.map((number) => `IMG ${number}`).join(', ')}`,
  )
  return [
    `This is a labeled copy. Test Parrot printed ${tags.length === 1 ? 'one tag' : `${tags.length} tags`} on it:`,
    '',
    ...lines,
  ].join('\n')
}
