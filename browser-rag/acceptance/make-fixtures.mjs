// Original disposable PDF test material, not financial evidence or source-PDF redistribution.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

function pdf(objects) {
  let text = '%PDF-1.7\n% ORIGINAL TEST FIXTURE\n'; const offsets = [0];
  objects.forEach((body, i) => { offsets.push(Buffer.byteLength(text, 'ascii'));
    text += `${i + 1} 0 obj\n${body}\nendobj\n`; });
  const start = Buffer.byteLength(text, 'ascii');
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`;
  return Buffer.from(text, 'ascii');
}
function fixture(empty = false) {
  const contents = empty ? ['', ''] : ['TEST SOURCE PAGE ONE - original fixture only.',
    'TEST SOURCE PAGE TWO - no financial fact or answer.'];
  const stream = str => { const data = str ? `BT /F1 12 Tf 40 740 Td (${str}) Tj ET` : '';
    return `<< /Length ${Buffer.byteLength(data, 'ascii')} >>\nstream\n${data}\nendstream`; };
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D >>] >> >>',
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(contents[0]), stream(contents[1]),
  ]);
}
function paginationFixture() {
  // 240 separately positioned original text lines on one physical page.
  // PDF.js can add empty end-of-line items; verify its actual returned records.
  const pageOne = Array.from({ length: 240 }, (_, index) => {
    const x = 30 + Math.floor(index / 80) * 190;
    const y = 750 - (index % 80) * 9;
    const text = `ORIGINAL PAGINATION TEST P1 ITEM ${String(index + 1).padStart(3, '0')}`;
    return `BT /F1 5 Tf ${x} ${y} Td (${text}) Tj ET`;
  }).join('\n');
  const pageTwo = 'BT /F1 12 Tf 40 740 Td (ORIGINAL PAGINATION TEST P2 - short second physical page.) Tj ET';
  const stream = data => `<< /Length ${Buffer.byteLength(data, 'ascii')} >>\nstream\n${data}\nendstream`;
  return pdf([
    '<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 1 << /S /D >>] >> >>',
    '<< /Type /Pages /Count 2 /Kids [3 0 R 4 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', stream(pageOne), stream(pageTwo),
  ]);
}
export async function makeFixtures() {
  await writeFile(new URL('selectable-test.pdf', import.meta.url), fixture());
  await writeFile(new URL('empty-test.pdf', import.meta.url), fixture(true));
  await writeFile(new URL('pagination-test.pdf', import.meta.url), paginationFixture());
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await makeFixtures();
