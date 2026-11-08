// Собирает словари из i18n/phrases.tsv: столбцы ru, sah, en, разделитель — табуляция.
// Запуск: node scripts/build-locales.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const PLURALS = {
  sah: { students: { other: '{n} үөрэнээччи' }, lessons: { other: '{n} уруок' }, minutes: { other: '{n} мүнүүтэ' } },
  en: {
    students: { one: '{n} pupil', other: '{n} pupils' },
    lessons: { one: '{n} lesson', other: '{n} lessons' },
    minutes: { one: '{n} minute', other: '{n} minutes' },
  },
};

export function readPhrases(file = new URL('../i18n/phrases.tsv', import.meta.url)) {
  const [head, ...lines] = readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/).filter((line) => line.trim());
  const columns = head.split('\t');
  return lines.map((line) => Object.fromEntries(line.split('\t').map((cell, i) => [columns[i], cell.trim()])));
}

if (process.argv[1]?.endsWith('build-locales.mjs')) {
  const phrases = readPhrases();
  for (const lang of ['sah', 'en']) {
    const strings = Object.fromEntries(phrases.filter((p) => p[lang]).map((p) => [p.ru, p[lang]]));
    const text = `// Создан scripts/build-locales.mjs из i18n/phrases.tsv. Правьте таблицу, а не этот файл.\nexport default ${JSON.stringify({ strings, plurals: PLURALS[lang] }, null, 2)};\n`;
    writeFileSync(new URL(`../src/renderer/locales/${lang}.mjs`, import.meta.url), text);
    console.log(lang, Object.keys(strings).length);
  }
}
