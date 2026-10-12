// Text-layer matcher prototype: assign ripped images to Pending Image slots using the
// Source Document's own text (question anchors and choice labels), ignoring assistant boxes.
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import fs from "fs";

const [src, jsonPath, truthPath] = process.argv.slice(2);
const record = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const doc = await pdfjs.getDocument({ data: new Uint8Array(fs.readFileSync(src)), verbosity: 0 }).promise;
const O = pdfjs.OPS;
const mul = (a, b) => [a[0]*b[0]+a[2]*b[1], a[1]*b[0]+a[3]*b[1], a[0]*b[2]+a[2]*b[3], a[1]*b[2]+a[3]*b[3], a[0]*b[4]+a[2]*b[5]+a[4], a[1]*b[4]+a[3]*b[5]+a[5]];
const norm = (s) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");

// ---- Source Document facts: images and text lines, in document coordinates (y grows down across pages)
const images = [];
const lines = [];
for (let p = 1; p <= doc.numPages; p++) {
  const page = await doc.getPage(p);
  const vp = page.getViewport({ scale: 1 });
  const base = (p - 1) * 1000;
  const ops = await page.getOperatorList();
  let ctm = [1, 0, 0, 1, 0, 0]; const stack = []; let n = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    const f = ops.fnArray[i], a = ops.argsArray[i];
    if (f === O.save) stack.push(ctm); else if (f === O.restore) ctm = stack.pop() ?? ctm;
    else if (f === O.transform) ctm = mul(ctm, a);
    else if (f === O.paintImageXObject) {
      n++;
      const m = ctm;
      const pts = [[0,0],[1,0],[0,1],[1,1]].map(([u,v]) => vp.convertToViewportPoint(m[0]*u+m[2]*v+m[4], m[1]*u+m[3]*v+m[5]));
      const box = {
        top: base + Math.min(...pts.map(q=>q[1]))/vp.height*1000, bottom: base + Math.max(...pts.map(q=>q[1]))/vp.height*1000,
        left: Math.min(...pts.map(q=>q[0]))/vp.width*1000, right: Math.max(...pts.map(q=>q[0]))/vp.width*1000,
      };
      images.push({ id: `p${p}#${n}`, page: p, ...box });
    }
  }
  const items = (await page.getTextContent()).items.filter((it) => it.str.trim());
  // group items into lines by baseline
  const rows = [];
  for (const it of items) {
    const [x, y] = vp.convertToViewportPoint(it.transform[4], it.transform[5]);
    const Y = base + y / vp.height * 1000, X = x / vp.width * 1000;
    let row = rows.find((r) => Math.abs(r.y - Y) < 6);
    if (!row) rows.push(row = { y: Y, page: p, parts: [] });
    row.parts.push({ x: X, str: it.str });
  }
  for (const r of rows) { r.parts.sort((a, b) => a.x - b.x); r.text = r.parts.map((q) => q.str).join(" "); lines.push(r); }
}
lines.sort((a, b) => a.y - b.y);
const bigImages = images.filter((im) => (im.right - im.left) > 60 && (im.bottom - im.top) > 40); // ignore equation-sized images

// ---- Record facts: question order, stem text, Pending Image slots
const plain = (node) => {
  if (!node || typeof node !== "object") return "";
  if (Array.isArray(node)) return node.map(plain).join(" ");
  if (node.type === "text") return node.text;
  if (node.type === "inline-math" || node.type === "display-math") return " \u0000 ";
  return plain(node.content);
};
const pendings = (node) => {
  if (!node || typeof node !== "object") return 0;
  if (Array.isArray(node)) return node.reduce((s, n) => s + pendings(n), 0);
  return ((node.type === "block-image" || node.type === "inline-image") && node.pending ? 1 : 0) + pendings(node.content);
};

// Anchor each question on its longest math-free run of stem words, searched forward from the previous anchor
function findAnchor(q, qNumber, fromY) {
  const runs = plain(q.stem).split("\u0000").map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 2).sort((a, b) => b.length - a.length);
  const later = lines.filter((l) => l.y > fromY);
  for (const run of runs) {
    const key = norm(run).slice(0, 40);
    if (key.length < 8) continue;
    // allow the run to wrap across two lines
    for (let i = 0; i < later.length; i++) {
      const nextLine = later[i + 1]?.page === later[i].page ? later[i + 1].text : "";
      const joined = norm(later[i].text + " " + nextLine);
      // a match that lies wholly in the next line belongs to the next line
      if (joined.includes(key) && !norm(nextLine).includes(key)) return { y: later[i].y, how: `text "${run.slice(0, 30)}…"` };
    }
  }
  const numbered = later.find((l) => new RegExp(`^\\s*${qNumber}\\s*\\.`).test(l.text));
  if (numbered) return { y: numbered.y, how: `number ${qNumber}.` };
  return null;
}

const bank = record.bank ?? record.questionBanks?.[0]?.record?.bank; // bare record or Package
const qs = bank.questions;
let cursor = -1;
const anchors = qs.map((q, i) => {
  const a = findAnchor(q, i + 1, cursor);
  if (a) cursor = a.y;
  return a;
});

// Choice labels "(A)".."(D)" between this anchor and the next
function choiceLabels(start, end) {
  const found = {};
  for (const l of lines) if (l.y >= start - 2 && l.y < end) for (const part of l.parts) {
    const s = part.str.normalize("NFKD");
    const m = s.match(/^\s*\(?([A-E])\)\s*$/) || s.match(/^\s*\(([A-E])\)/);
    if (m && !found[m[1]]) found[m[1]] = { x: part.x, y: l.y };
  }
  return found;
}

const claimed = new Map(); // image id -> slot that took it as a choice
const assignment = [];
qs.forEach((q, i) => {
  const a = anchors[i];
  const next = anchors.slice(i + 1).find(Boolean)?.y ?? Infinity;
  if (!a) { assignment.push({ q: i + 1, part: "stem", imgs: [], note: "question not found in PDF" }); return; }
  const labels = choiceLabels(a.y, next);
  // choices first: nearest image whose top-left sits right of / below its label
  (q.choices ?? []).forEach((c, ci) => {
    if (!pendings(c.content)) return;
    const letter = String.fromCharCode(65 + ci);
    const L = labels[letter];
    let pick = null;
    if (L) {
      const cands = bigImages.filter((im) => im.top > L.y - 40 && im.top < next && im.left >= L.x - 20 && !claimed.has(im.id))
        .map((im) => ({ im, d: Math.hypot(im.left - L.x, im.top - L.y) })).sort((x, y) => x.d - y.d);
      pick = cands[0]?.im ?? null;
    }
    if (pick) claimed.set(pick.id, `${i + 1}${letter}`);
    assignment.push({ q: i + 1, part: `choice ${letter}`, imgs: pick ? [pick.id] : [], note: L ? "" : "label not found" });
  });
});
qs.forEach((q, i) => {
  const k = pendings(q.stem);
  if (!k) return;
  const a = anchors[i];
  if (!a) return;
  const next = anchors.slice(i + 1).find(Boolean)?.y ?? Infinity;
  const firstLabel = Math.min(...Object.values(choiceLabels(a.y, next)).map((l) => l.y), next);
  // stem pictures sit just above the stem ("shown above"), or between the stem and its first choice
  const below = bigImages.filter((im) => im.top >= a.y && im.bottom <= firstLabel && !claimed.has(im.id));
  const above = bigImages.filter((im) => im.bottom <= a.y + 10 && !claimed.has(im.id)).sort((x, y) => y.bottom - x.bottom);
  let pool = below.length ? below : above.length ? above.filter((im) => Math.abs(im.bottom - above[0].bottom) < 60) : [];
  // Gemini may give fewer Pending Images than pictures: keep the whole nearest row, report extras
  // reading order: pictures whose tops are within a band share a row, then left to right
  pool = pool.sort((x, y) => (Math.abs(x.top - y.top) < 40 ? x.left - y.left : x.top - y.top));
  assignment.push({ q: i + 1, part: "stem", imgs: pool.map((im) => im.id), pendingCount: k, note: pool.length > k ? `${pool.length - k} extra picture(s) offered` : pool.length < k ? "fewer pictures than Pending Images" : "" });
});

// ---- Score against the hand-made truth
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const key = (s) => `${s.q}|${s.part}`;
const tmap = new Map(truth.map((t) => [key(t), t.imgs]));
let right = 0;
const rowsOut = assignment.sort((a, b) => a.q - b.q || a.part.localeCompare(b.part)).map((s) => {
  const want = tmap.get(key(s)) ?? [];
  const ok = want.length > 0 && want.length === s.imgs.length && want.every((w, i) => s.imgs[i] === w); // same pictures, same order
  if (ok) right++;
  return { slot: `Q${s.q} ${s.part}`, matched: s.imgs.join(" ") || "-", truth: want.join(" ") || "(not a slot)", ok: ok ? "yes" : "NO", note: s.note ?? "" };
});
console.log("anchors:");
anchors.forEach((a, i) => console.log(`  Q${i + 1}: ${a ? `page ${Math.floor(a.y / 1000) + 1} via ${a.how}` : "NOT FOUND"}`));
console.table(rowsOut);
const missing = truth.filter((t) => !assignment.some((s) => key(s) === key(t))).map((t) => `Q${t.q} ${t.part}`);
console.log(`Gemini's slots matched right: ${right} of ${assignment.length}`);
console.log(`true slots Gemini never marked: ${missing.join(", ") || "none"}`);
