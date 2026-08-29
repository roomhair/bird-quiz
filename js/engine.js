'use strict';

/* =========================================================
   写真あてクイズ エンジン（題材非依存）

   data.js が定義する QUIZ を読んで動く。QUIZ の形は data.js の
   先頭コメントを参照。このファイルは題材を知らないので、別の
   クイズを作るときは data.js だけ差し替えればよい。

   題材ごとに変えたくなるところは QUIZ の任意フックで差し替える。
   未指定なら既定の動きになる。
     keys        キーボードショートカットに使う文字の並び
     distractors (question, pool, n) => ダミーの選択肢。既定はプールからランダム
     detailSub   (q, answer) => 解説カードの2行目（学名など）
     reviewSub   (q, answer) => 結果一覧の副題。既定は正解の名前
     roster      () => スタート画面の一覧のHTML。既定は選択肢の平坦な一覧
   ========================================================= */

const $ = (id) => document.getElementById(id);
const byId = Object.fromEntries(QUIZ.choices.map((c) => [c.id, c]));
const KEYS = (QUIZ.keys || 'ASDFGHJKLZXCVBNM').split(''); // 選択肢に順に割り当てるショートカット

const state = {
  queue: [],       // { question, choices } の配列
  index: 0,
  answers: [],     // { question, picked, correct }
  answered: false,
  requestedCount: 10,
};

/* ---------- 画像の取得 ------------------------------------
   image が指定されていればそれを使う。無ければ Wikipedia の
   REST API から記事の代表画像を引く（ja → en の順）。
   結果は sessionStorage にキャッシュする。            */

const IMG_CACHE_KEY = `quiz.img.${QUIZ.id}.v1`;
const imgCache = loadCache();

function loadCache() {
  try { return JSON.parse(sessionStorage.getItem(IMG_CACHE_KEY)) || {}; }
  catch (_) { return {}; }
}
function saveCache() {
  try { sessionStorage.setItem(IMG_CACHE_KEY, JSON.stringify(imgCache)); }
  catch (_) { /* プライベートモード等では黙って諦める */ }
}

// サムネイルURLの幅指定（.../320px-Foo.jpg）を大きめに書き換える
function upscale(url) {
  return url.replace(/\/\d{2,4}px-/, '/1280px-');
}

async function fetchWikiImage(lang, title) {
  const endpoint = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
  const res = await fetch(endpoint, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = await res.json();
  const src = (data.thumbnail && data.thumbnail.source) ||
              (data.originalimage && data.originalimage.source);
  if (!src) return null;
  return {
    url: upscale(src),
    page: (data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page) ||
          `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    label: lang === 'ja' ? 'Wikipedia（日本語）' : 'Wikipedia (English)',
  };
}

async function resolveImage(q) {
  if (q.image) return { url: q.image, page: null, label: null };
  if (imgCache[q.id]) return imgCache[q.id];

  const candidates = [['ja', q.wiki && q.wiki.ja], ['en', q.wiki && q.wiki.en]];
  for (const [lang, title] of candidates) {
    if (!title) continue;
    try {
      const found = await fetchWikiImage(lang, title);
      if (found) { imgCache[q.id] = found; saveCache(); return found; }
    } catch (_) { /* 次の候補へ */ }
  }
  return null;
}

// 次の問題の画像を先読みして待ち時間を減らす
function prefetch(entry) {
  if (!entry) return;
  resolveImage(entry.question).then((info) => {
    if (info) { const im = new Image(); im.src = info.url; }
  }).catch(() => {});
}

/* ---------- ユーティリティ ---------- */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// その問題で並べる選択肢。choicesPerQuestion が選択肢総数より少なければ、
// 正解＋ダミーを抜き出す。0 や未指定なら常に全選択肢。
// ダミーの選び方は QUIZ.distractors(question, pool, n) で差し替えられる。
// 未指定ならプールからランダムに取る。
function choicesFor(q) {
  const n = QUIZ.choicesPerQuestion;
  if (!n || n >= QUIZ.choices.length) return QUIZ.choices;
  const pool = QUIZ.choices.filter((c) => c.id !== q.answer);
  const decoys = (QUIZ.distractors ? QUIZ.distractors(q, pool, n - 1) : shuffle(pool))
    .slice(0, n - 1);
  return shuffle([byId[q.answer], ...decoys]);
}

// できるだけ正解が偏らないように出題を選ぶ
function buildQueue(count) {
  const byAnswer = new Map();
  for (const q of shuffle(QUIZ.questions)) {
    if (!byAnswer.has(q.answer)) byAnswer.set(q.answer, []);
    byAnswer.get(q.answer).push(q);
  }
  const groups = shuffle([...byAnswer.values()]);
  const picked = [];
  for (let round = 0; picked.length < QUIZ.questions.length; round++) {
    let added = false;
    for (const g of groups) {
      if (g[round]) { picked.push(g[round]); added = true; }
    }
    if (!added) break;
  }
  const total = count > 0 ? Math.min(count, picked.length) : picked.length;
  return shuffle(picked.slice(0, total))
    .map((question) => ({ question, choices: choicesFor(question) }));
}

function showScreen(name) {
  for (const s of ['start', 'quiz', 'result']) {
    $(`screen-${s}`).hidden = (s !== name);
  }
  window.scrollTo(0, 0);
}

/* ---------- スタート画面 ---------- */

// 対応する要素が無い題材もあるので、見つからなければ黙って飛ばす
function fill(id, html) {
  const el = $(id);
  if (el && html != null) el.innerHTML = html;
}

function applyCopy() {
  document.title = QUIZ.title;
  fill('site-title', QUIZ.title);
  fill('lead', QUIZ.lead);
  fill('lead-sub', QUIZ.leadSub);
  fill('prompt', QUIZ.prompt);
  fill('roster-title', QUIZ.rosterTitle);
  fill('roster-count', QUIZ.rosterCount);
  fill('credit', QUIZ.credit);
  $('choices').setAttribute('aria-label', QUIZ.prompt);

  // 一覧の見せ方は QUIZ.roster() で差し替えられる（グループ分けしたい題材向け）
  $('roster-list').innerHTML = QUIZ.roster
    ? QUIZ.roster()
    : QUIZ.choices.map((c) => `<li>${c.name}<span>${c.sub || ''}</span></li>`).join('');

  // 出題数の選択肢は問題数に合わせて出し入れする
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    const n = Number(btn.dataset.count);
    btn.hidden = n > 0 && n >= QUIZ.questions.length;
  });
  const visible = [...document.querySelectorAll('.seg-btn')].filter((b) => !b.hidden);
  selectCount(visible[0]);
}

function selectCount(btn) {
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('is-active', b === btn);
    b.setAttribute('aria-checked', String(b === btn));
  });
  state.requestedCount = Number(btn.dataset.count);
}

function initStart() {
  applyCopy();
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => selectCount(btn));
  });
  $('btn-start').addEventListener('click', startQuiz);
}

/* ---------- 出題 ---------- */

function startQuiz() {
  state.queue = buildQueue(state.requestedCount);
  state.index = 0;
  state.answers = [];
  showScreen('quiz');
  renderQuestion();
}

function renderChoices(choices) {
  const box = $('choices');
  box.innerHTML = '';
  choices.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.dataset.choice = c.id;
    btn.innerHTML = `<span class="key">${KEYS[i] || ''}</span>${c.name}`;
    btn.addEventListener('click', () => answer(c.id));
    box.appendChild(btn);
  });
}

async function renderQuestion() {
  const entry = state.queue[state.index];
  const q = entry.question;
  state.answered = false;

  $('progress-text').textContent = `${state.index + 1} / ${state.queue.length}`;
  $('score-text').textContent = `正解 ${state.answers.filter((a) => a.correct).length}`;
  $('progress-fill').style.width = `${(state.index / state.queue.length) * 100}%`;

  $('verdict').hidden = true;
  $('photo-caption').hidden = true;
  renderChoices(entry.choices);

  const frame = $('photo-frame');
  const img = $('photo-img');
  frame.classList.remove('is-ready');
  frame.classList.add('is-loading');
  img.removeAttribute('src');
  $('photo-status').innerHTML = '<span class="spinner"></span>';

  const token = q.id;                       // 読み込み中に次へ進んだ場合の取り違え防止
  const info = await resolveImage(q);
  if (state.queue[state.index].question.id !== token) return;

  if (!info) { failPhoto('写真を読み込めませんでした。<br>オフラインの可能性があります。'); return; }

  img.onload = () => {
    if (state.queue[state.index].question.id !== token) return;
    frame.classList.remove('is-loading');
    frame.classList.add('is-ready');
  };
  img.onerror = () => {
    if (state.queue[state.index].question.id !== token) return;
    failPhoto('写真を読み込めませんでした。');
  };
  img.src = info.url;
  q._source = info;

  prefetch(state.queue[state.index + 1]);
}

function failPhoto(message) {
  $('photo-frame').classList.remove('is-ready');
  $('photo-status').innerHTML = message;
}

/* ---------- 解答 ---------- */

function answer(choiceId) {
  if (state.answered) return;
  state.answered = true;

  const q = state.queue[state.index].question;
  const correct = choiceId === q.answer;
  state.answers.push({ question: q, picked: choiceId, correct });

  document.querySelectorAll('.choice').forEach((btn) => {
    btn.disabled = true;
    const id = btn.dataset.choice;
    if (id === q.answer) btn.classList.add('is-correct');
    else if (id === choiceId) btn.classList.add('is-wrong');
    else btn.classList.add('is-dim');
  });

  const line = $('verdict-line');
  line.textContent = correct ? '正解' : `不正解 — 正解は ${byId[q.answer].name}`;
  line.className = `verdict-line ${correct ? 'ok' : 'ng'}`;

  $('detail-title').textContent = q.title;
  $('detail-meta').textContent = QUIZ.meta(q, byId[q.answer]);
  $('detail-note').textContent = q.note;

  const sub = $('detail-sub');
  if (sub) {
    const text = QUIZ.detailSub ? QUIZ.detailSub(q, byId[q.answer]) : '';
    sub.textContent = text || '';
    sub.hidden = !text;
  }

  const page = q._source && q._source.page;
  const link = $('detail-link');
  link.hidden = !page;
  if (page) link.href = page;

  // 出典表示は解答後に（記事名が答えのヒントになるため）
  if (page) {
    const cap = $('photo-caption');
    cap.innerHTML = `写真: <a href="${page}" target="_blank" rel="noopener">${q._source.label}</a> より`;
    cap.hidden = false;
  }

  $('score-text').textContent = `正解 ${state.answers.filter((a) => a.correct).length}`;
  $('progress-fill').style.width = `${((state.index + 1) / state.queue.length) * 100}%`;

  $('verdict').hidden = false;
  $('btn-next').textContent = state.index === state.queue.length - 1 ? '結果を見る' : '次の問題へ';
  $('btn-next').focus();
}

function next() {
  if (!state.answered) return;
  if (state.index === state.queue.length - 1) { showResult(); return; }
  state.index++;
  renderQuestion();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/* ---------- 結果 ---------- */

function showResult() {
  const total = state.answers.length;
  const correct = state.answers.filter((a) => a.correct).length;
  const rate = correct / total;
  const [, rank, comment] = QUIZ.grades.find(([min]) => rate >= min);

  $('result-rank').textContent = rank;
  $('result-correct').textContent = correct;
  $('result-total').textContent = total;
  $('result-comment').textContent = comment;

  $('review-list').innerHTML = state.answers.map(({ question: q, picked, correct: ok }) => {
    const answer = byId[q.answer];
    const sub = QUIZ.reviewSub ? QUIZ.reviewSub(q, answer) : answer.name;
    return `
    <li>
      <span class="mark ${ok ? 'ok' : 'ng'}">${ok ? '○' : '×'}</span>
      <span class="review-body">
        <span class="review-title">${q.title}</span><br>
        <span class="review-sub">${sub}${
          ok ? '' : ` — 回答: <span class="picked">${byId[picked].name}</span>`
        }</span>
      </span>
    </li>`;
  }).join('');

  showScreen('result');
}

/* ---------- テーマ ---------- */

function initTheme() {
  const key = `quiz.theme.${QUIZ.id}`;
  const saved = (() => { try { return localStorage.getItem(key); } catch (_) { return null; } })();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

  $('theme-toggle').addEventListener('click', () => {
    const nextTheme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    try { localStorage.setItem(key, nextTheme); } catch (_) {}
  });
}

/* ---------- キーボード ---------- */

function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if ($('screen-quiz').hidden || e.metaKey || e.ctrlKey || e.altKey) return;
    if (state.answered) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); next(); }
      return;
    }
    const i = KEYS.indexOf(e.key.toUpperCase());
    const choices = state.queue[state.index].choices;
    if (i >= 0 && choices[i]) { e.preventDefault(); answer(choices[i].id); }
  });
}

/* ---------- 起動 ---------- */

initTheme();
initStart();
initKeyboard();
$('btn-next').addEventListener('click', next);
$('btn-retry').addEventListener('click', startQuiz);
$('btn-home').addEventListener('click', () => showScreen('start'));
