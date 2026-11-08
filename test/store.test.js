'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../src/main/store');
const { buildXlsx } = require('../src/main/xlsx');

const normalize = (raw) => ({ students: [], ...(raw ?? {}) });
const tempHome = (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'school-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

test('запись и чтение данных класса', async (t) => {
  const home = tempHome(t);
  const store = new Store(home, normalize, () => '2026-11-02');
  await store.save({ students: [{ id: 'a', name: 'Аня' }] });
  assert.deepEqual(new Store(home, normalize, () => '2026-11-02').load().students, [{ id: 'a', name: 'Аня' }]);
  assert.ok(!fs.existsSync(path.join(home, 'data.json.tmp')));
});

test('испорченный файл откладывается, программа открывается с пустыми данными', (t) => {
  const home = tempHome(t);
  fs.writeFileSync(path.join(home, 'data.json'), '{ сломано');
  const data = new Store(home, normalize, () => '2026-11-02').load();
  assert.deepEqual(data.students, []);
  assert.ok(fs.readdirSync(home).some((name) => name.startsWith('data.json.broken-')));
});

test('копия за день одна, хранятся последние 30', async (t) => {
  const home = tempHome(t);
  let day = 1;
  const store = new Store(home, normalize, () => `2026-10-${String(day).padStart(2, '0')}`);
  await store.save({ students: [] });
  for (day = 1; day <= 31; day += 1) await store.dailyBackup();
  await store.dailyBackup();
  const names = fs.readdirSync(path.join(home, 'backups'));
  assert.equal(names.length, 30);
  assert.ok(!names.includes('Kerdiis-School-2026-10-01.json'));
});

test('восстановление из копии сохраняет текущие данные и отвергает чужой файл', async (t) => {
  const home = tempHome(t);
  const store = new Store(home, normalize, () => '2026-11-02');
  await store.save({ students: [{ id: 'now', name: 'Сейчас' }] });
  const backup = path.join(home, 'copy.json');
  fs.writeFileSync(backup, JSON.stringify({ students: [{ id: 'old', name: 'Было' }] }));
  const data = await store.importFrom(backup);
  assert.equal(data.students[0].id, 'old');
  assert.ok(fs.readdirSync(path.join(home, 'backups')).some((name) => name.includes('before-restore')));
  fs.writeFileSync(backup, '{"hello":1}');
  await assert.rejects(store.importFrom(backup), { code: 'not-backup' });
});

test('книга Excel: ZIP с листами и строками', () => {
  const book = buildXlsx([{ name: 'Итоги: ноябрь', rows: [['ФИО', 'Пропущено'], ['Аня', 3]], boldRows: [0] }, { name: 'Итоги: ноябрь', rows: [] }]);
  assert.equal(book.readUInt32LE(0), 0x04034b50);
  const text = book.toString('latin1');
  assert.ok(text.includes('xl/worksheets/sheet2.xml'));
});
