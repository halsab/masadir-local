import type { MatchRange } from '../shared/contracts';

export const validatedMatchRanges = (
  text: string,
  ranges: readonly MatchRange[],
): MatchRange[] => {
  const valid = ranges
    .filter(
      ({ start, end }) =>
        Number.isInteger(start) &&
        Number.isInteger(end) &&
        start >= 0 &&
        start < end &&
        end <= text.length,
    )
    .sort((left, right) => left.start - right.start || left.end - right.end);

  const merged: MatchRange[] = [];
  for (const range of valid) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};

export const appendHighlightedText = (
  container: HTMLElement,
  text: string,
  ranges: readonly MatchRange[],
): void => {
  let offset = 0;
  for (const range of validatedMatchRanges(text, ranges)) {
    if (range.start > offset) {
      container.append(document.createTextNode(text.slice(offset, range.start)));
    }
    const mark = document.createElement('mark');
    mark.textContent = text.slice(range.start, range.end);
    container.append(mark);
    offset = range.end;
  }
  if (offset < text.length) {
    container.append(document.createTextNode(text.slice(offset)));
  }
};
