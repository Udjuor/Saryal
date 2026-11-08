import test from 'node:test';
import assert from 'node:assert/strict';
import * as L from '../src/renderer/logic.mjs';
import { petStatus } from '../src/renderer/pet.mjs';

function classData() {
  const data = L.emptyData('2026-11-02');
  data.class.name = '5 «А»';
  data.students = [
    { id: 'a', name: 'Иванова Айыына' },
    { id: 'b', name: 'Петров Боря' },
    { id: 'c', name: 'Сидоров Вова' },
  ];
  data.week[1] = ['Математика', 'Русский язык', '', 'Физкультура'];
  data.week[2] = ['Якутский язык'];
  return data;
}

test('уроки дня берутся из недели и звонков, пустой урок пропускается', () => {
  const data = classData();
  const lessons = L.lessonsOn(data, '2026-11-02');
  assert.deepEqual(lessons.map((l) => [l.n, l.subject, l.start, l.end]), [
    [1, 'Математика', '08:30', '09:15'],
    [2, 'Русский язык', '09:25', '10:10'],
    [4, 'Физкультура', '11:25', '12:10'],
  ]);
  assert.equal(L.lessonsOn(data, '2026-11-07').length, 0, 'суббота при пятидневке');
  assert.equal(L.lessonsOn(data, '2027-06-07').length, 0, 'после учебного года');
});

test('каникулы и изменения на дату', () => {
  const data = classData();
  data.holidays.push({ from: '2026-11-09', to: '2026-11-15', title: 'Каникулы' });
  assert.equal(L.lessonsOn(data, '2026-11-09').length, 0);
  data.changes['2026-11-02'] = { 1: '', 3: 'Музыка' };
  assert.deepEqual(L.lessonsOn(data, '2026-11-02').map((l) => l.subject), ['Русский язык', 'Музыка', 'Физкультура']);
});

test('опоздание с 5-й минуты, пропуск с 20-й, от фактического начала', () => {
  const data = classData();
  const lesson = L.lessonsOn(data, '2026-11-02')[0];
  const record = { marks: {
    a: { status: 'present', arrived: '08:34' },
    b: { status: 'present', arrived: '08:35' },
    c: { status: 'present', arrived: '08:50' },
  } };
  const codes = () => ['a', 'b', 'c'].map((id) => L.markResult(lesson, record, id, '2026-11-02', '09:20'));
  assert.deepEqual(codes().map((r) => r.code), ['present', 'late', 'absent']);
  assert.equal(codes()[1].delay, 5);
  assert.equal(codes()[2].lateAbsent, true);
  // Учитель задержался на 10 минут: пришедшие до него не опоздали.
  record.start = '08:40';
  assert.deepEqual(codes().map((r) => r.code), ['present', 'present', 'late']);
  assert.equal(L.startDelay(lesson, record), 10);
  record.start = '08:20';
  assert.equal(L.actualStart(lesson, record), '08:30', 'не раньше звонка');
});

test('без отметки: пока урок идёт — не отмечен, после — без причины', () => {
  const data = classData();
  const lesson = L.lessonsOn(data, '2026-11-02')[0];
  data.attendance[lesson.key] = { marks: { a: { status: 'present' } } };
  assert.equal(L.markResult(lesson, data.attendance[lesson.key], 'b', '2026-11-02', '09:00').code, 'none');
  assert.equal(L.markResult(lesson, data.attendance[lesson.key], 'b', '2026-11-02', '09:15').code, 'absent');
  assert.equal(L.markResult(lesson, undefined, 'b', '2026-11-03', '09:15').code, 'none', 'урок без отметок не считается');
});

test('отчёт за месяц: пропуски по причинам, опоздания и ячейки дней', () => {
  const data = classData();
  const [math, rus] = L.lessonsOn(data, '2026-11-02');
  data.attendance[math.key] = { marks: {
    a: { status: 'present' },
    b: { status: 'present', arrived: '08:40' },
    c: { status: 'sick' },
  } };
  data.attendance[rus.key] = { marks: { a: { status: 'released' }, b: { status: 'present' }, c: { status: 'sick', confirmed: true } } };
  const report = L.monthReport(data, '2026-11', '2026-11-30', '20:00');
  assert.equal(report.lessons, 2);
  const [a, b, c] = report.rows;
  assert.equal(a.student.id, 'a');
  assert.deepEqual([a.attended, a.released, a.missed, a.valid], [1, 1, 1, 1]);
  assert.deepEqual([b.attended, b.late, b.lateMinutes, b.rate], [2, 1, 10, 1]);
  assert.deepEqual([c.sick, c.sickPending, c.absent], [2, 1, 0]);
  const letters = { absent: 'н', sick: 'б', excused: 'у', released: 'осв', late: 'оп' };
  assert.equal(L.dayCell(c.byDay['2026-11-02'], letters), '2б');
  assert.equal(L.dayCell(b.byDay['2026-11-02'], letters), 'оп');
  assert.equal(report.totals.missed, 3);
  assert.ok(report.days.includes('2026-11-02') && !report.days.includes('2026-11-07'));
});

test('выбывший ученик не попадает в уроки после даты выбытия', () => {
  const data = classData();
  data.students[2].left = '2026-11-03';
  assert.equal(L.studentsOn(data, '2026-11-02').length, 3);
  assert.equal(L.studentsOn(data, '2026-11-03').length, 2);
});

test('справки: ждём от учеников с неподтверждённой болезнью', () => {
  const data = classData();
  data.attendance['2026-11-02#1'] = { marks: { c: { status: 'sick' } } };
  data.attendance['2026-11-03#1'] = { marks: { c: { status: 'sick' } } };
  data.attendance['2026-11-02#2'] = { marks: { a: { status: 'sick', confirmed: true } } };
  const list = L.pendingCertificates(data);
  assert.deepEqual(list.map((i) => [i.student.id, i.from, i.to, i.lessons]), [['c', '2026-11-02', '2026-11-03', 2]]);
});

test('список учеников из столбца Excel: номера и повторы убираются', () => {
  assert.deepEqual(L.parseNames('1. Иванова Айыына\n2) Петров  Боря\tмальчик\n\nиванова айыына\n'), ['Иванова Айыына', 'Петров Боря']);
});

test('сетка звонков по длине урока и переменам', () => {
  assert.deepEqual(L.makeBells('08:00', 3, 40, [10, 20]).map((b) => `${b.start}-${b.end}`), ['08:00-08:40', '08:50-09:30', '09:50-10:30']);
});

test('питомец: хорошая посещаемость лечит, пропуски вредят', () => {
  const data = classData();
  data.pet.since = '2026-11-01';
  const good = structuredClone(data);
  const bad = structuredClone(data);
  for (const lesson of L.lessonsOn(data, '2026-11-02')) {
    good.attendance[lesson.key] = { marks: { a: { status: 'present' }, b: { status: 'present' }, c: { status: 'present' } } };
    bad.attendance[lesson.key] = { marks: { a: { status: 'present' } } };
  }
  const now = ['2026-11-03', '10:00'];
  assert.ok(petStatus(good, ...now).health > 70);
  assert.ok(petStatus(bad, ...now).health < 70);
  assert.equal(petStatus(data, ...now).health, 70, 'без отметок не меняется');
});

test('нормализация: испорченный файл не роняет программу', () => {
  const data = L.normalizeData({ students: [{ id: 'x' }, { id: 'y', name: 'Аня' }], bells: 'нет', days: 7 }, '2026-11-02');
  assert.equal(data.students.length, 1);
  assert.equal(data.bells.length, 7);
  assert.equal(data.days, 5);
});
