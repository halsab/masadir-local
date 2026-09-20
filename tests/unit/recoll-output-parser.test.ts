import { describe, expect, it } from 'vitest';

import {
  findMatchRanges,
  parseRecollFieldOutput,
  parseRecollSnippetOutput,
} from '../../src/main/recoll/recoll-output-parser';
import { AppError, ErrorCode } from '../../src/shared/contracts';

const encode = (value: string): string => Buffer.from(value).toString('base64');
const header = 'Recoll query: query\n2 results\n';

const expectInvalid = (action: () => unknown): void => {
  try {
    action();
    throw new Error('Expected parser to reject output');
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(ErrorCode.recollOutputInvalid);
  }
};

describe('Recoll -F output parser', () => {
  it('decodes exact fields, empty values and Unicode', () => {
    const output = `${header}${encode('file:///books/a.pdf')} ${encode('كتاب')}  ${encode('application/pdf')} \n`;

    expect(parseRecollFieldOutput(output, 4, 20)).toEqual([
      {
        fields: ['file:///books/a.pdf', 'كتاب', '', 'application/pdf'],
        resultOffset: 20,
      },
    ]);
  });

  it('rejects malformed base64, wrong field count and truncated output', () => {
    expectInvalid(() => parseRecollFieldOutput(`${header}%%% x y z \n`, 4, 0));
    expectInvalid(() => parseRecollFieldOutput(`${header}YQ== Yg== \n`, 4, 0));
    expectInvalid(() =>
      parseRecollFieldOutput(`${header}YQ== Yg== Yw== ZA== `, 4, 0),
    );
  });
});

describe('Recoll snippets parser', () => {
  it('parses snippets, positive pages and plain text entities', () => {
    const output = [
      'Recoll query: query',
      'Printing at most 0 results from first 4',
      'application/pdf\t[file:///books/a.pdf]\t[Book]\t120\tbytes\t',
      'SNIPPETS',
      '12 : Arabic &lt;term&gt; &amp; text',
      '0 : no page',
      '/SNIPPETS',
      '',
    ].join('\n');

    expect(parseRecollSnippetOutput(output)).toEqual({
      mimeType: 'application/pdf',
      url: 'file:///books/a.pdf',
      snippets: [
        { pageNumber: 12, snippet: 'Arabic <term> & text' },
        { snippet: 'no page' },
      ],
    });
  });

  it('rejects malformed snippet blocks', () => {
    expectInvalid(() =>
      parseRecollSnippetOutput(
        `${header}application/pdf\t[file:///a.pdf]\t[A]\t1\tbytes\t\nSNIPPETS\nbad\n/SNIPPETS\n`,
      ),
    );
  });
});

describe('highlight ranges', () => {
  it('sorts, merges and bounds case-insensitive ranges', () => {
    expect(findMatchRanges('One stone, ONE.', 'one stone')).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 9 },
      { start: 11, end: 14 },
    ]);
  });
});
