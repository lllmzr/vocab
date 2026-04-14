const path = require("path");
const fs   = require("fs");
const express = require("express");

const PORT     = Number(process.env.PORT || 4000);
const DATA_DIR = path.join(__dirname, "public", "data");
const app      = express();

app.use(express.json({ limit: "20mb" }));
app.use(express.static(path.join(__dirname, "public")));

const DECK_LABELS = {
  words: "自定义词库",
  cet6:  "CET-6 六级",
  ielts: "雅思 IELTS"
};

/* ── GET /api/vocab-sets ─────────────────────── */
app.get("/api/vocab-sets", (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith(".json"));
    const sets  = [];
    for (const file of files) {
      const id = file.replace(".json", "");
      try {
        const raw  = fs.readFileSync(path.join(DATA_DIR, file), "utf8");
        const data = JSON.parse(raw || "[]");
        if (!Array.isArray(data) || data.length === 0) continue;
        sets.push({ id, name: DECK_LABELS[id] || id, count: data.length });
      } catch { /* skip malformed */ }
    }
    res.json(sets);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ── POST /api/words/import ──────────────────── */
app.post("/api/words/import", (req, res) => {
  const { items = [], set = "words" } = req.body;
  const safeSet = set.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  if (!safeSet) return res.status(400).json({ error: "invalid set name" });

  const filePath = path.join(DATA_DIR, `${safeSet}.json`);
  let existing = [];
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    existing  = JSON.parse(raw || "[]");
  } catch { /* new file */ }

  const existingSet = new Set(existing.map(w => w.word.toLowerCase()));
  const now = new Date().toISOString();
  let added = 0;

  for (const item of items) {
    if (!item.word || existingSet.has(item.word.toLowerCase())) continue;
    existing.push({
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      word:        item.word.trim(),
      translation: (item.translation || "").trim(),
      example:     (item.example || "").trim(),
      createdAt:   now
    });
    existingSet.add(item.word.toLowerCase());
    added++;
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8");
  res.json({ added, total: existing.length });
});

app.listen(PORT, () => {
  console.log(`Vocab app running at http://localhost:${PORT}`);
});
