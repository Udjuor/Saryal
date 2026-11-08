import {
  ABSENT_FROM_MINUTE, LATE_FROM_MINUTE, WEEKDAYS, actualStart, addDays, dayCell, fromMinutes, holidayOn,
  isDate, isSchoolDay, isTime, lessonByKey, lessonState, lessonSummary, lessonsOn, makeBells, monthReport,
  normalizeData, nowParts, parseNames, pendingCertificates, percent, rollCall, startDelay, toMinutes, weekday,
} from './logic.mjs';
import { LANGUAGES, language, longDate, monthTitle, shortDate, t, tp, translatePage, weekdayName } from './i18n.mjs';
import { petSprite, petStatus } from './pet.mjs';

const api = window.school;
const page = document.getElementById('page');
const rollDialog = document.getElementById('roll');
const askDialog = document.getElementById('ask');

const now = () => nowParts(new Date(Date.now() + api.clockOffset));

let data = null;
let view = 'today';
let day = now().iso;
let reportMonth = now().iso.slice(0, 7);
let openKey = null;

/* Маленький помощник для разметки: h('div', { class: 'x' }, детские узлы). */
function h(tag, attrs = {}, ...children) {
  const element = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs ?? {})) {
    if (value === false || value == null) continue;
    if (name.startsWith('on')) element.addEventListener(name.slice(2), value);
    else if (name === 'style') Object.assign(element.style, value);
    else if (name === 'value') element.value = value;
    else if (name === 'checked') element.checked = value;
    else element.setAttribute(name, value === true ? '' : value);
  }
  element.append(...children.flat(Infinity).filter((child) => child != null && child !== false && child !== ''));
  return element;
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

function toast(text) {
  const box = document.getElementById('toast');
  box.textContent = text;
  box.classList.add('shown');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => box.classList.remove('shown'), 2600);
}

/** Сохраняет данные. Ошибка записи видна сразу: отметки не должны теряться молча. */
async function commit() {
  const result = await api.save(data);
  if (!result.ok) toast(t('Не удалось сохранить: {0}', [result.message]));
}

function change(mutate) {
  mutate(data);
  commit();
  render();
}

/** Своё окно подтверждения: системное на сенсорной доске неудобно. */
function ask(text, yes, { danger = false, no = t('Отмена') } = {}) {
  return new Promise((resolve) => {
    const close = (answer) => {
      askDialog.close();
      resolve(answer);
    };
    askDialog.replaceChildren(
      h('p', {}, text),
      h('div', { class: 'actions' },
        h('button', { type: 'button', class: 'plain', onclick: () => close(false) }, no),
        h('button', { type: 'button', class: danger ? 'danger' : 'primary', onclick: () => close(true) }, yes)),
    );
    askDialog.onclose = () => resolve(false);
    askDialog.showModal();
  });
}

const timeRange = (lesson) => `${lesson.start}–${lesson.end}`;
const lessonTitle = (lesson) => t('{0}-й урок', [lesson.n]);

/* Отметки */

const LETTERS = () => ({ absent: t('н'), sick: t('б'), excused: t('у'), released: t('осв'), late: t('оп') });

const STATUS_TEXT = {
  present: () => t('Пришёл'),
  late: () => t('Опоздал'),
  sick: () => t('Болеет'),
  excused: () => t('Уважительная'),
  released: () => t('Освобождён'),
  absent: () => t('Нет'),
};

function resultText(result) {
  switch (result.code) {
    case 'present':
      return result.arrived && result.delay > 0
        ? t('пришёл в {0}, не считается опозданием', [result.arrived])
        : t('на месте');
    case 'late':
      return t('пришёл в {0}, опоздание {1} мин', [result.arrived, result.delay]);
    case 'absent':
      return result.lateAbsent ? t('пришёл в {0}, через {1} мин: пропуск', [result.arrived, result.delay]) : t('без причины');
    case 'sick':
      return result.confirmed ? t('болезнь, справка есть') : t('болезнь, ждём справку');
    case 'excused':
      return t('по уважительной причине');
    case 'released':
      return t('освобождён');
    default:
      return t('не отмечен');
  }
}

function record(key) {
  data.attendance[key] ??= { marks: {} };
  data.attendance[key].marks ??= {};
  return data.attendance[key];
}

function setMark(lesson, studentId, status, extra = {}) {
  change(() => {
    const rec = record(lesson.key);
    rec.subject = lesson.subject;
    if (status) rec.marks[studentId] = { status, ...extra };
    else delete rec.marks[studentId];
  });
}

/** Время прихода опоздавшего: сейчас, если урок идёт, иначе первая минута опоздания. */
function lateTime(lesson) {
  const { iso, time } = now();
  const start = toMinutes(actualStart(lesson, data.attendance[lesson.key]));
  if (iso === lesson.date && toMinutes(time) >= start && toMinutes(time) < toMinutes(lesson.end)) return time;
  return fromMinutes(start + LATE_FROM_MINUTE);
}

function confirmCertificate(studentId) {
  change(() => {
    for (const rec of Object.values(data.attendance)) {
      const mark = rec?.marks?.[studentId];
      if (mark?.status === 'sick') mark.confirmed = true;
    }
  });
  toast(t('Справка принята'));
}

function openRoll(key) {
  openKey = key;
  drawRoll();
  if (!rollDialog.open) rollDialog.showModal();
}

rollDialog.addEventListener('close', () => {
  openKey = null;
  render();
});

function drawRoll() {
  if (!openKey) return;
  const lesson = lessonByKey(data, openKey);
  const rec = data.attendance[lesson.key];
  const { iso, time } = now();
  const rows = rollCall(data, lesson, iso, time);
  const state = lessonState(lesson, iso, time);
  const summary = lessonSummary(data, lesson, iso, time);
  const scrollTop = rollDialog.querySelector('.rollgrid')?.scrollTop ?? 0;

  const startBox = () => {
    if (rec?.start) {
      const delay = startDelay(lesson, rec);
      return h('div', { class: 'startline' },
        h('span', {}, delay > 0 ? t('Урок начался в {0}, на {1} мин позже звонка', [actualStart(lesson, rec), delay]) : t('Урок начался по звонку')),
        h('label', { class: 'inline' }, t('Время начала'),
          h('input', { type: 'time', value: rec.start, onchange: (e) => isTime(e.target.value) && change(() => { record(lesson.key).start = e.target.value; }) })),
      );
    }
    const canStart = iso === lesson.date && toMinutes(time) >= toMinutes(lesson.start) - 15 && toMinutes(time) < toMinutes(lesson.end);
    return h('div', { class: 'startline' },
      h('span', { class: 'muted' }, t('Опоздание считается от звонка, пока урок не начат кнопкой.')),
      canStart && h('button', { type: 'button', id: 'start-lesson', class: 'primary', onclick: () => change(() => { record(lesson.key).start = time; record(lesson.key).subject = lesson.subject; }) }, t('Начать урок')),
    );
  };

  const button = (row, status, label, cls = '') => {
    const active = row.mark?.status === status && (status !== 'present' || (row.mark?.arrived ? 'late' : 'present') === cls);
    return h('button', {
      type: 'button',
      class: `markbtn ${cls || status}`,
      'aria-pressed': active ? 'true' : 'false',
      onclick: () => {
        if (active) setMark(lesson, row.student.id, null);
        else if (cls === 'late') setMark(lesson, row.student.id, 'present', { arrived: lateTime(lesson) });
        else setMark(lesson, row.student.id, status);
      },
    }, label);
  };

  const card = (row) => {
    const mark = rec?.marks?.[row.student.id];
    const item = { ...row, mark };
    return h('li', { class: `rollcard code-${row.code}`, 'data-student': row.student.name },
      h('div', { class: 'rollhead' },
        h('span', { class: 'rollname' }, row.student.name),
        h('span', { class: 'stamp' }, row.code === 'none' ? '' : (row.code === 'present' ? '✓' : LETTERS()[row.code] ?? '')),
      ),
      h('div', { class: 'rolltext' }, resultText(row)),
      h('div', { class: 'markrow' },
        button(item, 'present', STATUS_TEXT.present(), 'present'),
        button(item, 'present', STATUS_TEXT.late(), 'late'),
        button(item, 'sick', STATUS_TEXT.sick()),
        button(item, 'excused', STATUS_TEXT.excused()),
        button(item, 'released', STATUS_TEXT.released()),
        button(item, 'absent', STATUS_TEXT.absent()),
      ),
      mark?.status === 'present' && mark.arrived && h('label', { class: 'inline latebox' }, t('Пришёл в'),
        h('input', { type: 'time', class: 'latetime', value: mark.arrived, onchange: (e) => isTime(e.target.value) && setMark(lesson, row.student.id, 'present', { arrived: e.target.value }) })),
      mark?.status === 'sick' && !mark.confirmed && h('button', { type: 'button', class: 'plain small', onclick: () => confirmCertificate(row.student.id) }, t('Справка принята')),
    );
  };

  const unmarked = rows.filter((row) => !rec?.marks?.[row.student.id]);
  rollDialog.replaceChildren(...[
    h('header', { class: 'rolltop' },
      h('div', {},
        h('h2', { class: 'hand' }, `${lessonTitle(lesson)}. ${lesson.subject}`),
        h('p', { class: 'muted' }, `${longDate(lesson.date)}, ${timeRange(lesson)}`),
      ),
      h('button', { type: 'button', class: 'plain close', 'aria-label': t('Закрыть'), onclick: () => rollDialog.close() }, '×'),
    ),
    state === 'future' && lesson.date > iso ? h('p', { class: 'note' }, t('Урок ещё не начался: отметки можно ставить заранее, например болезнь.')) : null,
    startBox(),
    h('div', { class: 'rolltools' },
      unmarked.length > 0 && h('button', {
        type: 'button',
        id: 'all-here',
        class: 'primary',
        onclick: () => change(() => {
          const r = record(lesson.key);
          r.subject = lesson.subject;
          for (const row of unmarked) r.marks[row.student.id] = { status: 'present' };
        }),
      }, unmarked.length === rows.length ? t('Все пришли') : t('Остальные пришли ({0})', [unmarked.length])),
      h('span', { class: 'rollsummary' },
        t('На уроке: {0} из {1}', [summary.here, summary.total]),
        summary.late ? `, ${t('опоздали: {0}', [summary.late])}` : '',
        summary.missing ? `, ${t('нет: {0}', [summary.missing])}` : ''),
    ),
    rows.length
      ? h('ul', { class: 'rollgrid' }, rows.map(card))
      : h('p', { class: 'empty' }, t('В классе пока нет учеников. Добавьте их в разделе «Класс».')),
    h('p', { class: 'rule muted' }, t('С {0}-й минуты после начала урока — опоздание, с {1}-й — пропуск.', [LATE_FROM_MINUTE, ABSENT_FROM_MINUTE])),
  ].filter(Boolean));
  const grid = rollDialog.querySelector('.rollgrid');
  if (grid) grid.scrollTop = scrollTop;
}

/* Сегодня */

function petCard() {
  const { iso, time } = now();
  const pet = petStatus(data, iso, time);
  const MOODS = { play: t('Играет: класс молодец'), fine: t('Всё хорошо'), sad: t('Грустит: много пропусков'), sick: t('Болеет: срочно на уроки!'), dead: t('Питомец умер') };
  return h('section', { class: 'card petcard', id: 'pet' },
    h('div', { class: 'petbox' }, petSprite(pet.mood)),
    h('div', {},
      h('h3', { class: 'hand' }, data.pet.name || t('Питомец класса')),
      h('p', { class: 'petmood' }, MOODS[pet.mood]),
      pet.mood !== 'dead' && h('div', { class: 'health', role: 'meter', 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': pet.health, 'aria-label': t('Здоровье питомца') },
        h('span', { style: { width: `${pet.health}%` } })),
      pet.mood === 'dead'
        ? h('div', {},
          h('p', { class: 'muted' }, t('Умер {0}. Заведите нового: он начнёт с чистого листа.', [shortDate(pet.diedOn)])),
          h('button', { type: 'button', class: 'primary', onclick: () => change(() => { data.pet = { ...data.pet, since: iso }; }) }, t('Завести нового')))
        : h('p', { class: 'muted small' }, t('Здоровье {0} из 100. Его лечит посещаемость, вредят пропуски без причины и опоздания.', [pet.health])),
    ),
  );
}

function certificatesCard() {
  const list = pendingCertificates(data);
  if (!list.length) return null;
  return h('section', { class: 'card', id: 'certificates' },
    h('h3', { class: 'hand' }, t('Ждём справку')),
    h('ul', { class: 'plainlist' }, list.map((item) => h('li', {},
      h('div', {},
        h('strong', {}, item.student.name),
        h('div', { class: 'muted small' }, item.from === item.to ? shortDate(item.from) : t('с {0} по {1}', [shortDate(item.from), shortDate(item.to)]), ', ', tp('lessons', item.lessons))),
      h('button', { type: 'button', class: 'plain small', onclick: () => confirmCertificate(item.student.id) }, t('Справка принята')),
    ))),
  );
}

function firstSteps() {
  const steps = [
    [t('Впишите класс и учеников'), data.students.length > 0, 'class'],
    [t('Заполните звонки и уроки недели'), WEEKDAYS.some((d) => data.week[d].some(Boolean)), 'week'],
    [t('Отмечайте учеников на уроке'), Object.keys(data.attendance).length > 0, 'today'],
  ];
  if (steps.slice(0, 2).every(([, done]) => done)) return null;
  return h('section', { class: 'card welcome' },
    h('h2', { class: 'hand' }, t('С чего начать')),
    h('ol', { class: 'steps' }, steps.map(([text, done, target]) => h('li', { class: done ? 'done' : '' },
      target !== 'today' && !done ? h('button', { type: 'button', class: 'link', onclick: () => go(target) }, text) : text))),
  );
}

function dayEditor(iso) {
  const planned = data.week[weekday(iso)] ?? [];
  const changes = { ...(data.changes[iso] ?? {}) };
  askDialog.replaceChildren(
    h('h3', {}, t('Изменения на {0}', [shortDate(iso)])),
    h('p', { class: 'muted small' }, t('Замена, перенос или отмена урока только в этот день. Пустое поле — урока нет.')),
    h('div', { class: 'changegrid' }, data.bells.map((bell, i) => {
      const n = i + 1;
      return h('label', {},
        h('span', {}, `${n}. ${bell.start}`),
        h('input', { type: 'text', 'data-n': n, list: 'subjects', value: Object.hasOwn(changes, n) ? changes[n] : planned[i] ?? '' }));
    })),
    subjectList(),
    h('div', { class: 'actions' },
      data.changes[iso] && h('button', { type: 'button', class: 'plain', onclick: () => { change(() => { delete data.changes[iso]; }); askDialog.close(); } }, t('Как по расписанию')),
      h('button', { type: 'button', class: 'plain', onclick: () => askDialog.close() }, t('Отмена')),
      h('button', {
        type: 'button',
        class: 'primary',
        onclick: () => {
          const next = {};
          for (const input of askDialog.querySelectorAll('input[data-n]')) {
            const n = Number(input.dataset.n);
            const value = input.value.trim();
            if (value !== (planned[n - 1] ?? '').trim()) next[n] = value;
          }
          change(() => {
            if (Object.keys(next).length) data.changes[iso] = next;
            else delete data.changes[iso];
          });
          askDialog.close();
        },
      }, t('Сохранить')),
    ),
  );
  askDialog.onclose = null;
  askDialog.showModal();
}

function subjectList() {
  const subjects = new Set();
  for (const d of WEEKDAYS) for (const s of data.week[d]) if (s.trim()) subjects.add(s.trim());
  return h('datalist', { id: 'subjects' }, [...subjects].sort().map((s) => h('option', { value: s })));
}

function lessonRow(lesson) {
  const { iso, time } = now();
  const state = lessonState(lesson, iso, time);
  const s = lessonSummary(data, lesson, iso, time);
  let status;
  if (s.recorded) {
    status = [
      h('span', { class: 'chip ok' }, t('{0} из {1}', [s.here, s.total])),
      s.late ? h('span', { class: 'chip late' }, t('опоздали: {0}', [s.late])) : null,
      s.missing ? h('span', { class: 'chip miss' }, t('нет: {0}', [s.missing])) : null,
    ];
  } else if (state === 'past') status = h('span', { class: 'chip warn' }, t('не отмечен'));
  else if (state === 'now') status = h('span', { class: 'chip now' }, t('идёт сейчас'));
  else status = h('span', { class: 'muted' }, t('впереди'));
  return h('li', { class: `lesson state-${state}` },
    h('button', { type: 'button', class: 'lessonbtn', 'data-key': lesson.key, onclick: () => openRoll(lesson.key) },
      h('span', { class: 'num' }, String(lesson.n)),
      h('span', { class: 'time' }, timeRange(lesson)),
      h('span', { class: 'subject' }, h('span', { class: 'subjecttext' }, lesson.subject), lesson.changed ? h('span', { class: 'changed', title: t('Изменено на этот день') }, '*') : null),
      h('span', { class: 'status' }, status),
    ),
  );
}

function renderToday() {
  const { iso } = now();
  const lessons = lessonsOn(data, day);
  const holiday = holidayOn(data, day);
  let body;
  if (lessons.length) body = h('ol', { class: 'lessons' }, lessons.map(lessonRow));
  else if (holiday) body = h('p', { class: 'empty hand' }, t('Каникулы: {0}', [holiday.title || t('без названия')]));
  else if (day < data.year.start || day > data.year.end) body = h('p', { class: 'empty' }, t('Этот день вне учебного года. Даты года меняются в «Расписании».'));
  else if (weekday(day) > data.days) body = h('p', { class: 'empty hand' }, t('Выходной'));
  else body = h('p', { class: 'empty' }, t('На этот день уроков нет.'));

  return h('div', { class: 'todaygrid' },
    h('section', { class: 'sheetpage' },
      h('div', { class: 'daynav' },
        h('button', { type: 'button', class: 'plain', 'aria-label': t('Предыдущий день'), onclick: () => { day = addDays(day, -1); render(); } }, '‹'),
        h('h1', { class: 'hand', id: 'day-title' }, longDate(day)),
        h('button', { type: 'button', class: 'plain', 'aria-label': t('Следующий день'), onclick: () => { day = addDays(day, 1); render(); } }, '›'),
        day !== iso && h('button', { type: 'button', class: 'plain small', onclick: () => { day = iso; render(); } }, t('К сегодняшнему дню')),
        h('input', { type: 'date', class: 'datepick', value: day, 'aria-label': t('Выбрать дату'), onchange: (e) => { if (isDate(e.target.value)) { day = e.target.value; render(); } } }),
      ),
      body,
      isSchoolDay(data, day) && h('button', { type: 'button', class: 'plain small', id: 'edit-day', onclick: () => dayEditor(day) }, t('Изменения на этот день')),
    ),
    h('aside', { class: 'side' }, firstSteps(), petCard(), certificatesCard()),
  );
}

/* Расписание */

function renderWeek() {
  const days = WEEKDAYS.slice(0, data.days);
  const bellsTable = h('table', { class: 'grid bells' },
    h('thead', {}, h('tr', {}, h('th', {}, t('Урок')), h('th', {}, t('Начало')), h('th', {}, t('Конец')), h('th', {}, ''))),
    h('tbody', {}, data.bells.map((bell, i) => h('tr', {},
      h('td', { class: 'num' }, String(i + 1)),
      h('td', {}, h('input', { type: 'time', value: bell.start, 'aria-label': t('Начало {0}-го урока', [i + 1]), onchange: (e) => isTime(e.target.value) && change(() => { data.bells[i].start = e.target.value; }) })),
      h('td', {}, h('input', { type: 'time', value: bell.end, 'aria-label': t('Конец {0}-го урока', [i + 1]), onchange: (e) => isTime(e.target.value) && change(() => { data.bells[i].end = e.target.value; }) })),
      h('td', {}, i === data.bells.length - 1 && data.bells.length > 1 && h('button', { type: 'button', class: 'plain small', 'aria-label': t('Убрать последний урок'), onclick: () => change(() => { data.bells.pop(); }) }, '×')),
    ))),
  );
  const addBell = () => change(() => {
    const last = data.bells.at(-1);
    const start = last ? toMinutes(last.end) + 10 : 8 * 60 + 30;
    data.bells.push({ start: fromMinutes(start), end: fromMinutes(start + 45) });
  });

  const evenly = h('form', {
    class: 'evenly',
    onsubmit: (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const first = String(f.get('first'));
      const count = Number(f.get('count'));
      const length = Number(f.get('length'));
      const breaks = String(f.get('breaks')).split(/[\s,;]+/).map(Number).filter((n) => n >= 0);
      if (!isTime(first) || !(count >= 1 && count <= 12) || !(length >= 20 && length <= 90)) return;
      change(() => { data.bells = makeBells(first, count, length, breaks.length ? breaks : [10]); });
      toast(t('Звонки заполнены'));
    },
  },
  h('label', {}, t('Первый урок'), h('input', { type: 'time', name: 'first', value: data.bells[0]?.start ?? '08:30' })),
  h('label', {}, t('Уроков'), h('input', { type: 'number', name: 'count', min: 1, max: 12, value: data.bells.length })),
  h('label', {}, t('Длина урока, мин'), h('input', { type: 'number', name: 'length', min: 20, max: 90, value: 45 })),
  h('label', {}, t('Перемены, мин'), h('input', { type: 'text', name: 'breaks', value: '10, 15, 15, 10', 'aria-describedby': 'breaks-hint' })),
  h('button', { type: 'submit', class: 'plain' }, t('Заполнить')),
  h('p', { class: 'muted small', id: 'breaks-hint' }, t('Перемены по порядку через запятую. Последняя повторяется дальше.')));

  const weekTable = h('table', { class: 'grid weektable' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), days.map((d) => h('th', {}, weekdayName(d))))),
    h('tbody', {}, data.bells.map((bell, i) => h('tr', {},
      h('th', { class: 'num' }, h('span', {}, String(i + 1)), h('small', { class: 'muted' }, bell.start)),
      days.map((d) => h('td', {}, h('input', {
        type: 'text',
        list: 'subjects',
        'aria-label': t('{0}, {1}-й урок', [weekdayName(d), i + 1]),
        value: data.week[d][i] ?? '',
        onchange: (e) => change(() => {
          const row = data.week[d];
          while (row.length <= i) row.push('');
          row[i] = e.target.value.trim();
        }),
      }))),
    ))),
  );

  const holidays = h('ul', { class: 'plainlist holidays' }, data.holidays.map((item, i) => h('li', {},
    h('input', { type: 'date', value: item.from, 'aria-label': t('С'), onchange: (e) => isDate(e.target.value) && change(() => { data.holidays[i].from = e.target.value; }) }),
    h('span', {}, '–'),
    h('input', { type: 'date', value: item.to, 'aria-label': t('По'), onchange: (e) => isDate(e.target.value) && change(() => { data.holidays[i].to = e.target.value; }) }),
    h('input', { type: 'text', value: item.title, placeholder: t('Например, осенние каникулы'), 'aria-label': t('Название'), onchange: (e) => change(() => { data.holidays[i].title = e.target.value.trim(); }) }),
    h('button', { type: 'button', class: 'plain small', 'aria-label': t('Удалить'), onclick: () => change(() => { data.holidays.splice(i, 1); }) }, '×'),
  )));

  return h('div', { class: 'stack' },
    h('section', { class: 'card' },
      h('h2', { class: 'hand' }, t('Уроки по дням недели')),
      h('p', { class: 'muted' }, t('Впишите предметы один раз: уроки появятся на каждый учебный день до конца года. Замену в отдельный день делайте на странице «Сегодня».')),
      h('div', { class: 'daysswitch' },
        h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'days', checked: data.days === 5, onchange: () => change(() => { data.days = 5; }) }), t('Пятидневка')),
        h('label', { class: 'inline' }, h('input', { type: 'radio', name: 'days', checked: data.days === 6, onchange: () => change(() => { data.days = 6; }) }), t('Шестидневка'))),
      h('div', { class: 'scrollx' }, weekTable),
      subjectList(),
    ),
    h('div', { class: 'twocol' },
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Звонки')),
        bellsTable,
        h('button', { type: 'button', class: 'plain', onclick: addBell }, t('Добавить урок')),
        h('details', {}, h('summary', {}, t('Заполнить ровно')), evenly),
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Учебный год')),
        h('div', { class: 'formrow' },
          h('label', {}, t('Начало'), h('input', { type: 'date', value: data.year.start, onchange: (e) => isDate(e.target.value) && change(() => { data.year.start = e.target.value; }) })),
          h('label', {}, t('Конец'), h('input', { type: 'date', value: data.year.end, onchange: (e) => isDate(e.target.value) && change(() => { data.year.end = e.target.value; }) }))),
        h('h3', {}, t('Каникулы и праздники')),
        data.holidays.length ? holidays : h('p', { class: 'muted' }, t('В эти дни уроков не будет.')),
        h('button', { type: 'button', class: 'plain', onclick: () => change(() => { data.holidays.push({ from: now().iso, to: now().iso, title: '' }); }) }, t('Добавить каникулы')),
      ),
    ),
  );
}

/* Класс */

function hasMarks(studentId) {
  return Object.values(data.attendance).some((rec) => rec?.marks?.[studentId]);
}

async function removeStudent(student) {
  if (hasMarks(student.id)) {
    const yes = await ask(t('У ученика {0} есть отметки. Удалить вместе с ними? Если он перешёл в другую школу, лучше укажите дату выбытия.', [student.name]), t('Удалить'), { danger: true });
    if (!yes) return;
  }
  change(() => {
    data.students = data.students.filter((s) => s.id !== student.id);
    for (const rec of Object.values(data.attendance)) delete rec?.marks?.[student.id];
  });
}

function renderClass() {
  const active = data.students.filter((s) => !s.left).length;
  const list = [...data.students].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  const addForm = h('form', {
    class: 'addstudents',
    onsubmit: (e) => {
      e.preventDefault();
      const area = e.target.querySelector('textarea');
      const known = new Set(data.students.map((s) => s.name.toLocaleLowerCase('ru')));
      const names = parseNames(area.value).filter((name) => !known.has(name.toLocaleLowerCase('ru')));
      if (!names.length) return;
      // Пришедший в середине года не должен попасть в пропуски прошлых уроков.
      const joined = Object.keys(data.attendance).length ? now().iso : null;
      change(() => { data.students.push(...names.map((name) => ({ id: uid(), name, ...(joined && { joined }) }))); });
      toast(t('Добавлено: {0}', [tp('students', names.length)]));
    },
  },
  h('label', { for: 'new-students' }, t('Новые ученики, по одному в строке')),
  h('textarea', { id: 'new-students', rows: 6, placeholder: t('Можно вставить столбец из Excel или Word') }),
  h('button', { type: 'submit', class: 'primary' }, t('Добавить')));

  return h('div', { class: 'twocol wide' },
    h('section', { class: 'card' },
      h('h2', { class: 'hand' }, t('Список класса')),
      h('p', { class: 'muted' }, tp('students', active)),
      list.length
        ? h('ol', { class: 'students' }, list.map((student) => h('li', { class: student.left ? 'left' : '' },
          h('input', { type: 'text', value: student.name, 'aria-label': t('ФИО'), onchange: (e) => e.target.value.trim() && change(() => { data.students.find((s) => s.id === student.id).name = e.target.value.trim().replace(/\s+/g, ' '); }) }),
          h('label', { class: 'inline small' }, t('Выбыл'),
            h('input', { type: 'date', value: student.left ?? '', onchange: (e) => change(() => { const s = data.students.find((x) => x.id === student.id); if (isDate(e.target.value)) s.left = e.target.value; else delete s.left; }) })),
          h('button', { type: 'button', class: 'plain small', 'aria-label': t('Удалить {0}', [student.name]), onclick: () => removeStudent(student) }, '×'),
        )))
        : h('p', { class: 'empty' }, t('Учеников пока нет. Добавьте список справа.')),
    ),
    h('div', { class: 'stack' },
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Класс')),
        h('label', {}, t('Название класса'), h('input', { type: 'text', id: 'class-name', value: data.class.name, placeholder: t('Например, 5 «А»'), onchange: (e) => change(() => { data.class.name = e.target.value.trim(); }) })),
        h('label', {}, t('Классный руководитель'), h('input', { type: 'text', value: data.class.teacher, onchange: (e) => change(() => { data.class.teacher = e.target.value.trim(); }) })),
        h('label', {}, t('Школа'), h('input', { type: 'text', value: data.class.school, onchange: (e) => change(() => { data.class.school = e.target.value.trim(); }) })),
      ),
      h('section', { class: 'card' }, addForm),
    ),
  );
}

/* Отчёт */

function reportSheets(report) {
  const letters = LETTERS();
  const head = [t('№'), t('Ученик'), t('Уроков'), t('Был'), t('Опозданий'), t('Минут опозданий'), t('Пропущено'), t('По болезни'), t('Без справки'), t('Уважительная'), t('Освобождён'), t('Без причины'), t('Посещаемость')];
  const rowOf = (row, i) => [i + 1, row.student.name, row.lessons, row.attended, row.late, row.lateMinutes, row.missed, row.sick, row.sickPending, row.excused, row.released, row.absent, percent(row.rate)];
  const totals = report.totals;
  const summary = [
    ...report.rows.map(rowOf),
    ['', t('Итого по классу'), totals.lessons, totals.attended, totals.late, totals.lateMinutes, totals.missed, totals.sick, totals.sickPending, totals.excused, totals.released, totals.absent, percent(totals.rate)],
  ];
  const dayHead = [t('№'), t('Ученик'), ...report.days.map((iso) => Number(iso.slice(8))), t('Пропущено')];
  const dayRows = report.rows.map((row, i) => [i + 1, row.student.name, ...report.days.map((iso) => dayCell(row.byDay[iso], letters)), row.missed]);
  return { head, summary, dayHead, dayRows };
}

const reportTitle = () => [data.class.name, monthTitle(reportMonth)].filter(Boolean).join(', ');

function renderReport() {
  const { iso, time } = now();
  const report = monthReport(data, reportMonth, iso, time);
  const { head, summary, dayHead, dayRows } = reportSheets(report);
  const letters = LETTERS();
  const shift = (n) => {
    const [y, m] = reportMonth.split('-').map(Number);
    const date = new Date(y, m - 1 + n, 1);
    reportMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    render();
  };
  const table = (header, rows, cls) => h('table', { class: `grid report ${cls}` },
    h('thead', {}, h('tr', {}, header.map((cell) => h('th', {}, String(cell))))),
    h('tbody', {}, rows.map((cells, r) => h('tr', { class: r === rows.length - 1 && cls === 'summary' ? 'total' : '' }, cells.map((cell, c) => h(c === 1 ? 'th' : 'td', { class: typeof cell === 'number' || c > 1 ? 'n' : '' }, String(cell ?? '')))))));
  const meta = [data.class.school, data.class.teacher && t('Классный руководитель: {0}', [data.class.teacher])].filter(Boolean).join('. ');

  const exportXlsx = async () => {
    const legend = [[t('Обозначения')], ...Object.entries({ absent: t('без причины'), sick: t('по болезни'), excused: t('по уважительной причине'), released: t('освобождён'), late: t('опоздание') }).map(([code, text]) => [letters[code], text])];
    const result = await api.saveXlsx(t('Сохранить отчёт'), `${reportTitle()}.xlsx`, [
      { name: t('Итоги'), rows: [[reportTitle()], [meta], [], head, ...summary], widths: [5, 32, 9, 9, 11, 11, 11, 11, 11, 13, 12, 12, 13], boldRows: [0, 3, summary.length + 3] },
      { name: t('По дням'), rows: [[reportTitle()], [], dayHead, ...dayRows, [], ...legend], widths: [5, 32, ...report.days.map(() => 5), 11], boldRows: [0, 2] },
    ]);
    if (result.ok && result.value) toast(t('Отчёт сохранён'));
    else if (!result.ok) toast(t('Не удалось сохранить: {0}', [result.message]));
  };

  return h('div', { class: 'stack reportpage' },
    h('div', { class: 'reportbar noprint' },
      h('button', { type: 'button', class: 'plain', 'aria-label': t('Предыдущий месяц'), onclick: () => shift(-1) }, '‹'),
      h('h1', { class: 'hand', id: 'report-month' }, monthTitle(reportMonth)),
      h('button', { type: 'button', class: 'plain', 'aria-label': t('Следующий месяц'), onclick: () => shift(1) }, '›'),
      h('span', { class: 'grow' }),
      h('button', { type: 'button', class: 'primary', id: 'save-xlsx', onclick: exportXlsx, disabled: !report.rows.length }, t('Сохранить в Excel')),
      h('button', { type: 'button', class: 'plain', disabled: !report.rows.length, onclick: async () => { const r = await api.savePdf(t('Сохранить отчёт'), `${reportTitle()}.pdf`); if (r.ok && r.value) toast(t('Отчёт сохранён')); } }, t('Сохранить PDF')),
      h('button', { type: 'button', class: 'plain', disabled: !report.rows.length, onclick: () => api.print() }, t('Печать')),
    ),
    h('header', { class: 'printhead' }, h('h1', {}, t('Посещаемость: {0}', [reportTitle()])), meta && h('p', {}, meta)),
    report.rows.length
      ? [
        h('section', { class: 'card' },
          h('h2', { class: 'hand' }, t('Итоги месяца')),
          h('p', { class: 'muted' }, t('Уроков с отметками: {0}. Посещаемость класса: {1}.', [report.lessons, percent(report.totals.rate)])),
          h('div', { class: 'scrollx' }, table(head, summary, 'summary'))),
        h('section', { class: 'card' },
          h('h2', { class: 'hand' }, t('По дням')),
          h('p', { class: 'muted' }, t('В клетке — сколько уроков пропущено и почему: {0}.', [
            Object.entries({ absent: t('без причины'), sick: t('по болезни'), excused: t('по уважительной причине'), released: t('освобождён'), late: t('опоздание') })
              .map(([code, text]) => `${letters[code]} — ${text}`).join(', ')])),
          h('div', { class: 'scrollx' }, table(dayHead, dayRows, 'bydays'))),
      ]
      : h('p', { class: 'empty card' }, t('За этот месяц отметок нет.')),
  );
}

/* Настройки */

async function renderSettings() {
  const settings = await api.getSettings();
  const backupName = `${t('Копия')} ${data.class.name || t('класса')} ${now().iso}.json`;
  return h('div', { class: 'twocol' },
    h('div', { class: 'stack' },
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Язык')),
        h('div', { class: 'choices' }, LANGUAGES.map(([code, name]) => h('button', {
          type: 'button',
          class: 'plain',
          lang: code,
          'aria-pressed': language() === code ? 'true' : 'false',
          onclick: () => language() !== code && api.setLanguage(code),
        }, name))),
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Вид')),
        h('div', { class: 'choices' }, [['system', t('Как в Windows')], ['light', t('Тетрадь')], ['dark', t('Доска')]].map(([value, label]) => h('button', {
          type: 'button',
          class: 'plain',
          'aria-pressed': settings.theme === value ? 'true' : 'false',
          onclick: async () => { await api.setSettings({ theme: value }); applyTheme(value); render(); },
        }, label))),
        h('label', { class: 'inline' },
          h('input', { type: 'checkbox', checked: settings.fullscreen, onchange: async (e) => { await api.setSettings({ fullscreen: e.target.checked }); } }),
          t('Открывать на весь экран (F11)')),
      ),
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Питомец')),
        h('label', {}, t('Имя питомца'), h('input', { type: 'text', value: data.pet.name, placeholder: t('Придумайте вместе с классом'), onchange: (e) => change(() => { data.pet.name = e.target.value.trim(); }) })),
        h('button', {
          type: 'button',
          class: 'plain',
          onclick: async () => {
            if (await ask(t('Завести нового питомца? Он начнёт со здоровьем 70, прошлые отметки на него не повлияют.'), t('Завести'))) change(() => { data.pet.since = now().iso; });
          },
        }, t('Завести нового')),
      ),
    ),
    h('div', { class: 'stack' },
      h('section', { class: 'card' },
        h('h2', { class: 'hand' }, t('Резервные копии')),
        h('p', { class: 'muted' }, t('Каждый день программа сама сохраняет копию и хранит последние 30. Чтобы не потерять журнал при поломке компьютера, иногда сохраняйте копию на флешку.')),
        h('div', { class: 'choices' },
          h('button', { type: 'button', class: 'primary', onclick: async () => { const r = await api.exportBackup(t('Сохранить копию'), backupName); if (r.ok && r.value) toast(t('Копия сохранена')); } }, t('Сохранить копию')),
          h('button', {
            type: 'button',
            class: 'plain',
            onclick: async () => {
              if (!await ask(t('Заменить данные копией? Текущие данные сначала сохранятся в папке копий.'), t('Выбрать файл'))) return;
              const r = await api.importBackup(t('Открыть копию'));
              if (r.ok && r.value) {
                data = normalizeData(r.value, now().iso);
                toast(t('Данные восстановлены'));
                render();
              } else if (!r.ok) toast(r.code === 'not-backup' ? t('Это не копия Kerdiis School') : t('Не удалось открыть: {0}', [r.message]));
            },
          }, t('Восстановить из копии')),
          h('button', { type: 'button', class: 'plain', onclick: () => api.openBackups() }, t('Открыть папку копий')),
        ),
      ),
      h('section', { class: 'card about' },
        h('h2', { class: 'hand' }, 'Kerdi:s'),
        h('p', {}, t('Посещаемость и опоздания класса за каждый урок и месяц')),
        h('p', {}, t('Автор: Кэрэчээнэ Семёнова')),
        h('p', { class: 'muted small' }, t('Версия {0}', [settings.version])),
        h('p', { class: 'muted small' }, t('Данные хранятся только на этом компьютере: {0}', [settings.home])),
      ),
    ),
  );
}

/* Каркас */

function go(next) {
  view = next;
  render();
}

for (const button of document.querySelectorAll('[data-view]')) {
  button.addEventListener('click', () => go(button.dataset.view));
}

let renderToken = 0;

async function render() {
  const token = ++renderToken;
  document.getElementById('class-title').textContent = data.class.name || t('Мой класс');
  document.getElementById('class-teacher').textContent = data.class.teacher;
  for (const button of document.querySelectorAll('[data-view]')) button.setAttribute('aria-current', button.dataset.view === view ? 'page' : 'false');
  document.body.dataset.view = view;
  const views = { today: renderToday, week: renderWeek, class: renderClass, report: renderReport, settings: renderSettings };
  const content = await views[view]();
  if (token !== renderToken) return;
  const scroll = page.scrollTop;
  const focused = document.activeElement?.closest?.('#page') ? document.activeElement.getAttribute('aria-label') : null;
  page.replaceChildren(content);
  page.scrollTop = scroll;
  if (focused) page.querySelector(`[aria-label="${CSS.escape(focused)}"]`)?.focus();
  if (openKey) drawRoll();
}

function applyTheme(theme) {
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function showWindowButtons(fullscreen) {
  document.getElementById('window-buttons').hidden = !fullscreen;
}

document.getElementById('quit').addEventListener('click', async () => {
  if (await ask(t('Закрыть программу?'), t('Закрыть'))) api.quit();
});
document.getElementById('minimize').addEventListener('click', () => api.minimize());
api.onFullscreen(showWindowButtons);

translatePage();
data = normalizeData(await api.load(), now().iso);
api.getSettings().then((s) => {
  showWindowButtons(s.fullscreen);
  applyTheme(s.theme);
});
render();

// Раз в минуту: идёт ли урок, закончился ли. Открытое окно отметок не перерисовывается целиком.
let lastToday = now().iso;
setInterval(() => {
  // После полуночи «Сегодня» переходит на новый день, если учитель смотрел текущий.
  if (now().iso !== lastToday) {
    if (day === lastToday) day = now().iso;
    lastToday = now().iso;
  }
  if (!document.querySelector('#page input:focus, #page textarea:focus') && !askDialog.open) render();
}, 60_000);
