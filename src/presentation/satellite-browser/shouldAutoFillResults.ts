/** Returns whether more cards are needed to occupy most of the results viewport. */
export function shouldAutoFillResults(
  contentHeight: number,
  viewportHeight: number,
): boolean {
  return viewportHeight > 0 && contentHeight < viewportHeight * 0.85;
}
