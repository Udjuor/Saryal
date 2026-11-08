// Питомец класса. Здоровье не хранится, а пересчитывается по отметкам уроков:
// хорошая посещаемость его лечит, пропуски без причины вредят.
import { isRecorded, lessonByKey, markResult } from './logic.mjs';

const START_HEALTH = 70;

const clamp = (value) => Math.max(0, Math.min(100, value));

/** Посещаемость 75% ничего не меняет, выше лечит, ниже вредит заметно сильнее. */
export function healthChange(rate) {
  return Math.round(rate >= 0.75 ? (rate - 0.75) * 12 : (rate - 0.75) * 16);
}

export function moodOf(health) {
  if (health <= 0) return 'dead';
  if (health < 35) return 'sick';
  if (health < 60) return 'sad';
  if (health < 85) return 'fine';
  return 'play';
}

/**
 * Состояние питомца. Смерть окончательна: нужен новый питомец.
 * Опоздание стоит половину присутствия. Болезнь, уважительная причина и
 * освобождение из счёта исключаются. Урок без отметок пропускается.
 */
export function petStatus(data, nowISO, nowTime) {
  const since = data.pet?.since ?? '';
  const keys = Object.keys(data.attendance)
    .filter((key) => key.split('#')[0] >= since && key.split('#')[0] <= nowISO && isRecorded(data.attendance[key]))
    .sort((a, b) => a.split('#')[0].localeCompare(b.split('#')[0]) || Number(a.split('#')[1]) - Number(b.split('#')[1]));
  let health = START_HEALTH;
  let counted = 0;
  let diedOn = null;
  let last = null;
  for (const key of keys) {
    const lesson = lessonByKey(data, key);
    const record = data.attendance[key];
    const results = data.students
      .filter((s) => (!s.joined || s.joined <= lesson.date) && (!s.left || lesson.date < s.left))
      .map((s) => markResult(lesson, record, s.id, nowISO, nowTime).code)
      .filter((code) => ['present', 'late', 'absent'].includes(code));
    if (!results.length) continue;
    const onTime = results.filter((code) => code === 'present').length;
    const late = results.filter((code) => code === 'late').length;
    health = clamp(health + healthChange((onTime + late / 2) / results.length));
    counted += 1;
    last = { date: lesson.date, subject: lesson.subject };
    if (health === 0) {
      diedOn = lesson.date;
      break;
    }
  }
  return { health, mood: moodOf(health), counted, diedOn, last };
}

/* Спрайты 16×16 */

const BODY = [
  '................',
  '.....oooooo.....',
  '...oobbbbbboo...',
  '..obbbbbbbbbbo..',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  'obbbbbbbbbbbbbbo',
  'obbbbbbbbbbbbbbo',
  'obbbbbbbbbbbbbbo',
  'obbbbbbbbbbbbbbo',
  'obbbbbbbbbbbbbbo',
  '.obbbbbbbbbbbbo.',
  '.obbbbbbbbbbbbo.',
  '..oobbboobbboo..',
  '....ooo..ooo....',
  '................',
];

const GRAVE = [
  '................',
  '.....oooooo.....',
  '....osssssso....',
  '...osssxxssso...',
  '...osssxxssso...',
  '...osxxxxxxso...',
  '...osxxxxxxso...',
  '...osssxxssso...',
  '...osssxxssso...',
  '...osssxxssso...',
  '...osssssssso...',
  '...osssssssso...',
  '..oooooooooooo..',
  '.g.gg.g.gg.gg.g.',
  'gggggggggggggggg',
  '................',
];

const COLORS = {
  o: '#1b1f24',
  e: '#1b1f24',
  w: '#ffffff',
  c: '#ff9bb0',
  m: '#1b1f24',
  r: '#e5534b',
  t: '#54aeff',
  y: '#f2cc60',
  s: '#adb5bd',
  x: '#6e7781',
  g: '#3fb950',
};

const BODY_COLOR = { play: '#7ee787', fine: '#7ee787', sad: '#a5d6ff', sick: '#c9c76b' };

const stamp = (grid, char, points) => {
  for (const [x, y] of points) grid[y][x] = char;
};

const eyesOpen = (grid) => {
  stamp(grid, 'e', [[4, 6], [5, 6], [4, 7], [5, 7], [10, 6], [11, 6], [10, 7], [11, 7]]);
  stamp(grid, 'w', [[4, 6], [10, 6]]);
};

const FACES = {
  play(grid, frame) {
    stamp(grid, 'e', [[4, 7], [5, 6], [6, 7], [9, 7], [10, 6], [11, 7]]);
    stamp(grid, 'r', [[7, 9], [8, 9], [7, 10], [8, 10]]);
    stamp(grid, 'e', [[6, 9], [9, 9]]);
    stamp(grid, 'c', [[2, 8], [3, 8], [12, 8], [13, 8]]);
    stamp(grid, 'y', frame ? [[1, 1], [0, 2], [1, 2], [2, 2], [1, 3]] : [[14, 1], [13, 2], [14, 2], [15, 2], [14, 3]]);
  },
  fine(grid, frame) {
    if (frame) stamp(grid, 'e', [[4, 7], [5, 7], [10, 7], [11, 7]]);
    else eyesOpen(grid);
    stamp(grid, 'm', [[6, 9], [7, 10], [8, 10], [9, 9]]);
    stamp(grid, 'c', [[2, 8], [3, 8], [12, 8], [13, 8]]);
  },
  sad(grid, frame) {
    stamp(grid, 'e', [[4, 7], [5, 7], [4, 8], [5, 8], [10, 7], [11, 7], [10, 8], [11, 8]]);
    stamp(grid, 'w', [[4, 7], [10, 7]]);
    stamp(grid, 'o', [[3, 5], [4, 5], [11, 5], [12, 5]]);
    stamp(grid, 'm', [[6, 11], [7, 10], [8, 10], [9, 11]]);
    stamp(grid, 't', frame ? [[4, 10], [4, 11]] : [[4, 9]]);
  },
  sick(grid, frame) {
    stamp(grid, 'e', [[3, 6], [5, 6], [4, 7], [3, 8], [5, 8], [10, 6], [12, 6], [11, 7], [10, 8], [12, 8]]);
    stamp(grid, 'm', [[6, 10], [7, 9], [8, 10], [9, 9]]);
    stamp(grid, 'w', [[13, 2], [13, 3], [13, 4]]);
    stamp(grid, 'r', [[13, 5], [13, 6]]);
    stamp(grid, 't', frame ? [[2, 4]] : [[2, 3], [2, 4]]);
  },
};

function grid(mood, frame) {
  if (mood === 'dead') return GRAVE.map((row) => [...row]);
  const cells = BODY.map((row) => [...row]);
  FACES[mood](cells, frame);
  return cells;
}

/** Пиксели спрайта: [{ x, y, fill }]. Кадр 0 или 1. */
export function petPixels(mood, frame = 0) {
  const pixels = [];
  grid(mood, frame).forEach((row, y) => row.forEach((char, x) => {
    if (char === '.') return;
    pixels.push({ x, y, fill: char === 'b' ? BODY_COLOR[mood] : COLORS[char] });
  }));
  return pixels;
}

/** Рисует существо: два кадра сменяют друг друга средствами CSS. */
export function petSprite(mood) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.classList.add('petsprite', `mood-${mood}`);
  for (const frame of [0, 1]) {
    const layer = document.createElementNS(ns, 'g');
    layer.classList.add(`frame${frame}`);
    for (const { x, y, fill } of petPixels(mood, frame)) {
      const pixel = document.createElementNS(ns, 'rect');
      pixel.setAttribute('x', x);
      pixel.setAttribute('y', y);
      pixel.setAttribute('width', 1);
      pixel.setAttribute('height', 1);
      pixel.setAttribute('fill', fill);
      layer.append(pixel);
    }
    svg.append(layer);
  }
  return svg;
}
