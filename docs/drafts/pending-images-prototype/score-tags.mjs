// Score a tag-based conversion: each Pending Image's {image: n} resolves through the tag list, exactly.
import fs from "fs";

const [jsonPath, tagsPath, truthPath] = process.argv.slice(2);
const r = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
const bank = r.bank ?? r.questionBanks?.[0]?.record?.bank;
const tags = JSON.parse(fs.readFileSync(tagsPath, "utf8"));
const truth = JSON.parse(fs.readFileSync(truthPath, "utf8"));
const tagId = new Map(tags.map((t) => [t.tag, t.id]));

const slots = [];
bank.questions.forEach((q, i) => {
  const parts = [["stem", q.stem], ...(q.choices ?? []).map((c, ci) => [`choice ${String.fromCharCode(65 + ci)}`, c.content])];
  for (const [part, doc] of parts) {
    const refs = [];
    const walk = (n) => { if (!n || typeof n !== "object") return; if (Array.isArray(n)) return n.forEach(walk); if (n.pending) refs.push(n.pending); Object.values(n).forEach(walk); };
    walk(doc);
    if (refs.length) slots.push({ q: i + 1, part, refs });
  }
});

const key = (s) => `${s.q}|${s.part}`;
const rows = [];
let right = 0;
for (const s of slots) {
  const got = s.refs.map((ref) => ("image" in ref ? tagId.get(ref.image) ?? `bad tag ${ref.image}` : `page ${ref.page}`));
  const t = truth.find((t) => key(t) === key(s));
  const want = t?.imgs ?? [];
  const ok = want.length === got.length && want.every((w, k) => got[k] === w);
  if (ok) right++;
  // a passage stored as an image may be kept as a picture instead of transcribed
  const verdict = ok ? (t.passage ? "yes (passage kept as picture)" : "yes") : "NO";
  rows.push({ slot: `Q${s.q} ${s.part}`, wrote: s.refs.map((x) => JSON.stringify(x)).join(" "), resolves: got.join(" "), truth: want.join(" ") || "(not a slot)", ok: verdict });
}
console.table(rows);
const missed = truth.filter((t) => !t.passage && !slots.some((s) => key(s) === key(t))).map((t) => `Q${t.q} ${t.part}`);
const used = new Set(slots.flatMap((s) => s.refs.filter((x) => "image" in x).map((x) => x.image)));
console.log(`slots right: ${right} of ${slots.length} written; true slots missed: ${missed.join(", ") || "none"}`);
console.log(`tags used as pictures: ${[...used].sort((a, b) => a - b).map((n) => `IMG ${n}`).join(", ") || "none"}`);
const tagLeaks = JSON.stringify(bank).match(/IMG \d+/g);
console.log(`tag text copied into content: ${tagLeaks ? [...new Set(tagLeaks)].join(", ") : "none"}`);
