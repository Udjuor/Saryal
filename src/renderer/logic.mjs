// Правила учёта для одного класса. Всё, что можно посчитать, считается из
// расписания и отметок, а не хранится: так отчёт и питомец всегда сходятся.

/** Опоздание с 5-й минуты после фактического начала урока, с 20-й минуты пропуск. */
export const LATE_FROM_MINUTE = 5;
export const ABSENT_FROM_MINUTE = 20;

/** Обычное расписание звонков по 45 минут. Учитель меняет его в «Расписании». */
export const DEFAULT_BELLS = [
  { start: '08:30', end: '09:15' },
  { start: '09:25', end: '10:10' },
  { start: '10:25', end: '11:10' },
  { start: '11:25', end: '12:10' },
  { start: '12:20', end: '13:05' },
  { start: '13:15', end: '14:00' },
  { start: '14:10', end: '14:55' },
];

/** Причины отсутствия в порядке важности для отчёта: худшая показывается первой. */
export const REASONS = ['absent', 'sick', 'excused', 'released'];

export const WEEKDAYS = [1, 2, 3, 4, 5, 6];

export const pad = (n) => String(n).padStart(2, '0');
export const toMinutes = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
};
export const fromMinutes = (minutes) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
export const isTime = (value) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value ?? ''));
export const isDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? ''));

export const toISO = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const fromISO = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
};
export const addDays = (iso, days) => {
  const date = fromISO(iso);
  date.setDate(date.getDate() + days);
  return toISO(date);
};
/** День недели: понедельник 1, воскресенье 7. */
export const weekday = (iso) => fromISO(iso).getDay() || 7;
export const monthDays = (ym) => {
  const [y, m] = ym.split('-').map(Number);
  const count = new Date(y, m, 0).getDate();
  return Array.from({ length: count }, (_, i) => `${ym}-${pad(i + 1)}`);
};
export const nowParts = (date = new Date()) => ({ iso: toISO(date), time: `${pad(date.getHours())}:${pad(date.getMinutes())}` });

/** Пустые данные нового класса. */
export function emptyData(today) {
  const year = Number(today.slice(0, 4)) - (Number(today.slice(5, 7)) < 8 ? 1 : 0);
  return {
    version: 1,
    class: { name: '', teacher: '', school: '' },
    students: [],
    bells: DEFAULT_BELLS.map((bell) => ({ ...bell })),
    days: 5,
    week: Object.fromEntries(WEEKDAYS.map((day) => [day, []])),
    year: { start: `${year}-09-01`, end: `${year + 1}-05-31` },
    holidays: [],
    changes: {},
    attendance: {},
    pet: { since: today, name: '' },
  };
}

/** Приводит загруженные данные к ожидаемому виду: файл могли править руками. */
export function normalizeData(raw, today) {
  const base = emptyData(today);
  const data = { ...base, ...(raw && typeof raw === 'object' ? raw : {}) };
  data.class = { ...base.class, ...(data.class ?? {}) };
  data.students = Array.isArray(data.students) ? data.students.filter((s) => s && s.id && s.name) : [];
  data.bells = Array.isArray(data.bells) && data.bells.length ? data.bells.filter((b) => isTime(b?.start) && isTime(b?.end)) : base.bells;
  data.days = data.days === 6 ? 6 : 5;
  data.week = Object.fromEntries(WEEKDAYS.map((day) => [day, Array.isArray(data.week?.[day]) ? data.week[day].map((s) => String(s ?? '')) : []]));
  data.year = isDate(data.year?.start) && isDate(data.year?.end) ? data.year : base.year;
  data.holidays = Array.isArray(data.holidays) ? data.holidays.filter((h) => isDate(h?.from) && isDate(h?.to)) : [];
  data.changes = data.changes && typeof data.changes === 'object' ? data.changes : {};
  data.attendance = data.attendance && typeof data.attendance === 'object' ? data.attendance : {};
  data.pet = { ...base.pet, ...(data.pet ?? {}) };
  return data;
}

export const byName = (a, b) => a.name.localeCompare(b.name, 'ru');

/** Ученики, которые числятся в классе в этот день. */
export const studentsOn = (data, iso) => data.students
  .filter((s) => (!s.joined || s.joined <= iso) && (!s.left || iso < s.left))
  .sort(byName);

export const holidayOn = (data, iso) => data.holidays.find((h) => h.from <= iso && iso <= h.to) ?? null;

/** Учебный ли день: внутри учебного года, не каникулы, не выходной. */
export function isSchoolDay(data, iso) {
  if (iso < data.year.start || iso > data.year.end) return false;
  if (weekday(iso) > data.days) return false;
  return !holidayOn(data, iso);
}

export const lessonKey = (iso, n) => `${iso}#${n}`;

/**
 * Уроки дня по расписанию недели с изменениями на эту дату.
 * Изменение с пустым предметом отменяет урок.
 */
export function lessonsOn(data, iso) {
  if (!isSchoolDay(data, iso)) return [];
  const planned = data.week[weekday(iso)] ?? [];
  const changes = data.changes[iso] ?? {};
  const lessons = [];
  data.bells.forEach((bell, i) => {
    const n = i + 1;
    const changed = Object.hasOwn(changes, n);
    const subject = (changed ? changes[n] : planned[i] ?? '').trim();
    if (!subject) return;
    lessons.push({ key: lessonKey(iso, n), date: iso, n, subject, start: bell.start, end: bell.end, changed });
  });
  return lessons;
}

/** Урок по ключу, даже если расписание с тех пор поменяли: отметки не теряются. */
export function lessonByKey(data, key) {
  const [iso, n] = key.split('#');
  const found = lessonsOn(data, iso).find((lesson) => lesson.n === Number(n));
  if (found) return found;
  const bell = data.bells[Number(n) - 1] ?? { start: '00:00', end: '00:00' };
  return { key, date: iso, n: Number(n), subject: data.attendance[key]?.subject ?? '', start: bell.start, end: bell.end, changed: true, gone: true };
}

/** Фактическое начало: когда учитель нажал «Начать урок», но не раньше звонка. */
export function actualStart(lesson, record) {
  const pressed = record?.start;
  return isTime(pressed) && toMinutes(pressed) > toMinutes(lesson.start) ? pressed : lesson.start;
}

export const startDelay = (lesson, record) => toMinutes(actualStart(lesson, record)) - toMinutes(lesson.start);

export const isRecorded = (record) => Object.values(record?.marks ?? {}).some((mark) => mark?.status);

export function lessonState(lesson, nowISO, nowTime) {
  if (lesson.date < nowISO) return 'past';
  if (lesson.date > nowISO) return 'future';
  if (nowTime >= lesson.end) return 'past';
  return nowTime >= lesson.start ? 'now' : 'future';
}

/**
 * Итог по ученику на уроке.
 * present: был вовремя; late: опоздал на minutes; absent: без причины;
 * sick / excused / released: причина; none: ещё не отмечен, урок идёт.
 */
export function markResult(lesson, record, studentId, nowISO, nowTime) {
  const mark = record?.marks?.[studentId];
  if (mark?.status === 'present') {
    const delay = isTime(mark.arrived) ? toMinutes(mark.arrived) - toMinutes(actualStart(lesson, record)) : 0;
    if (delay >= ABSENT_FROM_MINUTE) return { code: 'absent', arrived: mark.arrived, delay, lateAbsent: true };
    if (delay >= LATE_FROM_MINUTE) return { code: 'late', arrived: mark.arrived, delay };
    return { code: 'present', arrived: mark.arrived, delay: Math.max(0, delay) };
  }
  if (mark?.status === 'sick') return { code: 'sick', confirmed: mark.confirmed === true };
  if (REASONS.includes(mark?.status)) return { code: mark.status };
  const over = lessonState(lesson, nowISO, nowTime) === 'past';
  return { code: over && isRecorded(record) ? 'absent' : 'none' };
}

/** Список на отметку: ученики дня с итогом. */
export function rollCall(data, lesson, nowISO, nowTime) {
  const record = data.attendance[lesson.key];
  return studentsOn(data, lesson.date).map((student) => ({ student, ...markResult(lesson, record, student.id, nowISO, nowTime) }));
}

export function lessonSummary(data, lesson, nowISO, nowTime) {
  const rows = rollCall(data, lesson, nowISO, nowTime);
  const count = (code) => rows.filter((row) => row.code === code).length;
  return {
    total: rows.length,
    recorded: isRecorded(data.attendance[lesson.key]),
    here: count('present') + count('late'),
    late: count('late'),
    missing: rows.length - count('present') - count('late') - count('none'),
    none: count('none'),
  };
}

/** Все проведённые уроки с отметками в промежутке дат, по порядку. */
export function recordedLessons(data, from, to) {
  return Object.keys(data.attendance)
    .filter((key) => {
      const iso = key.split('#')[0];
      return iso >= from && iso <= to && isRecorded(data.attendance[key]);
    })
    .map((key) => lessonByKey(data, key))
    .sort((a, b) => a.date.localeCompare(b.date) || a.n - b.n);
}

const WORST = ['absent', 'sick', 'excused', 'released'];

/**
 * Отчёт за месяц: по каждому ученику и по дням.
 * Считаются только уроки, на которых вели отметку. Освобождение и уважительная
 * причина — пропуск по уважительной причине.
 */
export function monthReport(data, ym, nowISO, nowTime) {
  const days = monthDays(ym).filter((iso) => isSchoolDay(data, iso) || Object.keys(data.attendance).some((key) => key.startsWith(`${iso}#`)));
  const lessons = recordedLessons(data, `${ym}-01`, `${ym}-31`).filter((lesson) => lesson.date <= nowISO);
  const students = [...new Map(lessons.flatMap((lesson) => studentsOn(data, lesson.date)).map((s) => [s.id, s])).values()].sort(byName);
  const rows = students.map((student) => {
    const row = { student, lessons: 0, attended: 0, late: 0, lateMinutes: 0, sick: 0, sickPending: 0, excused: 0, released: 0, absent: 0, byDay: {} };
    for (const lesson of lessons) {
      if (!studentsOn(data, lesson.date).some((s) => s.id === student.id)) continue;
      const result = markResult(lesson, data.attendance[lesson.key], student.id, nowISO, nowTime);
      if (result.code === 'none') continue;
      row.lessons += 1;
      const day = (row.byDay[lesson.date] ??= { missed: 0, late: 0, codes: new Set() });
      if (result.code === 'present' || result.code === 'late') {
        row.attended += 1;
        if (result.code === 'late') {
          row.late += 1;
          row.lateMinutes += result.delay;
          day.late += 1;
        }
        continue;
      }
      row[result.code] += 1;
      if (result.code === 'sick' && !result.confirmed) row.sickPending += 1;
      day.missed += 1;
      day.codes.add(result.code);
    }
    for (const day of Object.values(row.byDay)) {
      day.code = WORST.find((code) => day.codes.has(code)) ?? null;
      delete day.codes;
    }
    row.missed = row.sick + row.excused + row.released + row.absent;
    row.valid = row.sick + row.excused + row.released;
    row.rate = row.lessons ? row.attended / row.lessons : null;
    return row;
  });
  const sum = (field) => rows.reduce((total, row) => total + row[field], 0);
  const totals = Object.fromEntries(['lessons', 'attended', 'late', 'lateMinutes', 'sick', 'sickPending', 'excused', 'released', 'absent', 'missed', 'valid'].map((f) => [f, sum(f)]));
  totals.rate = totals.lessons ? totals.attended / totals.lessons : null;
  return { ym, days, lessons: lessons.length, rows, totals };
}

/** Ученики, от которых ждут справку: болезнь отмечена, справка не принята. */
export function pendingCertificates(data) {
  const waiting = new Map();
  for (const [key, record] of Object.entries(data.attendance)) {
    const iso = key.split('#')[0];
    for (const [id, mark] of Object.entries(record?.marks ?? {})) {
      if (mark?.status !== 'sick' || mark.confirmed) continue;
      const student = data.students.find((s) => s.id === id);
      if (!student) continue;
      const item = waiting.get(id) ?? { student, from: iso, to: iso, lessons: 0 };
      item.from = iso < item.from ? iso : item.from;
      item.to = iso > item.to ? iso : item.to;
      item.lessons += 1;
      waiting.set(id, item);
    }
  }
  return [...waiting.values()].sort((a, b) => byName(a.student, b.student));
}

/** Разбор списка учеников, вставленного столбцом из Excel или Word. */
export function parseNames(text) {
  const seen = new Set();
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*\d+[.)]?\s+/, '').split('\t')[0].replace(/\s+/g, ' ').trim())
    .filter((name) => {
      const key = name.toLocaleLowerCase('ru').replace(/ё/g, 'е');
      if (!name || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/** Ровная сетка звонков: первый урок, длина урока и перемены. */
export function makeBells(first, count, length, breaks) {
  const bells = [];
  let at = toMinutes(first);
  for (let i = 0; i < count; i += 1) {
    bells.push({ start: fromMinutes(at), end: fromMinutes(at + length) });
    at += length + (breaks[i] ?? breaks.at(-1) ?? 10);
  }
  return bells;
}

/** Ячейка дня в таблице за месяц: число пропущенных уроков и буква причины. */
export function dayCell(day, letters) {
  if (!day) return '';
  if (day.missed) return `${day.missed}${letters[day.code]}`;
  return day.late ? letters.late : '';
}

export const percent = (rate) => (rate == null ? '—' : `${Math.round(rate * 100)}%`);
