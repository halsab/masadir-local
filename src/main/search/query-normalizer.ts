const MAX_QUERY_CODE_POINTS = 256;

export const normalizeQuery = (query: string): string =>
  Array.from(
    query
      .trim()
      .replace(/\p{Cc}/gu, '')
      .replace(/[\*?\[\]"]/gu, ' ')
      .replace(/\s+/gu, ' ')
      .trim(),
  )
    .slice(0, MAX_QUERY_CODE_POINTS)
    .join('')
    .trim();
