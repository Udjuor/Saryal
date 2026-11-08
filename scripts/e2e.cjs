'use strict';
// Сквозная проверка программы со снимками экрана.
// CAL_EXE — путь к electron, CAL_ARGS — аргументы (например "--no-sandbox ."), SHOTS — папка снимков.
const { _electron } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const shots = path.resolve(process.env.SHOTS || 'shots');
fs.mkdirSync(shots, { recursive: true });

const STUDENTS = ['Аммосова Сайаана', 'Васильев Айсен', 'Григорьева Нюргуяна', 'Егоров Эрхан', 'Иванова Туйаара', 'Кузьмин Дьулустан', 'Николаева Сардаана', 'Петров Тимур', 'Семёнов Арсен', 'Слепцова Айыына', 'Федоров Мичил', 'Яковлева Кюннэй'];

function seed(home, lang) {
  fs.mkdirSync(home, { recursive: true });
  const students = STUDENTS.map((name, i) => ({ id: `s${i}`, name }));
  const week = {
    1: ['Математика', 'Русский язык', 'Якутский язык', 'Окружающий мир', 'Физкультура'],
    2: ['Литературное чтение', 'Математика', 'Английский язык', 'Музыка'],
    3: ['Русский язык', 'Математика', 'Технология', 'Физкультура'],
    4: ['Якутский язык', 'Математика', 'Русский язык', 'ИЗО'],
    5: ['Литературное чтение', 'Окружающий мир', 'Математика'],
    6: [],
  };
  const marks = (absent = [], sick = [], late = {}) => Object.fromEntries(students.map((s, i) => {
    if (absent.includes(i)) return [s.id, { status: 'absent' }];
    if (sick.includes(i)) return [s.id, { status: 'sick' }];
    if (late[i]) return [s.id, { status: 'present', arrived: late[i] }];
    return [s.id, { status: 'present' }];
  }));
  const attendance = {
    '2026-10-26#1': { marks: marks([], [3]) },
    '2026-10-26#2': { marks: marks([], [3]) },
    '2026-10-27#1': { marks: marks([6], [3], { 1: '08:41' }) },
    '2026-10-28#2': { marks: marks([], [], { 4: '09:33' }) },
    '2026-11-02#1': { marks: marks([], [2], { 7: '08:38' }) },
  };
  const data = {
    version: 1,
    class: { name: '3 «Б»', teacher: 'Семёнова Кэрэчээнэ', school: 'Школа № 1' },
    students,
    days: 5,
    week,
    year: { start: '2026-09-01', end: '2027-05-31' },
    holidays: [],
    changes: {},
    attendance,
    pet: { since: '2026-09-01', name: 'Чуораанчык' },
  };
  fs.writeFileSync(path.join(home, 'data.json'), JSON.stringify(data));
  if (lang) fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lang, theme: process.env.THEME || 'light' }));
  else fs.writeFileSync(path.join(home, 'settings.json'), JSON.stringify({ lang: 'ru', theme: process.env.THEME || 'light' }));
}

async function launch(home, clock) {
  const app = await _electron.launch({
    executablePath: process.env.CAL_EXE,
    args: (process.env.CAL_ARGS || '').split(' ').filter(Boolean),
    env: { ...process.env, KERDIIS_HOME: home, KERDIIS_CLOCK: clock },
  });
  const errors = [];
  const deadline = Date.now() + 20000;
  let main;
  while (!(main = app.windows().find((w) => w.url().endsWith('index.html')))) {
    if (Date.now() > deadline) throw new Error('Нет главного окна');
    await new Promise((r) => setTimeout(r, 100));
  }
  main.on('pageerror', (err) => errors.push(err.message));
  main.on('console', (msg) => msg.type() === 'error' && errors.push(msg.text()));
  await main.setViewportSize({ width: 1440, height: 900 });
  await main.waitForSelector('#page > *');
  return { app, main, errors };
}

const shot = (page, name) => page.screenshot({ path: path.join(shots, `${name}.png`) });

async function main() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'school-e2e-'));
  seed(home);
  // Понедельник 2 ноября, идёт второй урок.
  const { app, main: page, errors } = await launch(home, new Date(2026, 10, 2, 9, 31).toISOString());

  const splash = app.windows().find((w) => w.url().endsWith('splash.html'));
  if (splash) await shot(splash, 'splash').catch(() => {});

  await page.waitForSelector('#day-title:has-text("Понедельник, 2 ноября")');
  await page.waitForSelector('.lesson.state-now:has-text("Русский язык")');
  await page.waitForSelector('.lesson.state-past:has-text("Математика") .chip.ok:has-text("11 из 12")');
  await page.waitForSelector('#pet:has-text("Чуораанчык")');
  await page.waitForSelector('#certificates:has-text("Егоров Эрхан")');
  await shot(page, 'today');

  // Урок: учитель пришёл в 09:31, начинает урок; все пришли, кроме двоих.
  await page.click('.lesson.state-now .lessonbtn');
  await page.waitForSelector('#roll[open]');
  await page.click('#start-lesson');
  await page.waitForSelector('.startline:has-text("на 6 мин позже звонка")');
  await page.click('.rollcard[data-student="Петров Тимур"] .markbtn.late');
  await page.fill('.rollcard[data-student="Петров Тимур"] .latetime', '09:40');
  await page.locator('.rollcard[data-student="Петров Тимур"] .latetime').blur();
  await page.waitForSelector('.rollcard[data-student="Петров Тимур"]:has-text("опоздание 9 мин")');
  await page.click('.rollcard[data-student="Яковлева Кюннэй"] .markbtn.sick');
  await page.click('.rollcard[data-student="Федоров Мичил"] .markbtn.released');
  await page.click('#all-here');
  await page.waitForSelector('.rollsummary:has-text("На уроке: 10 из 12")');
  // Пришедший через 3 минуты после фактического начала не опоздал.
  await page.click('.rollcard[data-student="Васильев Айсен"] .markbtn.present');
  await page.click('.rollcard[data-student="Васильев Айсен"] .markbtn.late');
  await page.fill('.rollcard[data-student="Васильев Айсен"] .latetime', '09:34');
  await page.locator('.rollcard[data-student="Васильев Айсен"] .latetime').blur();
  await page.waitForSelector('.rollcard[data-student="Васильев Айсен"].code-present:has-text("не считается опозданием")');
  await shot(page, 'roll');
  await page.click('#roll .close');
  await page.waitForSelector('#roll', { state: 'hidden' });
  await page.waitForSelector('.lesson.state-now .chip.late:has-text("опоздали: 1")');

  // Справка закрывает ожидание.
  await page.click('#certificates li:has-text("Егоров Эрхан") button');
  await page.waitForSelector('#certificates li:has-text("Егоров Эрхан")', { state: 'detached' });

  // Замена на день.
  await page.click('#edit-day');
  await page.fill('#ask input[data-n="4"]', '');
  await page.click('#ask .primary');
  await page.waitForSelector('.lesson:has-text("Окружающий мир")', { state: 'detached' });

  // Расписание.
  await page.click('[data-view="week"]');
  await page.waitForSelector('.weektable');
  await page.fill('[aria-label="Пятница, 4-й урок"]', 'Родной язык');
  await page.locator('[aria-label="Пятница, 4-й урок"]').blur();
  await shot(page, 'week');

  // Класс.
  await page.click('[data-view="class"]');
  await page.fill('#new-students', '1. Новикова Айта\n2. Аммосова Сайаана');
  await page.click('.addstudents button[type=submit]');
  await page.waitForFunction(() => [...document.querySelectorAll('.students input[type=text]')].some((i) => i.value === 'Новикова Айта'));
  assert.equal(await page.locator('.students li').count(), 13, 'повтор не добавлен');
  await shot(page, 'class');

  // Отчёт за октябрь и ноябрь.
  await page.click('[data-view="report"]');
  await page.waitForSelector('#report-month:has-text("Ноябрь 2026")');
  await page.click('[aria-label="Предыдущий месяц"]');
  await page.waitForSelector('#report-month:has-text("Октябрь 2026")');
  const egorov = await page.locator('table.summary tbody tr:has-text("Егоров Эрхан") td').allTextContents();
  // №, Уроков, Был, Опозданий, Минут, Пропущено, По болезни, Без справки…
  assert.deepEqual(egorov.slice(1, 8), ['4', '1', '0', '0', '3', '3', '0'], egorov.join('|'));
  const vasiliev = await page.locator('table.summary tbody tr:has-text("Васильев Айсен") td').allTextContents();
  assert.deepEqual(vasiliev.slice(3, 5), ['1', '11']);
  await page.waitForSelector('table.bydays tr:has-text("Егоров Эрхан") td:text-is("2б")');
  await shot(page, 'report');

  await page.click('[data-view="settings"]');
  await page.waitForSelector('text=Кэрэчээнэ Семёнова');
  await shot(page, 'settings');

  // Данные записаны на диск.
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'data.json'), 'utf8'));
  assert.equal(saved.attendance['2026-11-02#2'].start, '09:31');
  assert.equal(saved.students.length, 13);
  assert.equal(saved.changes['2026-11-02'][4], '');

  assert.deepEqual(errors, []);
  await app.close();

  // Языки: якутский и английский без русских остатков в английском.
  for (const lang of ['sah', 'en']) {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), `school-${lang}-`));
    seed(folder, lang);
    const run = await launch(folder, new Date(2026, 10, 2, 9, 31).toISOString());
    const leftovers = [];
    for (const target of ['today', 'week', 'class', 'report', 'settings']) {
      await run.main.click(`[data-view="${target}"]`);
      await run.main.waitForTimeout(250);
      if (target === 'report') await run.main.click('#page .reportbar button:first-child');
      await run.main.waitForTimeout(150);
      await shot(run.main, `${lang}-${target}`);
      const text = await run.main.evaluate(() => {
        const skip = new Set([...document.querySelectorAll('input, textarea, .rollname, .subject, table.report tbody th, #class-title, #class-teacher, .students, .plainlist strong, .petcard h3, .about p:nth-child(3), .about .muted, .printhead, button[lang]')]);
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        const found = [];
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if ([...skip].some((el) => el.contains(node.parentElement))) continue;
          if (node.parentElement.closest('[hidden], script, datalist')) continue;
          if (/[А-Яа-яЁё]/.test(node.nodeValue)) found.push(node.nodeValue.trim());
        }
        return found;
      });
      if (lang === 'en') leftovers.push(...text.map((x) => `${target}: ${x}`));
    }
    await run.main.click('[data-view="today"]');
    await run.main.click('.lesson.state-now .lessonbtn');
    await run.main.waitForSelector('#roll[open]');
    await shot(run.main, `${lang}-roll`);
    assert.deepEqual(run.errors, []);
    await run.app.close();
    assert.deepEqual(leftovers, [], 'русский текст в английском интерфейсе');
  }
  console.log('Все сценарии пройдены');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
