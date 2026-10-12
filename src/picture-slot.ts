import { createContext, type ReactNode } from 'react'

/**
 * How a preview draws a picture it lets the teacher change: given the key
 * written on the image node (`pictureKey`) and the picture as it would print,
 * it returns what to show in its place. Without one, every picture is drawn
 * exactly as it prints — which is how a page is measured, so a preview that
 * adds to a picture must add nothing that takes up room.
 */
export type PictureSlot = (key: string, picture: ReactNode, inline: boolean) => ReactNode

export const PictureSlotContext = createContext<PictureSlot | null>(null)
