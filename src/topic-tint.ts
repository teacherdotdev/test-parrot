/** How many tints a Topic can wear; `.badge-topic` in styles.css and the
 *  Question Bank File's bubbles are each styled for this many. */
export const TOPIC_TINTS = 6

/**
 * The tint a Topic wears, derived from its name rather than stored beside it.
 *
 * That makes one Topic one colour in every row it appears in and in every
 * session, without a colour becoming a second thing about a Topic that has to
 * be kept in step with its name. Which colour a Topic lands on is arbitrary —
 * the point is only that two Topics beside each other usually differ.
 */
export function topicTint(topic: string): number {
  let hash = 0
  for (let index = 0; index < topic.length; index += 1) {
    hash = (hash * 31 + topic.charCodeAt(index)) >>> 0
  }
  return hash % TOPIC_TINTS
}
