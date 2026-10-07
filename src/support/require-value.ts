/** Narrows a scenario fact that an earlier step must have recorded. */
export function requireValue<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`No ${what} was recorded by an earlier step`);
  return value;
}
