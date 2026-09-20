import path from 'node:path';

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

export const getSupportedMimeType = (fileName: string): string | null =>
  MIME_TYPES[path.extname(fileName).toLowerCase()] ?? null;

export const findAvailableFileName = (
  requestedFileName: string,
  existingFileNames: Iterable<string>,
): string => {
  const existing = new Set(
    [...existingFileNames].map((fileName) => fileName.toLocaleLowerCase()),
  );
  if (!existing.has(requestedFileName.toLocaleLowerCase())) {
    return requestedFileName;
  }

  const extension = path.extname(requestedFileName);
  const stem = path.basename(requestedFileName, extension);
  let suffix = 2;
  while (
    existing.has(`${stem} (${suffix})${extension}`.toLocaleLowerCase())
  ) {
    suffix += 1;
  }

  return `${stem} (${suffix})${extension}`;
};
