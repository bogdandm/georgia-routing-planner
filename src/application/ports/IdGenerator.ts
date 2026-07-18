/** Generates opaque identifiers for diagnostics and future domain records. */
export interface IdGenerator {
  generate(): string;
}
