/** When an export was made, as a teacher reads it. */
export function exportTime(createdAt: string): string {
  const date = new Date(createdAt)
  return Number.isNaN(date.getTime())
    ? createdAt
    : new Intl.DateTimeFormat(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(date)
}
