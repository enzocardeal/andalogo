import { posix } from "node:path";
import type { Readable } from "node:stream";
import { parse } from "csv-parse";
import yauzl, { type Entry, type ZipFile } from "yauzl";

export type ZipEntry = { name: string; size: number; compressedSize: number };

export type Row = Record<string, string>;

function openZip(path: string): Promise<ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (error, zip) => (error ? reject(error) : resolve(zip)));
  });
}

function readEntries(zip: ZipFile): Promise<Entry[]> {
  return new Promise((resolve, reject) => {
    const entries: Entry[] = [];
    zip.on("entry", (entry: Entry) => {
      entries.push(entry);
      zip.readEntry();
    });
    zip.once("end", () => resolve(entries));
    zip.once("error", reject);
    zip.readEntry();
  });
}

function openEntry(zip: ZipFile, entry: Entry): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

export async function listEntries(path: string): Promise<ZipEntry[]> {
  const zip = await openZip(path);
  try {
    const entries = await readEntries(zip);
    return entries
      .filter((entry) => !entry.fileName.endsWith("/"))
      .map((entry) => ({
        name: posix.basename(entry.fileName),
        size: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
      }));
  } finally {
    zip.close();
  }
}

export async function* readCsv(path: string, file: string): AsyncGenerator<Row> {
  const zip = await openZip(path);
  try {
    const entries = await readEntries(zip);
    const entry = entries.find((candidate) => posix.basename(candidate.fileName) === file);
    if (!entry) {
      return;
    }
    const stream = await openEntry(zip, entry);
    yield* stream.pipe(parse({ columns: true, bom: true, skip_empty_lines: true, trim: true, relax_quotes: true }));
  } finally {
    zip.close();
  }
}
