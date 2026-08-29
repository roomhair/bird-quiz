'use strict';

/* =========================================================
   世界の鳥あてクイズ
   ========================================================= */

const $ = (id) => document.getElementById(id);
const byId = Object.fromEntries(BIRDS.map((b) => [b.id, b]));
const groupLabel = Object.fromEntries(GROUPS.map((g) => [g.id, g.label]));

const CHOICE_COUNT = 10;                  // 1問あたりの選択肢の数
const KEYS = '1234567890'.split('');      // 選択肢1〜10に割り当てるショートカット

const state = {
  queue: [],       // { bird, choices } の配列
  index: 0,
  answers: [],     // { bird, choices, picked, correct }
  answered: false,
  requestedCount: 10,
};

/* ---------- 画像の取得 ------------------------------------
   image が指定されていればそれを使う。無ければ Wikipedia の
   REST API から記事の代表画像を引く（ja → en の順）。
   結果は sessionStorage にキャッシュする。            */

const IMG_CACHE_KEY = 'birdquiz.img.v1';
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

async function resolveImage(bird) {
  if (bird.image) return { url: bird.image, page: null, label: null };
  if (imgCache[bird.id]) return imgCache[bird.id];

  const candidates = [['ja', bird.wiki && bird.wiki.ja], ['en', bird.wiki && bird.wiki.en]];
  for (const [lang, title] of candidates) {
    if (!title) continue;
    try {
      const found = await fetchWikiImage(lang, title);
      if (found) { imgCache[bird.id] = found; saveCache(); return found; }
    } catch (_) { /* 次の候補へ */ }
  }
  return null;
}

// 次の問題の画像を先読みして待ち時間を減らす
function prefetch(item) {
  if (!item) return;
  resolveImage(item.bird).then((info) => {
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

function randInt(min, max) {           // min 以上 max 以下
  return min + Math.floor(Math.random() * (max - min + 1));
}

/* ---------- 選択肢の組み立て ------------------------------
   正解1 + ダミー9 の計10個。ダミーはまず同じグループから
   3〜5種を取り、残りを他のグループから埋める。こうすると
   「ペンギンばかり」にも「まったくの寄せ集め」にもならない。
   毎問組み直すので、同じ鳥でも並ぶ顔ぶれは毎回変わる。   */

function buildChoices(bird) {
  const near = shuffle(BIRDS.filter((b) => b.id !== bird.id && b.group === bird.group));
  const far  = shuffle(BIRDS.filter((b) => b.id !== bird.id && b.group !== bird.group));

  const nearWanted = Math.min(near.length, randInt(3, 5));
  const decoys = near.slice(0, nearWanted)
    .concat(far)
    .slice(0, CHOICE_COUNT - 1);

  return shuffle([bird, ...decoys]);
}

// できるだけグループが偏らないように出題する鳥を選ぶ
function pickQuestions(count) {
  const byGroup = new Map();
  for (const b of shuffle(BIRDS)) {
    if (!byGroup.has(b.group)) byGroup.set(b.group, []);
    byGroup.get(b.group).push(b);
  }
  const groups = shuffle([...byGroup.values()]);
  const picked = [];
  let round = 0;
  while (picked.length < BIRDS.length) {
    let added = false;
    for (const g of groups) {
      if (g[round]) { picked.push(g[round]); added = true; }
    }
    if (!added) break;
    round++;
  }
  const total = count > 0 ? Math.min(count, picked.length) : picked.length;
  return shuffle(picked.slice(0, total))
    .map((bird) => ({ bird, choices: buildChoices(bird) }));
}

function showScreen(name) {
  for (const s of ['start', 'quiz', 'result']) {
    $(`screen-${s}`).hidden = (s !== name);
  }
  window.scrollTo(0, 0);
}

/* ---------- スタート画面 ---------- */

function renderRoster() {
  $('roster-count').textContent = `全${BIRDS.length}種`;
  $('roster-list').innerHTML = GROUPS.map((g) => {
    const members = BIRDS.filter((b) => b.group === g.id);
    return `<li>
      <span class="roster-group">${g.label}<span class="roster-num">${members.length}種</span></span>
      <span class="roster-members">${members.map((b) => b.name).join('・')}</span>
    </li>`;
  }).join('');
}

function initStart() {
  renderRoster();
  document.querySelectorAll('.seg-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.seg-btn').forEach((b) => {
        b.classList.toggle('is-active', b === btn);
        b.setAttribute('aria-checked', String(b === btn));
      });
      state.requestedCount = Number(btn.dataset.count);
    });
  });
  $('btn-start').addEventListener('click', startQuiz);
}

/* ---------- 出題 ---------- */

function startQuiz() {
  state.queue = pickQuestions(state.requestedCount);
  state.index = 0;
  state.answers = [];
  showScreen('quiz');
  renderQuestion();
}

function renderChoices(item) {
  const box = $('choices');
  box.innerHTML = '';
  item.choices.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'choice';
    btn.dataset.bird = b.id;
    btn.innerHTML = `<span class="key">${KEYS[i] || ''}</span>${b.name}`;
    btn.addEventListener('click', () => answer(b.id));
    box.appendChild(btn);
  });
}

async function renderQuestion() {
  const item = state.queue[state.index];
  const bird = item.bird;
  state.answered = false;

  $('progress-text').textContent = `${state.index + 1} / ${state.queue.length}`;
  $('score-text').textContent = `正解 ${state.answers.filter((a) => a.correct).length}`;
  $('progress-fill').style.width = `${(state.index / state.queue.length) * 100}%`;

  $('verdict').hidden = true;
  $('photo-caption').hidden = true;
  renderChoices(item);                      // 選択肢は問題ごとに作り直す

  const frame = $('photo-frame');
  const img = $('photo-img');
  frame.classList.remove('is-ready');
  frame.classList.add('is-loading');
  img.removeAttribute('src');
  $('photo-status').innerHTML = '<span class="spinner"></span>';

  const token = bird.id;                    // 読み込み中に次へ進んだ場合の取り違え防止
  const info = await resolveImage(bird);
  if (state.queue[state.index].bird.id !== token) return;

  if (!info) { failPhoto('写真を読み込めませんでした。<br>オフラインの可能性があります。'); return; }

  img.onload = () => {
    if (state.queue[state.index].bird.id !== token) return;
    frame.classList.remove('is-loading');
    frame.classList.add('is-ready');
  };
  img.onerror = () => {
    if (state.queue[state.index].bird.id !== token) return;
    failPhoto('写真を読み込めませんでした。');
  };
  img.src = info.url;
  item.source = info;

  prefetch(state.queue[state.index + 1]);
}

function failPhoto(message) {
  const frame = $('photo-frame');
  frame.classList.remove('is-ready');
  $('photo-status').innerHTML = message;
}

/* ---------- 解答 ---------- */

function answer(birdId) {
  if (state.answered) return;
  state.answered = true;

  const item = state.queue[state.index];
  const bird = item.bird;
  const correct = birdId === bird.id;
  state.answers.push({ bird, choices: item.choices, picked: birdId, correct });

  document.querySelectorAll('.choice').forEach((btn) => {
    btn.disabled = true;
    const id = btn.dataset.bird;
    if (id === bird.id) btn.classList.add('is-correct');
    else if (id === birdId) btn.classList.add('is-wrong');
    else btn.classList.add('is-dim');
  });

  const line = $('verdict-line');
  line.textContent = correct ? '正解' : `不正解 — 正解は ${bird.name}`;
  line.className = `verdict-line ${correct ? 'ok' : 'ng'}`;

  $('detail-title').textContent = `${bird.name}（${bird.en}）`;
  $('detail-sci').textContent = bird.sci;
  $('detail-meta').textContent = `${bird.taxon}／${bird.region}／${bird.size}`;
  $('detail-note').textContent = bird.note;

  const link = $('detail-link');
  const page = item.source && item.source.page;
  link.hidden = !page;
  if (page) link.href = page;

  // 出典表示は解答後に（記事名が答えのヒントになるため）
  if (item.source && item.source.page) {
    const cap = $('photo-caption');
    cap.innerHTML = `写真: <a href="${item.source.page}" target="_blank" rel="noopener">${item.source.label}</a> より`;
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

  const grades = [
    [0.999, '鳥類学者', '全問正解。図鑑を1冊書けます。'],
    [0.8,   'バードウォッチャー', '嘴と脚の形まで見えています。'],
    [0.6,   '愛鳥家', '世界の主要な鳥はしっかり押さえています。'],
    [0.4,   '観察見習い', '大きさ・嘴の形・棲む場所の3点に注目すると絞り込めます。'],
    [0,     '初学者', 'まずは大きなグループの見分けから。もう一周してみましょう。'],
  ];
  const [, rank, comment] = grades.find(([min]) => rate >= min);

  $('result-rank').textContent = rank;
  $('result-correct').textContent = correct;
  $('result-total').textContent = total;
  $('result-comment').textContent = comment;

  $('review-list').innerHTML = state.answers.map(({ bird, picked, correct: ok }) => `
    <li>
      <span class="mark ${ok ? 'ok' : 'ng'}">${ok ? '○' : '×'}</span>
      <span class="review-body">
        <span class="review-title">${bird.name}</span><br>
        <span class="review-sub">${groupLabel[bird.group]}／${bird.region}${
          ok ? '' : ` — 回答: <span class="picked">${byId[picked].name}</span>`
        }</span>
      </span>
    </li>`).join('');

  showScreen('result');
}

/* ---------- テーマ ---------- */

function initTheme() {
  const saved = (() => { try { return localStorage.getItem('birdquiz.theme'); } catch (_) { return null; } })();
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = saved || (prefersDark ? 'dark' : 'light');

  $('theme-toggle').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('birdquiz.theme', next); } catch (_) {}
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
    const i = KEYS.indexOf(e.key);
    const choices = state.queue[state.index] && state.queue[state.index].choices;
    if (i >= 0 && choices && choices[i]) { e.preventDefault(); answer(choices[i].id); }
  });
}

/* ---------- 起動 ---------- */

initTheme();
initStart();
initKeyboard();
$('btn-next').addEventListener('click', next);
$('btn-retry').addEventListener('click', startQuiz);
$('btn-home').addEventListener('click', () => showScreen('start'));
