// Builds index.html (multi-file, opens from disk) and dist/lpg-terminal.html (single self-contained page).
'use strict';
const fs = require('fs');
const path = require('path');
const files = require('./files.js');
const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const head = read('tools/head.html').trim();
const body = read('tools/body.html').trim();
const scripts = files.core.concat(files.ui);

const index = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + head + '\n' +
  files.css.map((c) => '<link rel="stylesheet" href="' + c + '">').join('\n') + '\n</head>\n<body>\n' + body + '\n' +
  scripts.map((s) => '<script src="' + s + '"></script>').join('\n') + '\n</body>\n</html>\n';
fs.writeFileSync(path.join(root, 'index.html'), index);

// Single-file page: the artifact host supplies the document skeleton, so this is a fragment.
const css = files.css.map(read).join('\n');
const js = scripts.map((s) => '// ---- ' + s + '\n' + read(s)).join('\n');
const single = head + '\n<style>\n' + css + '\n</style>\n' + body + '\n<script>\n' + js.replace(/<\/script/gi, '<\\/script') + '\n</script>\n';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'lpg-terminal.html'), single);
// A full standalone document too, for opening the single file directly.
fs.writeFileSync(path.join(root, 'dist', 'harrowmere-standalone.html'), '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n' + single.replace(body, '</head>\n<body>\n' + body).replace(/<\/script>\n$/, '</script>\n</body>\n</html>\n'));
console.log('index.html, dist/lpg-terminal.html (' + Math.round(single.length / 1024) + ' KB), dist/harrowmere-standalone.html');
