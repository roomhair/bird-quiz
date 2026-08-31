#!/usr/bin/env node
/**
 * css/js を index.html に埋め込んだ単体ファイルを dist/ に書き出す。
 * ダブルクリックで開けるので、配布や共有にはこちらを使う。
 *   node build-standalone.js
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

let html = read('index.html');

html = html.replace(
  /[ \t]*<link rel="stylesheet" href="css\/style\.css">\n/,
  `<style>\n${read('css/style.css').trimEnd()}\n</style>\n`
);

html = html.replace(
  /[ \t]*<script src="js\/data\.js"><\/script>\n[ \t]*<script src="js\/engine\.js"><\/script>\n/,
  `<script>\n${read('js/data.js').trimEnd()}\n${read('js/engine.js').trimEnd()}\n</script>\n`
);

for (const leftover of [/href="css\//, /src="js\//]) {
  if (leftover.test(html)) {
    console.error('埋め込みに失敗しました: index.html の参照の書き方が変わっていないか確認してください');
    process.exit(1);
  }
}

const out = path.join(root, 'dist', 'bird-quiz.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`${path.relative(root, out)} (${(Buffer.byteLength(html) / 1024).toFixed(1)} KB)`);
