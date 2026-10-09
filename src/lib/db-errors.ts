/**
 * Specific client errors for known unique constraints / indexes (instead of the generic 409 CONFLICT).
 * Modules register their own names; the error handler looks them up. Messages are user-facing.
 */
const uniqueViolations = new Map<string, { code: string; message: string }>();

export const registerUniqueViolations = (entries: Record<string, { code: string; message: string }>) => {
  for (const [name, value] of Object.entries(entries)) {
    uniqueViolations.set(name, value);
  }
};

export const uniqueViolationFor = (constraintName: unknown) =>
  typeof constraintName === "string" ? (uniqueViolations.get(constraintName) ?? null) : null;
