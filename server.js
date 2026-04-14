const path  = require("path");
const fs    = require("fs");
const https = require("https");
const express = require("express");

function fetchDictAPI(word) {
  return new Promise((resolve, reject) => {
    const url = `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`;
    https.get(url, { headers: { "User-Agent": "Node.js" } }, res => {
      const c = [];
      res.on("data", d => c.push(d));
      res.on("end", () => {
        try {
          const data = JSON.parse(Buffer.concat(c).toString());
          if (!Array.isArray(data) || !data[0]) return reject(new Error("not found"));
          const entry   = data[0];
          const phonetic = entry.phonetic ||
            (entry.phonetics && entry.phonetics.find(p => p.text)?.text) || "";
          let example = "";
          for (const meaning of (entry.meanings || [])) {
            for (const def of (meaning.definitions || [])) {
              if (def.example) { example = def.example; break; }
            }
            if (example) break;
          }
          resolve({ phonetic, example });
        } catch (e) { reject(e); }
      });
    }).on("error", reject);
  });
}

const PORT         = Number(process.env.PORT || 4000);
const DATA_DIR     = path.join(__dirname, "public", "data");
const PROGRESS_DIR = path.join(__dirname, "progress");
if (!fs.existsSync(PROGRESS_DIR)) fs.mkdirSync(PROGRESS_DIR);
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

  const existingMap = new Map(existing.map(w => [w.word.toLowerCase(), w]));
  const now = new Date().toISOString();
  let added = 0;

  for (const item of items) {
    if (!item.word) continue;
    const key = item.word.trim().toLowerCase();
    if (existingMap.has(key)) {
      const ex = existingMap.get(key);
      if (!ex.phonetic && item.phonetic) ex.phonetic = item.phonetic.trim();
      if (!ex.example  && item.example)  ex.example  = item.example.trim();
      continue;
    }
    const newWord = {
      id:          Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      word:        item.word.trim(),
      translation: (item.translation || "").trim(),
      example:     (item.example  || "").trim(),
      phonetic:    (item.phonetic || "").trim(),
      createdAt:   now
    };
    existing.push(newWord);
    existingMap.set(key, newWord);
    added++;
  }

  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf8");
  res.json({ added, total: existing.length });
});

/* ── GET /api/progress/:deckId ───────────────── */
app.get("/api/progress/:deckId", (req, res) => {
  const id = req.params.deckId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  if (!id) return res.status(400).json({ error: "invalid deckId" });
  try {
    const raw = fs.readFileSync(path.join(PROGRESS_DIR, `prog_${id}.json`), "utf8");
    res.json(JSON.parse(raw));
  } catch { res.json({}); }
});

/* ── POST /api/progress/:deckId ──────────────── */
app.post("/api/progress/:deckId", (req, res) => {
  const id = req.params.deckId.replace(/[^a-zA-Z0-9_-]/g, "").toLowerCase();
  if (!id) return res.status(400).json({ error: "invalid deckId" });
  const filePath = path.join(PROGRESS_DIR, `prog_${id}.json`);
  const tmpPath  = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(req.body), "utf8");
    fs.renameSync(tmpPath, filePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GET /api/streak ─────────────────────────── */
app.get("/api/streak", (req, res) => {
  try {
    const raw = fs.readFileSync(path.join(PROGRESS_DIR, "streak.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch { res.json({ last: "", count: 0 }); }
});

/* ── POST /api/streak ────────────────────────── */
app.post("/api/streak", (req, res) => {
  const filePath = path.join(PROGRESS_DIR, "streak.json");
  const tmpPath  = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(req.body), "utf8");
    fs.renameSync(tmpPath, filePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ── GET /api/word-detail/:word ─────────────── */
const DICT_CACHE_FILE = path.join(PROGRESS_DIR, "dict_cache.json");
app.get("/api/word-detail/:word", async (req, res) => {
  const word = req.params.word.replace(/[^a-zA-Z\s'-]/g, "").toLowerCase().trim();
  if (!word) return res.status(400).json({ error: "invalid" });
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(DICT_CACHE_FILE, "utf8")); } catch {}
  if (cache[word]) return res.json(cache[word]);
  try {
    const detail = await fetchDictAPI(word);
    cache[word] = detail;
    const tmp = DICT_CACHE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf8");
    fs.renameSync(tmp, DICT_CACHE_FILE);
    res.json(detail);
  } catch { res.json({ phonetic: "", example: "" }); }
});

/* ── GET /api/daily ──────────────────────────── */
app.get("/api/daily", (req, res) => {
  try {
    const raw = fs.readFileSync(path.join(PROGRESS_DIR, "daily.json"), "utf8");
    res.json(JSON.parse(raw));
  } catch { res.json({}); }
});

/* ── POST /api/daily ─────────────────────────── */
app.post("/api/daily", (req, res) => {
  const filePath = path.join(PROGRESS_DIR, "daily.json");
  const tmpPath  = filePath + ".tmp";
  try {
    fs.writeFileSync(tmpPath, JSON.stringify(req.body), "utf8");
    fs.renameSync(tmpPath, filePath);
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.listen(PORT, () => {
  console.log(`Vocab app running at http://localhost:${PORT}`);
});
