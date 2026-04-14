/* 单词背诵 — 纯前端，进度存 localStorage */

/* ── Audio ───────────────────────────────────── */
function playTone() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const now  = ctx.currentTime;
    const play = (freq, start, dur) => {
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.22, now + start);
      gain.gain.exponentialRampToValueAtTime(0.001, now + start + dur);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(now + start); osc.stop(now + start + dur);
    };
    play(880, 0,    0.18);
    play(660, 0.16, 0.22);
  } catch {}
}

/* ── Utils ───────────────────────────────────── */
const $    = id => document.getElementById(id);
const show = id => $(id).classList.remove("hidden");
const hide = id => $(id).classList.add("hidden");
const esc  = s  => String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
const norm = s  => s.trim().toLowerCase().replace(/\s+/g," ");
function shuffle(a){ for(let i=a.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; } return a; }

const BASE_PROG_KEY = "voc_prog_v1";
const STREAK_KEY    = "voc_streak_v1";
const DAILY_KEY     = "voc_daily_v1";
const DECK_KEY      = "voc_deck_v1";
const NEW_LIMIT     = 50;

let words       = [];
let progress    = {};
let currentDeck = localStorage.getItem(DECK_KEY) || "";

/* ── Progress (per-deck) ─────────────────────── */
const progKey  = () => `${BASE_PROG_KEY}_${currentDeck}`;
async function loadProg() {
  const local = (() => { try { return JSON.parse(localStorage.getItem(progKey())||"{}"); } catch { return {}; } })();
  try {
    const server = await fetch(`/api/progress/${currentDeck}`).then(r => r.json());
    const merged = { ...local, ...server };
    localStorage.setItem(progKey(), JSON.stringify(merged));
    return merged;
  } catch { return local; }
}
function saveProg() {
  localStorage.setItem(progKey(), JSON.stringify(progress));
  fetch(`/api/progress/${currentDeck}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(progress)
  }).catch(() => {});
}
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
  fetch("/api/streak", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(s) }).catch(()=>{});
  return s.count;
}
function streak() { try { return JSON.parse(localStorage.getItem(STREAK_KEY)||'{"count":0}').count; } catch { return 0; } }

/* ── Daily Count ──────────────────────────────── */
function bumpDaily(word, choiceLabel) {
  const t = today();
  let d = (() => { try { return JSON.parse(localStorage.getItem(DAILY_KEY)||"{}"); } catch { return {}; } })();
  if (typeof d[t] === 'number') d[t] = { count: d[t], words: [] }; // 迁移旧格式
  if (!d[t]) d[t] = { count: 0, words: [] };
  d[t].count++;
  d[t].words.push({ word: word.word, trans: word.translation, phonetic: word.phonetic || "", example: word.example || "", choice: choiceLabel });
  localStorage.setItem(DAILY_KEY, JSON.stringify(d));
  fetch("/api/daily", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(d) }).catch(()=>{});
  return d[t].count;
}
function todayCount() {
  try {
    const d = JSON.parse(localStorage.getItem(DAILY_KEY)||"{}");
    const v = d[today()];
    if (!v) return 0;
    return typeof v === 'number' ? v : (v.count || 0);
  } catch { return 0; }
}

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
  progress = await loadProg();

  showStart();

  const activeTab = document.querySelector("nav button.active")?.dataset.tab;
  if (activeTab === "words") renderWords();
  if (activeTab === "stats") renderStats();
}

/* ── Tabs ─────────────────────────────────────── */
document.querySelectorAll("nav button").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll("nav button").forEach(b => b.classList.remove("active"));
    document.querySelectorAll("section.tab").forEach(s => {
      s.classList.remove("active");
      s.classList.add("hidden");
    });
    btn.classList.add("active");
    const tab = document.getElementById("tab-"+btn.dataset.tab);
    tab.classList.add("active");
    tab.classList.remove("hidden");
    if (btn.dataset.tab==="words")   renderWords();
    if (btn.dataset.tab==="stats")   renderStats();
    if (btn.dataset.tab==="history") renderHistory();
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
  $("sn-today").textContent = todayCount();
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
  playTone();
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

  $("rc-word").textContent = w.word;
  if (w.phonetic && w.phonetic.trim()) {
    $("rc-phonetic").textContent = "/" + w.phonetic.trim() + "/";
    show("rc-phonetic");
  } else {
    hide("rc-phonetic");
    // 从服务器按需获取音标和例句
    fetch(`/api/word-detail/${encodeURIComponent(w.word)}`)
      .then(r => r.json())
      .then(d => {
        if (d.phonetic && queue[qi] && queue[qi].id === w.id) {
          $("rc-phonetic").textContent = "/" + d.phonetic + "/";
          show("rc-phonetic");
        }
        if (d.example && !w.example && queue[qi] && queue[qi].id === w.id) {
          $("rc-ex").textContent = d.example;
          show("rc-ex-wrap");
          // 同步更新打字目标
          if (!$("type-input").disabled) {
            $("type-input").dataset.target = d.example;
            $("type-prompt").textContent = "看着例句，打一遍：";
          }
        }
      }).catch(() => {});
  }
  $("rc-trans").textContent = w.translation;

  const hasEx = w.example && w.example.trim();
  if (hasEx) { $("rc-ex").textContent = w.example; show("rc-ex-wrap"); }
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
  const choiceLabel = pendingQ === 5 ? "认识" : pendingQ === 3 ? "熟悉" : "不认识";
  bumpDaily(queue[qi], choiceLabel);

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
  $("done-today").textContent = `今日累计：${todayCount()} 个单词`;
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
  $("st-today").textContent    = todayCount()+" 个";
}

/* ══════════════════════════════════════════════
   HISTORY
   ══════════════════════════════════════════════ */
function renderHistory() {
  const d = (() => { try { return JSON.parse(localStorage.getItem(DAILY_KEY)||"{}"); } catch { return {}; } })();
  const dates = Object.keys(d).sort().reverse();
  if (!dates.length) {
    $("history-list").innerHTML = '<p class="muted sm" style="padding:24px 0">暂无复习记录</p>';
    return;
  }
  const choiceClass = c => c === "认识" ? "ok" : c === "熟悉" ? "mid" : "bad";
  $("history-list").innerHTML = dates.map(date => {
    const val   = d[date];
    const count = typeof val === 'number' ? val : (val.count || 0);
    const words = (val && val.words) ? val.words : [];
    return `<div class="hist-day">
      <div class="hist-date">
        <span>${date}</span>
        <span class="pill">${count} 个单词</span>
      </div>
      ${words.length ? `<div class="hist-words">${words.map(w =>
        `<div class="hist-word">
          <div class="hw-left">
            <div class="hw-top">
              <span class="hw-word">${esc(w.word)}</span>
              ${w.phonetic ? `<span class="hw-phonetic">${esc(w.phonetic)}</span>` : ""}
            </div>
            <span class="hw-trans">${esc(w.trans)}</span>
            ${w.example ? `<span class="hw-example">${esc(w.example)}</span>` : ""}
          </div>
          <span class="pill ${choiceClass(w.choice)}">${esc(w.choice)}</span>
        </div>`
      ).join("")}</div>` : ""}
    </div>`;
  }).join("");
}

/* ── Init ────────────────────────────────────── */
async function loadStreakFromServer() {
  try {
    const s = await fetch("/api/streak").then(r => r.json());
    const local = JSON.parse(localStorage.getItem(STREAK_KEY)||'{"last":"","count":0}');
    if (s.last >= local.last || s.count > local.count)
      localStorage.setItem(STREAK_KEY, JSON.stringify(s));
  } catch {}
}

async function loadDailyFromServer() {
  try {
    const server = await fetch("/api/daily").then(r => r.json());
    const local  = (() => { try { return JSON.parse(localStorage.getItem(DAILY_KEY)||"{}"); } catch { return {}; } })();
    const merged = { ...local };
    for (const [date, val] of Object.entries(server)) {
      const serverCount = typeof val === 'number' ? val : (val.count || 0);
      const localVal    = merged[date];
      const localCount  = typeof localVal === 'number' ? localVal : (localVal?.count || 0);
      if (serverCount >= localCount) merged[date] = val;
    }
    localStorage.setItem(DAILY_KEY, JSON.stringify(merged));
    fetch("/api/daily", { method:"POST", headers:{"Content-Type":"application/json"}, body: JSON.stringify(merged) }).catch(()=>{});
  } catch {}
}

(async () => { await loadStreakFromServer(); await loadDailyFromServer(); await loadDecks(); })();
