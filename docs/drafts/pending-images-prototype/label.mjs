// Make a labeled copy of a Source Document: a red "IMG n" tag beside each embedded picture.
// Writes <out>.pdf, <out>-tags.json (tag -> image id and box) for scoring and the prompt inventory.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import fs from "fs";

const [src, out] = process.argv.slice(2);
const bytes = new Uint8Array(fs.readFileSync(src));
const doc = await pdfjs.getDocument({ data: bytes.slice(), verbosity: 0 }).promise;
const O = pdfjs.OPS;
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];

// 1. every picture-sized embedded image, in reading order within each page
const tags = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; let n = 0; const found = [];
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i];
    if (f === O.save) stack.push(ctm); else if (f === O.restore) ctm = stack.pop() ?? ctm;
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.paintImageXObject) {
      n++;
      const m = ctm;
      const pts = [[0,0],[1,0],[0,1],[1,1]].map(([u,v]) => vp.convertToViewportPoint(m[0]*u+m[2]*v+m[4], m[1]*u+m[3]*v+m[5]));
      const box = {
        top: Math.min(...pts.map(q=>q[1]))/vp.height*1000, bottom: Math.max(...pts.map(q=>q[1]))/vp.height*1000,
        left: Math.min(...pts.map(q=>q[0]))/vp.width*1000, right: Math.max(...pts.map(q=>q[0]))/vp.width*1000,
      };
      // equation- and bullet-sized images get no tag
      if (box.right - box.left > 60 && box.bottom - box.top > 40) found.push({ id: `p${p}#${n}`, page: p, ...box });
    }
  }
  found.sort((x, y) => (Math.abs(x.top - y.top) < 40 ? x.left - y.left : x.top - y.top));
  for (const f of found) tags.push({ tag: tags.length + 1, ...f });
}

// 2. draw the tags onto a copy with pdf-lib
const pdf = await PDFDocument.load(bytes);
const font = await pdf.embedFont(StandardFonts.HelveticaBold);
const red = rgb(0.82, 0.08, 0.12);
for (const t of tags) {
  const page = pdf.getPage(t.page - 1);
  const { width: W, height: H } = page.getSize();
  const x0 = t.left / 1000 * W, x1 = t.right / 1000 * W;
  const yTop = H - t.top / 1000 * H, yBot = H - t.bottom / 1000 * H;
  const label = `IMG ${t.tag}`;
  const size = 10, pad = 2.5;
  const w = font.widthOfTextAtSize(label, size) + pad * 2, h = size + pad * 2;
  // inside the picture's top-left corner: it may cover a corner of the picture, which only Gemini
  // sees (the real bytes come from the original), but never the question text around it
  const ty = yTop - h - 2;
  page.drawRectangle({ x: x0 + 2, y: ty, width: w, height: h, color: red });
  page.drawText(label, { x: x0 + 2 + pad, y: ty + pad + 1, size, font, color: rgb(1, 1, 1) });
}
fs.writeFileSync(`${out}.pdf`, await pdf.save());
fs.writeFileSync(`${out}-tags.json`, JSON.stringify(tags, null, 1));
console.log(`${tags.length} tags:`, tags.map((t) => `IMG ${t.tag}=p${t.page}`).join(" "));
