import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { parse } from 'csv-parse/sync';

export type ParsedRow = Record<string, unknown>;

export const readUploadToBuffer = async (file) => {
  const filepath = file?.filepath || file?.path;
  const originalFilename = file?.originalFilename || file?.name || 'upload';

  if (!filepath) throw new Error('アップロードファイルが不正です');

  const buf = await fs.promises.readFile(filepath);
  const filename = String(originalFilename);

  return { buf, filename };
};

const parseExcel = (buf: Buffer): ParsedRow[] => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  const sheetName = wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: '' }) as ParsedRow[];
};

const parseCsvUtf8 = (buf: Buffer): ParsedRow[] => {
  const text = buf.toString('utf8');
  const records = parse(text, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as ParsedRow[];

  return records;
};

export const parseImportFile = (buf: Buffer, filename: string): ParsedRow[] => {
  const ext = path.extname(filename || '').toLowerCase();

  if (ext === '.xlsx' || ext === '.xls') return parseExcel(buf);
  if (ext === '.csv') return parseCsvUtf8(buf);

  return parseExcel(buf);
};
