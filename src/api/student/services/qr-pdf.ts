import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import path from 'path';
import fs from 'fs';

export type StudentPrintRow = {
  name: string;
  name_kana: string;
  qr_token: string;
  className: string;
};

export type ClassGroup = { className: string; rows: StudentPrintRow[] };

type Logger = { warn: (msg: string) => void };

const MARGIN_X = 36;
const MARGIN_Y = 52;

const JP_FONT_PATH = path.resolve(process.cwd(), 'assets/fonts/NotoSansJP-Regular.ttf');

const createPdf = (logger?: Logger) => {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN_Y, bottom: MARGIN_Y, left: MARGIN_X, right: MARGIN_X },
  });

  const hasFont = fs.existsSync(JP_FONT_PATH);
  if (hasFont) doc.registerFont('jp', JP_FONT_PATH);
  else logger?.warn?.(`[qr-pdf] JP フォントが見つかりません: ${JP_FONT_PATH}`);

  const setFont = () => doc.font(hasFont ? 'jp' : 'Helvetica');

  return { doc, setFont, hasFont };
};

const docToBuffer = (doc: PDFKit.PDFDocument) => {
  const chunks: Buffer[] = [];
  doc.on('data', (c) => chunks.push(c));

  return new Promise<Buffer>((resolve, reject) => {
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
  });
};

const qrToImageBuffer = async (token: string, px: number) => {
  const dataUrl = await QRCode.toDataURL(token, { margin: 0, width: px });
  const base64 = dataUrl.split(',')[1] ?? '';
  return Buffer.from(base64, 'base64');
};

const renderGroupsGrid = async (
  doc: PDFKit.PDFDocument,
  setFont: () => void,
  groups: ClassGroup[]
) => {
  const pageW = doc.page.width;
  const pageH = doc.page.height;

  const usableW = pageW - MARGIN_X * 2;
  const usableH = pageH - MARGIN_Y * 2;

  const gridTop = MARGIN_Y;
  const gridH = usableH;

  const COLS = 1;
  const ROWS = 2;
  const CELL_GAP_Y = 104;

  const cellW = usableW / COLS;
  const cellH = (gridH - CELL_GAP_Y * (ROWS - 1)) / ROWS;

  const drawCell = async (r: StudentPrintRow, cellX: number, cellY: number) => {
    setFont();

    const pad = 8;
    const x = cellX + pad;
    const y = cellY + pad;
    const w = cellW - pad * 2;
    const h = cellH - pad * 2;

    const BRAND_FS = 13;
    const CLASS_FS = 12;
    const NAME_FS = 15;

    const LH = 1.2;
    const GAP = 4;

    const brandH = Math.ceil(BRAND_FS * LH);
    const classH = Math.ceil(CLASS_FS * LH);
    const nameH = Math.ceil(NAME_FS * LH);

    const brandY = y;
    const classY = brandY + brandH + GAP;
    const nameY = classY + classH + GAP;

    doc.fontSize(BRAND_FS).text('すてむくらぶ', x, brandY, { width: w, align: 'left', lineGap: 0 });

    const cls = String(r.className ?? '').trim() || '-';
    doc.fontSize(CLASS_FS).text(`クラス: ${cls}`, x, classY, {
      width: w,
      align: 'left',
      ellipsis: true,
      lineGap: 0,
    });

    const nm = String(r.name ?? '').trim() || '-';
    const kana = String(r.name_kana ?? '').trim();
    const nameLine = kana ? `${nm} (${kana})` : nm;

    doc
      .fontSize(NAME_FS)
      .text(nameLine, x, nameY, { width: w, align: 'left', ellipsis: true, lineGap: 0 });

    const QR_SIZE = 170;
    const textBlockH = nameY - y + nameH;
    const qrAreaY = y + textBlockH + 8;
    const qrAreaH = h - (qrAreaY - y);

    const qrX = x + (w - QR_SIZE) / 2;
    const qrY = qrAreaY + Math.max(0, (qrAreaH - QR_SIZE) / 2);

    const qrBuf = await qrToImageBuffer(r.qr_token, QR_SIZE * 2);
    doc.image(qrBuf, qrX, qrY, { width: QR_SIZE, height: QR_SIZE });

    doc.rect(cellX, cellY, cellW, cellH).strokeOpacity(0.12).stroke().strokeOpacity(1);
  };

  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (gi > 0) doc.addPage();

    const totalPages = Math.max(1, Math.ceil(g.rows.length / 2));

    for (let p = 0; p < totalPages; p++) {
      if (p > 0) doc.addPage();

      for (let slot = 0; slot < 2; slot++) {
        const i = p * 2 + slot;

        const cellX = MARGIN_X;
        const cellY = gridTop + slot * (cellH + CELL_GAP_Y);

        const r = g.rows[i];
        if (!r) {
          doc.rect(cellX, cellY, cellW, cellH).strokeOpacity(0.08).stroke().strokeOpacity(1);
          continue;
        }
        await drawCell(r, cellX, cellY);
      }
    }
  }
};

export const buildQrPdfBufferByClass = async (groups: ClassGroup[], logger?: Logger) => {
  const { doc, setFont } = createPdf(logger);
  const done = docToBuffer(doc);

  await renderGroupsGrid(doc, setFont, groups);

  doc.end();
  return done;
};
