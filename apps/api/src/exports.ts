import { listMetrics } from './analytics';
import PDFDocument from 'pdfkit';

export function generateCSV(params: { platform?: string; from?: number; to?: number }) {
  const rows = listMetrics(params);
  const header = ['postId', 'platform', 'likes', 'comments', 'shares', 'impressions', 'at'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push([
      r.postId,
      r.platform,
      String(r.likes),
      String(r.comments),
      String(r.shares),
      r.impressions == null ? '' : String(r.impressions),
      String(r.at)
    ].join(','));
  }
  return lines.join('\n');
}

export function generatePDF(params: { platform?: string; from?: number; to?: number }): Promise<Buffer> {
  return new Promise((resolve) => {
    const rows = listMetrics(params);
    const doc = new PDFDocument({ margin: 36 });
    const chunks: Buffer[] = [];
    doc.on('data', (c) => chunks.push(c as Buffer));
    doc.on('end', () => resolve(Buffer.concat(chunks)));

    doc.fontSize(18).text('ComposR Analytics Report');
    doc.moveDown();
    rows.forEach((r) => {
      doc.fontSize(12).text(`Post ${r.postId} on ${r.platform} — Likes: ${r.likes}, Comments: ${r.comments}, Shares: ${r.shares}, Impr: ${r.impressions ?? '-'} @ ${new Date(r.at).toISOString()}`);
    });

    doc.end();
  });
}
