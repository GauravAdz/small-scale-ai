/** Return the first display-name segment without leaking split logic into UI. */
export function firstName(fullName: string): string {
  return fullName.trim().split(/\s+/, 1)[0] || fullName;
}
