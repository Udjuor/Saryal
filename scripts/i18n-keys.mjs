// Все фразы интерфейса, которые нужно перевести: из t('…') в коде, из названий
// месяцев и дней и из постоянных надписей HTML.
import { readFileSync } from 'node:fs';

const read = (file) => readFileSync(new URL(`../src/renderer/${file}`, import.meta.url), 'utf8');
const unquote = (text) => text.replace(/\\'/g, "'");

export function interfaceKeys() {
  const keys = new Set();
  for (const file of ['app.js', 'i18n.mjs', 'splash.mjs']) {
    for (const [, key] of read(file).matchAll(/\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(unquote(key));
  }
  for (const [, list] of read('i18n.mjs').matchAll(/^const (?:MONTHS|MONTHS_OF|WEEKDAY_NAMES) = \[(.*)\];$/gm)) {
    for (const [, word] of list.matchAll(/'([^']+)'/g)) keys.add(word);
  }
  for (const file of ['index.html', 'splash.html']) {
    const html = read(file).replace(/<script[\s\S]*?<\/script>|<title>[\s\S]*?<\/title>/g, '');
    for (const [, text] of html.matchAll(/>([^<>]*[А-Яа-яЁё][^<>]*)</g)) keys.add(text.trim());
    for (const [, text] of html.matchAll(/(?:aria-label|title)="([^"]*[А-Яа-яЁё][^"]*)"/g)) keys.add(text);
  }
  return [...keys].filter((key) => /[А-Яа-яЁё]|\{\d\}/.test(key));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  for (const key of interfaceKeys()) console.log(key);
}
