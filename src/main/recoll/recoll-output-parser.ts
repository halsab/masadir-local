import { AppError, ErrorCode, type MatchRange } from '../../shared/contracts';

export interface ParsedRecollFields {
  fields: string[];
  resultOffset: number;
}

export interface ParsedRecollSnippet {
  pageNumber?: number;
  snippet: string;
}

export interface ParsedRecollSnippets {
  mimeType: string;
  url: string;
  snippets: ParsedRecollSnippet[];
}

const invalidOutput = (): never => {
  throw new AppError(
    ErrorCode.recollOutputInvalid,
    'Recoll вернул некорректный результат.',
  );
};

const parseOutputLines = (stdout: string): string[] => {
  if (!stdout.endsWith('\n')) {
    return invalidOutput();
  }

  const lines = stdout.replace(/\r\n/gu, '\n').split('\n');
  lines.pop();
  if (
    lines.length < 2 ||
    !lines[0].startsWith('Recoll query: ') ||
    !(
      /^\d+ results(?: \(printing {2}\d+ max\):)?$/u.test(lines[1]) ||
      /^Printing at most -?\d+ results from first \d+$/u.test(lines[1])
    )
  ) {
    return invalidOutput();
  }
  return lines;
};

const decodeBase64 = (value: string): string => {
  if (
    value.length === 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
      value,
    )
  ) {
    return value.length === 0 ? '' : invalidOutput();
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(
      Buffer.from(value, 'base64'),
    );
  } catch {
    return invalidOutput();
  }
};

export const parseRecollFieldOutput = (
  stdout: string,
  fieldCount: number,
  firstResult: number,
): ParsedRecollFields[] => {
  if (!Number.isInteger(fieldCount) || fieldCount < 1 || firstResult < 0) {
    return invalidOutput();
  }

  const lines = parseOutputLines(stdout);
  return lines.slice(2).map((line, index) => {
    if (!line.endsWith(' ')) {
      return invalidOutput();
    }
    const encodedFields = line.slice(0, -1).split(' ');
    if (encodedFields.length !== fieldCount) {
      return invalidOutput();
    }
    return {
      fields: encodedFields.map(decodeBase64),
      resultOffset: firstResult + index,
    };
  });
};

const decodePlainText = (value: string): string =>
  value.replace(/&(amp|lt|gt|quot|#39);/gu, (entity) => {
    switch (entity) {
      case '&amp;':
        return '&';
      case '&lt;':
        return '<';
      case '&gt;':
        return '>';
      case '&quot;':
        return '"';
      default:
        return "'";
    }
  });

export const parseRecollSnippetOutput = (
  stdout: string,
): ParsedRecollSnippets => {
  const lines = parseOutputLines(stdout);
  if (lines.length < 3) {
    return invalidOutput();
  }

  const columns = lines[2].split('\t');
  if (
    columns.length !== 6 ||
    !columns[1].startsWith('[') ||
    !columns[1].endsWith(']') ||
    !columns[2].startsWith('[') ||
    !columns[2].endsWith(']') ||
    !/^\d+$/u.test(columns[3]) ||
    columns[4] !== 'bytes' ||
    columns[5] !== ''
  ) {
    return invalidOutput();
  }

  if (lines.length === 3) {
    return {
      mimeType: columns[0],
      url: columns[1].slice(1, -1),
      snippets: [],
    };
  }
  if (lines[3] !== 'SNIPPETS' || lines.at(-1) !== '/SNIPPETS') {
    return invalidOutput();
  }

  const snippets = lines.slice(4, -1).map((line) => {
    const match = /^(-?\d+) : (.*)$/u.exec(line);
    if (match === null) {
      return invalidOutput();
    }
    const parsedPage = Number(match[1]);
    return {
      snippet: decodePlainText(match[2]),
      ...(Number.isSafeInteger(parsedPage) && parsedPage > 0
        ? { pageNumber: parsedPage }
        : {}),
    };
  });

  return {
    mimeType: columns[0],
    url: columns[1].slice(1, -1),
    snippets,
  };
};

const escapeRegularExpression = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');

export const findMatchRanges = (
  snippet: string,
  normalizedQuery: string,
): MatchRange[] => {
  const ranges: MatchRange[] = [];
  const terms = [...new Set(normalizedQuery.split(' ').filter(Boolean))];

  for (const term of terms) {
    const expression = new RegExp(escapeRegularExpression(term), 'giu');
    for (const match of snippet.matchAll(expression)) {
      const start = match.index;
      const end = start + match[0].length;
      if (start >= 0 && end > start && end <= snippet.length) {
        ranges.push({ start, end });
      }
    }
  }

  ranges.sort(
    (left, right) => left.start - right.start || left.end - right.end,
  );
  const merged: MatchRange[] = [];
  for (const range of ranges) {
    const previous = merged.at(-1);
    if (previous !== undefined && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};
