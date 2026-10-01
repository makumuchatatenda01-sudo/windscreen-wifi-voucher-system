'use strict';

const PDFDocument = require('pdfkit');
const fs = require('fs');

const BLUE = '#1168d8';
const BLUE_DARK = '#0b4ea2';
const NAVY = '#172335';
const MUTED = '#64748b';
const LINE = '#dbe4f0';
const PALE = '#f7faff';
const GREEN = '#15803d';
const ORANGE = '#c2410c';
const RED = '#b42318';

function safeNumber(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? n : 0;
}

function fitStatusRows(rows) {
  const sorted = (rows || [])
    .map(row => ({ label: String(row.label || 'Other'), count: safeNumber(row.count) }))
    .filter(row => row.count > 0)
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
  if (sorted.length <= 5) return sorted;
  const kept = sorted.slice(0, 4);
  kept.push({ label: 'Other', count: sorted.slice(4).reduce((sum, row) => sum + row.count, 0) });
  return kept;
}

function drawStatCard(doc, x, y, w, label, value, sub = '') {
  doc.roundedRect(x, y, w, 66, 9).fillAndStroke('#ffffff', LINE);
  doc.font('Helvetica-Bold').fontSize(7.5).fillColor(MUTED).text(label.toUpperCase(), x + 13, y + 11, { width: w - 26 });
  doc.font('Helvetica-Bold').fontSize(20).fillColor(NAVY).text(String(value), x + 13, y + 26, { width: w - 26 });
  if (sub) doc.font('Helvetica').fontSize(6.8).fillColor(MUTED).text(sub, x + 13, y + 50, { width: w - 26 });
}

function drawBarChart(doc, x, y, w, h, months) {
  const leftPad = 34;
  const bottomPad = 28;
  const topPad = 18;
  const chartX = x + leftPad;
  const chartY = y + topPad;
  const chartW = w - leftPad - 8;
  const chartH = h - topPad - bottomPad;
  const maxCount = Math.max(1, ...months.map(row => safeNumber(row.count)));
  const steps = 4;

  for (let i = 0; i <= steps; i += 1) {
    const ratio = i / steps;
    const yy = chartY + chartH - (chartH * ratio);
    const tick = Math.round(maxCount * ratio);
    doc.moveTo(chartX, yy).lineTo(chartX + chartW, yy).strokeColor(i === 0 ? '#b8c5d6' : '#e8eef5').lineWidth(i === 0 ? 0.8 : 0.45).stroke();
    doc.font('Helvetica').fontSize(6.5).fillColor(MUTED).text(String(tick), x, yy - 4, { width: leftPad - 7, align: 'right' });
  }

  const slotW = chartW / Math.max(1, months.length);
  const barW = Math.max(14, Math.min(36, slotW * 0.58));
  months.forEach((row, index) => {
    const count = safeNumber(row.count);
    const barH = count <= 0 ? 1 : Math.max(3, (count / maxCount) * (chartH - 18));
    const bx = chartX + (slotW * index) + ((slotW - barW) / 2);
    const by = chartY + chartH - barH;
    const selected = index === months.length - 1;
    doc.roundedRect(bx, by, barW, barH, 3).fill(selected ? BLUE_DARK : BLUE);
    doc.font('Helvetica-Bold').fontSize(7).fillColor(NAVY).text(String(count), bx - 7, Math.max(chartY, by - 13), { width: barW + 14, align: 'center' });
    doc.font('Helvetica-Bold').fontSize(7).fillColor(selected ? BLUE_DARK : MUTED).text(String(row.label || ''), chartX + (slotW * index), chartY + chartH + 8, { width: slotW, align: 'center' });
  });
}

function writeMonthlyStatsPdf({
  output,
  title,
  selectedMonthLabel,
  selectedCount,
  ytdTotal,
  averagePerMonth,
  peakMonthLabel,
  peakCount,
  months,
  statusBreakdown,
  generatedAt,
  logoPath
}) {
  const doc = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 0 });
  doc.pipe(output);

  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const left = 34;
  const right = pageW - 34;
  const contentW = right - left;

  if (logoPath && fs.existsSync(logoPath)) {
    try { doc.image(logoPath, left, 24, { fit: [142, 52] }); } catch (_) {}
  }

  doc.font('Helvetica-Bold').fontSize(19).fillColor(NAVY).text(title, 250, 27, { width: right - 250, align: 'right' });
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(`Reporting period: ${selectedMonthLabel} | CAT`, 250, 53, { width: right - 250, align: 'right' });
  doc.moveTo(left, 83).lineTo(right, 83).strokeColor(BLUE).lineWidth(1.1).stroke();

  const cardGap = 10;
  const cardW = (contentW - (cardGap * 3)) / 4;
  const cardY = 98;
  drawStatCard(doc, left, cardY, cardW, 'Selected month', selectedCount, selectedMonthLabel);
  drawStatCard(doc, left + (cardW + cardGap), cardY, cardW, 'Year to date', ytdTotal, 'January through selected month');
  drawStatCard(doc, left + ((cardW + cardGap) * 2), cardY, cardW, 'Monthly average', Number(averagePerMonth || 0).toFixed(1), 'Average records per month');
  drawStatCard(doc, left + ((cardW + cardGap) * 3), cardY, cardW, 'Peak month', peakCount, peakMonthLabel || '-');

  const chartY = 182;
  doc.font('Helvetica-Bold').fontSize(10.5).fillColor(NAVY).text('Monthly volume', left, chartY - 14);
  doc.font('Helvetica').fontSize(7).fillColor(MUTED).text('January through the selected month', left + 102, chartY - 12);
  doc.roundedRect(left, chartY, contentW, 225, 10).fillAndStroke('#ffffff', LINE);
  drawBarChart(doc, left + 10, chartY + 8, contentW - 20, 205, months || []);

  const statusY = 430;
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY).text('Selected month status breakdown', left, statusY);
  const statuses = fitStatusRows(statusBreakdown);
  const total = Math.max(1, statuses.reduce((sum, row) => sum + row.count, 0));
  const rowY = statusY + 22;
  if (!statuses.length) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('No records in the selected month.', left, rowY);
  } else {
    const gap = 10;
    const itemW = (contentW - gap * (statuses.length - 1)) / statuses.length;
    statuses.forEach((row, index) => {
      const xx = left + index * (itemW + gap);
      doc.roundedRect(xx, rowY, itemW, 54, 8).fillAndStroke(PALE, LINE);
      const percent = Math.round((row.count / total) * 100);
      const tone = /attention|failed|rejected/i.test(row.label) ? RED : /review|hold/i.test(row.label) ? ORANGE : /complete|submitted|ready|paid/i.test(row.label) ? GREEN : BLUE;
      doc.font('Helvetica-Bold').fontSize(7.2).fillColor(MUTED).text(row.label.toUpperCase(), xx + 10, rowY + 9, { width: itemW - 20 });
      doc.font('Helvetica-Bold').fontSize(15).fillColor(tone).text(String(row.count), xx + 10, rowY + 24, { width: 38 });
      doc.font('Helvetica').fontSize(7).fillColor(MUTED).text(`${percent}%`, xx + 48, rowY + 31, { width: itemW - 58, align: 'right' });
    });
  }

  doc.font('Helvetica').fontSize(6.7).fillColor(MUTED)
    .text(`Generated ${generatedAt} | Windscreen Fitment Centre`, left, pageH - 24, { width: contentW, align: 'center' });
  doc.end();
  return doc;
}

module.exports = { writeMonthlyStatsPdf, fitStatusRows };
