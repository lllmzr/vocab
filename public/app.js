/* 单词背诵 — 纯前端，进度存 localStorage */

/* ── Utils ───────────────────────────────────── */
const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove("hidden");
const hide = id => $(id).classList.add("hidden");
const esc  = s  => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm = s  => s.trim().toLowerCase().replace(/\s+/g," ");
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

const BASE_PROG_KEY = "voc_prog_v1";
const STREAK_KEY    = "voc_streak_v1";
const DECK_KEY      = "voc_deck_v1";
const NEW_LIMIT     = 50;

let words       = [];
let progress    = {};
let currentDeck = localStorage.getItem(DECK_KEY) || "";

/* ── Progress (per-deck) ─────────────────────── */
const progKey  = () => `${BASE_PROG_KEY}_${currentDeck}`;
const loadProg = () => { try { return JSON.parse(localStorage.getItem(progKey())||"{}"); } catch { return {}; } };
const saveProg = () => localStorage.setItem(progKey(), JSON.stringify(progress));
const today    = () => new Date().toISOString().slice(0,10);

function getCard(w) {
  return progress[w.id] || { interval:1, ef:2.5, reps:0, dueDate:today(), totalReviews:0, correctReviews:0 };
}

/* ── SM-2 ─────────────────────────────────────── */
function sm2(card, q) {
  q = Math.max(0, Math.min(5, q));
  let {interval, ef, reps} = card;
  if (q >= 3) {
    interval = reps===0 ? 1 : reps===1 ? 6 : Math.round(interval*ef);
    reps++;
  } else { reps=0; interval=1; }
  ef = Math.max(1.3, ef + 0.1 - (5-q)*(0.08+(5-q)*0.02));
  const d = new Date(); d.setDate(d.getDate()+interval);
  return { ...card, interval, ef, reps, dueDate: d.toISOString().slice(0,10),
    totalReviews: card.totalReviews+1, correctReviews: card.correctReviews+(q>=3?1:0) };
}

/* ── Queue ────────────────────────────────────── */
function buildQueue() {
  const t   = today();
  const due = words.filter(w => { const p=progress[w.id]; return p && p.dueDate<=t; });
  const nw  = shuffle(words.filter(w => !progress[w.id])).slice(0, NEW_LIMIT);
  return shuffle([...due, ...nw]);
}

/* ── Streak ───────────────────────────────────── */
function bumpStreak() {
  const t  = today();
  const yd = (() => { const d=new Date(); d.setDate(d.getDate()-1); return d.toISOString().slice(0,10); })();
  let s = JSON.parse(localStorage.getItem(STREAK_KEY)||'{"last":"","count":0}');
  if (s.last===t) return s.count;
  s = { last:t, count: s.last===yd ? s.count+1 : 1 };
  localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  return s.count;
}
function streak() { try { return JSON.parse(localStorage.getItem(STREAK_KEY)||'{"count":0}').count; } catch { return 0; } }

/* ── Deck ─────────────────────────────────────── */
async function loadDecks() {
  try {
    const sets = await fetch("/api/vocab-sets").then(r => r.json());
    renderDeckPills(sets);

    let target = currentDeck;
    if (!target || !sets.find(s => s.id === target)) {
      target = sets.length ? sets[0].id : "";
    }
    if (target) await switchDeck(target);
    else $("deck-pills").innerHTML = '<span class="muted sm">暂无词库，请先运行：node import_dicts.js</span>';
  } catch (e) {
    $("deck-pills").innerHTML = '<span class="muted sm err">加载词库失败</span>';
    console.error(e);
  }
}

function renderDeckPills(sets) {
  if (!sets.length) return;
  $("deck-pills").innerHTML = sets.map(s =>
    `<button class="deck-pill${s.id===currentDeck?' active':''}" data-deck="${esc(s.id)}">
      <span class="dp-name">${esc(s.name)}</span>
      <span class="dp-count">${s.count.toLocaleString()} 词</span>
    </button>`
  ).join("");
  $("deck-pills").querySelectorAll(".deck-pill").forEach(btn =>
    btn.addEventListener("click", () => switchDeck(btn.dataset.deck))
  );
}

async function switchDeck(deckId) {
  currentDeck = deckId;
  localStorage.setItem(DECK_KEY, deckId);

  document.querySelectorAll(".deck-pill").forEach(b =>
    b.classList.toggle("active", b.dataset.deck === deckId)
  );

  try {
    words = await fetch(`/data/${deckId}.json`).then(r => r.json());
  } catch { words = []; }
  progress = loadProg();

  showStart();

  const activeTab = document.querySelector("nav button.active")?.dataset.tab;
  if (activeTab === "words") renderWords();
  if (activeTab === "stats") renderStats();
}

/* ── Tabs ─────────────────────────────────────── */
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("section.tab").forEach(s => s.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-"+btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab==="words") renderWords();
    if (btn.dataset.tab==="stats") renderStats();
  });
});

/* ══════════════════════════════════════════════
   REVIEW
   ══════════════════════════════════════════════ */
let queue=[], qi=0, sesOk=0, sesTotal=0, pendingQ=null;

function showStart() {
  const t   = today();
  const due = words.filter(w => { const p=progress[w.id]; return !p||p.dueDate<=t; });
  const rev = due.filter(w =>  progress[w.id]);
  const nw  = due.filter(w => !progress[w.id]);
  $("sn-due").textContent   = rev.length;
  $("sn-new").textContent   = Math.min(nw.length, NEW_LIMIT);
  $("sn-total").textContent = words.length;
  show("scr-start"); hide("scr-session"); hide("scr-done"); hide("scr-empty");
}

$("btn-start").addEventListener("click", () => {
  queue = buildQueue();
  if (!queue.length) { hide("scr-start"); show("scr-empty"); return; }
  qi=sesOk=sesTotal=0;
  hide("scr-start"); show("scr-session");
  showWord();
});

/* Phase 1 */
function showWord() {
  if (qi>=queue.length) { endSession(); return; }
  const w = queue[qi];
  $("prog-bar").style.width = (qi/queue.length*100).toFixed(1)+"%";
  $("prog-label").textContent = `${qi+1} / ${queue.length}`;
  $("wc-word").textContent = w.word;
  show("ph-word"); hide("ph-reveal"); pendingQ=null;
}

document.querySelectorAll(".know").forEach(btn => {
  btn.addEventListener("click", () => { pendingQ=Number(btn.dataset.q); showReveal(); });
});

/* Phase 2 */
function showReveal() {
  const w = queue[qi];
  hide("ph-word"); show("ph-reveal");

  $("rc-word").textContent  = w.word;
  $("rc-trans").textContent = w.translation;

  const hasEx = w.example && w.example.trim();
  if (hasEx) { $("rc-ex").textContent=w.example; show("rc-ex-wrap"); }
  else        { hide("rc-ex-wrap"); }

  const target = hasEx ? w.example : w.word;
  const inp = $("type-input");
  inp.value=""; inp.className=""; inp.disabled=false; inp.dataset.target=target;
  $("type-submit").disabled=false;
  hide("type-fb"); hide("btn-next");
  $("type-prompt").textContent = hasEx ? "看着例句，打一遍：" : "打出这个单词：";
  inp.focus();
}

function submitTyping() {
  const inp    = $("type-input");
  const target = inp.dataset.target;
  if (!inp.value.trim()) return;

  const ok = norm(inp.value) === norm(target);
  inp.classList.add(ok?"ok":"err"); inp.disabled=true;
  $("type-submit").disabled=true;

  $("type-result").textContent = ok ? "✓ 正确！" : "✗ 不对";
  $("type-result").className = ok ? "ok" : "err";
  $("type-correct").textContent = ok ? "" : "正确："+target;
  show("type-fb"); show("btn-next");

  if (ok) sesOk++;
  sesTotal++;

  const q = Math.max(0, ok ? (pendingQ??3) : (pendingQ??3)-2);
  progress[queue[qi].id] = sm2(getCard(queue[qi]), q);
  saveProg();
}

$("type-input").addEventListener("keydown", e => { if(e.key==="Enter"){ e.preventDefault(); submitTyping(); } });
$("type-submit").addEventListener("click", submitTyping);
$("btn-next").addEventListener("click", () => { qi++; showWord(); });

$("btn-speak").addEventListener("click", () => {
  const word = $("rc-word").textContent;
  if (!word||!window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u=new SpeechSynthesisUtterance(word); u.lang="en-US"; u.rate=0.85;
  speechSynthesis.speak(u);
});

function endSession() {
  hide("scr-session"); show("scr-done");
  $("prog-bar").style.width="100%";
  const rate = sesTotal ? Math.round(sesOk/sesTotal*100) : 0;
  $("done-summary").textContent = `复习 ${sesTotal} 个，正确 ${sesOk} 个（${rate}%）`;
  bumpStreak();
}
$("btn-again").addEventListener("click", showStart);

/* ══════════════════════════════════════════════
   WORDS LIST
   ══════════════════════════════════════════════ */
function renderWords() {
  const q   = $("words-search").value.toLowerCase();
  const fil = $("words-filter").value;
  const t   = today();

  let list = words;
  if (q) list = list.filter(w => w.word.toLowerCase().includes(q) || w.translation.toLowerCase().includes(q));
  if (fil==="due")      list = list.filter(w => { const p=progress[w.id]; return !p||p.dueDate<=t; });
  if (fil==="new")      list = list.filter(w => !progress[w.id]);
  if (fil==="mastered") list = list.filter(w => { const p=progress[w.id]; return p&&p.reps>=3&&p.ef>=2; });

  $("words-count").textContent = `共 ${list.length} 个单词`;
  const show200 = list.slice(0, 200);
  $("words-list").innerHTML = show200.map(w => {
    const p       = progress[w.id];
    const mastered = p&&p.reps>=3&&p.ef>=2;
    const isNew    = !p;
    const badge    = mastered ? '<span class="pill ok">已掌握</span>'
                   : isNew    ? '<span class="pill new">未学</span>'
                   :             '<span class="pill">复习中</span>';
    return `<div class="word-row">
      <span class="wr-w">${esc(w.word)}</span>
      <span class="wr-t">${esc(w.translation)}</span>
      ${badge}
    </div>`;
  }).join("") + (list.length>200 ? `<p class="muted sm" style="padding:10px 12px">仅显示前 200 条，请搜索过滤。</p>` : "");
}

$("words-search").addEventListener("input", renderWords);
$("words-filter").addEventListener("change", renderWords);

/* ══════════════════════════════════════════════
   STATS
   ══════════════════════════════════════════════ */
function renderStats() {
  const t        = today();
  const total    = words.length;
  const due      = words.filter(w=>{ const p=progress[w.id]; return !p||p.dueDate<=t; }).length;
  const mastered = words.filter(w=>{ const p=progress[w.id]; return p&&p.reps>=3&&p.ef>=2; }).length;
  const nw       = words.filter(w=>!progress[w.id]).length;
  const reviewed = words.filter(w=>progress[w.id]&&progress[w.id].totalReviews>0);
  const acc      = reviewed.length ? Math.round(
    reviewed.reduce((s,w)=>{ const p=progress[w.id]; return s+p.correctReviews/p.totalReviews; },0)
    /reviewed.length*100) : 0;
  $("st-total").textContent    = total;
  $("st-due").textContent      = due;
  $("st-mastered").textContent = mastered;
  $("st-new").textContent      = nw;
  $("st-acc").textContent      = acc+"%";
  $("st-streak").textContent   = streak()+" 天";
}

/* ── Init ────────────────────────────────────── */
(async () => { await loadDecks(); })();
