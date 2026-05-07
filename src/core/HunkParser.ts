import * as crypto from 'crypto';
import { Hunk, FileChange, ParsedFileDiff, FileStatus } from '../types/index';
import { normalizePath } from '../utils/pathUtils';

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;
const NEW_FILE_RE = /^new file mode/;
const DELETED_FILE_RE = /^deleted file mode/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const BINARY_RE = /^Binary files/;
const INDEX_RE = /^index /;

function sha1(input: string): string {
  return crypto.createHash('sha1').update(input).digest('hex').substring(0, 12);
}

function generateHunkId(filePath: string, header: string, lines: string[]): string {
  // Strip line numbers from header so the ID stays stable across line shifts.
  const headerAnchor = header.replace(
    /@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/,
    '@@',
  );
  const contentSample = lines.slice(0, 8).join('\n');
  return sha1(`${filePath}:${headerAnchor}:${contentSample}`);
}

function generateContentFingerprint(lines: string[]): string {
  const changeLinesOnly = lines
    .filter((l) => l.startsWith('+') || l.startsWith('-'))
    .join('\n');
  return sha1(changeLinesOnly);
}

export function parseGitDiff(
  rawDiff: string,
  repoRoot: string,
): Map<string, ParsedFileDiff> {
  const normalizedRoot = normalizePath(repoRoot);
  const result = new Map<string, ParsedFileDiff>();

  if (!rawDiff || !rawDiff.trim()) {
    return result;
  }

  const allLines = rawDiff.split('\n');
  let i = 0;

  let currentFilePath = '';
  let currentOldPath = '';
  let currentNewPath = '';
  let currentStatus: FileStatus = 'M';
  let currentIsBinary = false;
  let currentFileHeader = '';
  let currentHunks: Hunk[] = [];
  let currentHunkLines: string[] = [];
  let currentHunkHeader = '';
  let currentOldStart = 0;
  let currentOldCount = 0;
  let currentNewStart = 0;
  let currentNewCount = 0;
  let inHunk = false;

  function finalizeHunk(): void {
    if (!inHunk || !currentHunkHeader) return;
    const hunk: Hunk = {
      id: generateHunkId(currentFilePath, currentHunkHeader, currentHunkLines),
      header: currentHunkHeader,
      oldStart: currentOldStart,
      oldCount: currentOldCount,
      newStart: currentNewStart,
      newCount: currentNewCount,
      lines: [...currentHunkLines],
      contentFingerprint: generateContentFingerprint(currentHunkLines),
    };
    currentHunks.push(hunk);
    currentHunkLines = [];
    inHunk = false;
  }

  function finalizeFile(): void {
    finalizeHunk();
    if (!currentFilePath) return;

    const absolutePath = normalizePath(normalizedRoot + '/' + currentNewPath);
    const fileChange: FileChange = {
      absolutePath,
      relativePath: normalizePath(currentNewPath),
      repoRootPath: normalizedRoot,
      status: currentStatus,
      oldPath: currentOldPath !== currentNewPath
        ? normalizePath(currentOldPath)
        : undefined,
      isBinary: currentIsBinary,
    };

    result.set(absolutePath, {
      fileChange,
      hunks: [...currentHunks],
      fileHeader: currentFileHeader,
    });

    // Reset
    currentFilePath = '';
    currentOldPath = '';
    currentNewPath = '';
    currentStatus = 'M';
    currentIsBinary = false;
    currentFileHeader = '';
    currentHunks = [];
    currentHunkLines = [];
    currentHunkHeader = '';
    inHunk = false;
  }

  while (i < allLines.length) {
    const line = allLines[i];

    // New file diff header
    const diffMatch = line.match(DIFF_HEADER_RE);
    if (diffMatch) {
      finalizeFile();
      currentOldPath = diffMatch[1];
      currentNewPath = diffMatch[2];
      currentFilePath = currentNewPath;
      currentFileHeader = line;
      i++;

      // Parse metadata lines until @@ or next diff
      while (i < allLines.length) {
        const metaLine = allLines[i];

        if (metaLine.match(DIFF_HEADER_RE) || metaLine.match(HUNK_HEADER_RE)) {
          break;
        }

        currentFileHeader += '\n' + metaLine;

        if (NEW_FILE_RE.test(metaLine)) {
          currentStatus = 'A';
        } else if (DELETED_FILE_RE.test(metaLine)) {
          currentStatus = 'D';
        } else if (BINARY_RE.test(metaLine)) {
          currentIsBinary = true;
        }

        const renameFromMatch = metaLine.match(RENAME_FROM_RE);
        if (renameFromMatch) {
          currentOldPath = renameFromMatch[1];
          currentStatus = 'R';
        }
        const renameToMatch = metaLine.match(RENAME_TO_RE);
        if (renameToMatch) {
          currentNewPath = renameToMatch[1];
          currentFilePath = currentNewPath;
        }

        i++;
      }
      continue;
    }

    // Hunk header
    const hunkMatch = line.match(HUNK_HEADER_RE);
    if (hunkMatch) {
      finalizeHunk();
      currentHunkHeader = line;
      currentOldStart = parseInt(hunkMatch[1], 10);
      currentOldCount = hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
      currentNewStart = parseInt(hunkMatch[3], 10);
      currentNewCount = hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;
      currentHunkLines = [];
      inHunk = true;
      i++;
      continue;
    }

    // Hunk body lines
    if (inHunk) {
      if (
        line.startsWith('+') ||
        line.startsWith('-') ||
        line.startsWith(' ') ||
        line.startsWith('\\')
      ) {
        currentHunkLines.push(line);
        i++;
        continue;
      }
      // Empty line could be context with empty content
      if (line === '') {
        // Check if next line is still hunk content or a new section
        const nextLine = allLines[i + 1];
        if (
          nextLine !== undefined &&
          (nextLine.startsWith('+') ||
            nextLine.startsWith('-') ||
            nextLine.startsWith(' ') ||
            nextLine.startsWith('\\'))
        ) {
          currentHunkLines.push(line);
          i++;
          continue;
        }
        // End of hunk
        finalizeHunk();
        i++;
        continue;
      }
      // Non-hunk line ends hunk
      finalizeHunk();
      // Don't increment, re-process this line
      continue;
    }

    i++;
  }

  // Finalize last file
  finalizeFile();

  return result;
}
