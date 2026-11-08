import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { interfaceKeys } from '../scripts/i18n-keys.mjs';
import { readPhrases } from '../scripts/build-locales.mjs';
import sah from '../src/renderer/locales/sah.mjs';
import en from '../src/renderer/locales/en.mjs';
import { longDate, monthTitle, setLanguage, shortDate, t, tp } from '../src/renderer/i18n.mjs';

test('каждая фраза интерфейса переведена на якутский и английский', () => {
  for (const key of interfaceKeys()) {
    assert.ok(sah.strings[key], `нет якутского: ${key}`);
    assert.ok(en.strings[key], `нет английского: ${key}`);
  }
});

test('словари собраны из актуальной таблицы фраз', () => {
  for (const phrase of readPhrases()) {
    assert.equal(sah.strings[phrase.ru], phrase.sah, `пересоберите словари: ${phrase.ru}`);
    assert.equal(en.strings[phrase.ru], phrase.en, `пересоберите словари: ${phrase.ru}`);
  }
});

test('в переводе остаются все подставляемые значения', () => {
  for (const key of interfaceKeys().filter((k) => !k.includes('|'))) {
    const need = [...key.matchAll(/\{\d\}/g)].map((m) => m[0]).sort();
    for (const dict of [sah, en]) assert.deepEqual([...dict.strings[key].matchAll(/\{\d\}/g)].map((m) => m[0]).sort(), need, key);
  }
});

test('русский текст вне t() не попадает в интерфейс', () => {
  const code = readFileSync(new URL('../src/renderer/app.js', import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//'))
    .join('\n')
    .replace(/\bt\('(?:[^'\\]|\\.)*'/g, '')
    .replace(/localeCompare\(b\.name, 'ru'\)|toLocaleLowerCase\('ru'\)/g, '');
  assert.deepEqual(code.match(/'[^'\n]*[А-Яа-яЁё][^'\n]*'/g) ?? [], []);
});

test('даты на трёх языках', () => {
  setLanguage('ru');
  assert.equal(longDate('2026-11-02'), 'Понедельник, 2 ноября');
  assert.equal(tp('lessons', 3), '3 урока');
  setLanguage('sah');
  assert.equal(longDate('2026-11-02'), 'Бэнидиэнньик, сэтинньи 2 күнэ');
  assert.equal(shortDate('2026-11-02'), 'сэтинньи 2 күнэ');
  assert.equal(monthTitle('2026-11'), 'Сэтинньи 2026');
  assert.equal(tp('lessons', 3), '3 уруок');
  setLanguage('en');
  assert.equal(longDate('2026-11-02'), 'Monday, 2 November');
  assert.equal(tp('students', 1), '1 pupil');
  assert.equal(t('На уроке: {0} из {1}', [5, 7]), 'In class: 5 of 7');
  setLanguage('ru');
});
