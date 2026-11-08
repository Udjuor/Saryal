// Переводы. Ключ — русская фраза: код остаётся читаемым, а русскому языку
// словарь не нужен. Значения подставляются в {0}, {1}: перевод может менять порядок слов.
import en from './locales/en.mjs';
import sah from './locales/sah.mjs';

export const LANGUAGES = [
  ['sah', 'Саха тыла'],
  ['ru', 'Русский'],
  ['en', 'English'],
];

const DICTIONARIES = { en, sah };
const LOCALES = { ru: 'ru-RU', en: 'en-GB', sah: 'ru-RU' };

const RU_PLURALS = {
  students: { one: '{n} ученик', few: '{n} ученика', many: '{n} учеников', other: '{n} ученика' },
  lessons: { one: '{n} урок', few: '{n} урока', many: '{n} уроков', other: '{n} урока' },
  minutes: { one: '{n} минута', few: '{n} минуты', many: '{n} минут', other: '{n} минуты' },
};

let current = globalThis.window?.school?.language ?? 'ru';

export const language = () => current;
export const locale = () => LOCALES[current];

/** Нужно тестам: в программе язык меняется перезапуском. */
export function setLanguage(next) {
  current = next;
}

/** Ключ «контекст|фраза» различает одинаковые по-русски фразы. */
export function t(key, values = []) {
  const text = DICTIONARIES[current]?.strings?.[key] ?? key.slice(key.indexOf('|') + 1);
  return text.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)] ?? ''));
}

/** Фраза с числом. В якутском после числа слово не меняется. */
export function tp(key, n) {
  const forms = current === 'ru' ? RU_PLURALS[key] : DICTIONARIES[current].plurals[key];
  const rules = current === 'sah' ? null : new Intl.PluralRules(locale());
  const category = rules ? rules.select(n) : 'other';
  return (forms[category] ?? forms.other).replace('{n}', String(n));
}

const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
const MONTHS_OF = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const WEEKDAY_NAMES = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];

const capital = (text) => text.charAt(0).toLocaleUpperCase(locale()) + text.slice(1);

export const monthName = (m) => capital(t(MONTHS[m - 1]));
export const weekdayName = (day) => capital(t(WEEKDAY_NAMES[day - 1]));

/** «Понедельник, 2 ноября». */
export function longDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  const day = new Date(iso.slice(0, 4), m - 1, d).getDay() || 7;
  return t('дата|{0}, {1} {2}', [weekdayName(day), d, t(MONTHS_OF[m - 1]), t(MONTHS[m - 1])]);
}

/** «2 ноября». */
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return t('дата|{0} {1}', [d, t(MONTHS_OF[m - 1]), t(MONTHS[m - 1])]);
}

/** «Ноябрь 2026». */
export const monthTitle = (ym) => t('месяц|{0} {1}', [monthName(Number(ym.slice(5, 7))), ym.slice(0, 4)]);

/** Переводит постоянные надписи страницы. */
export function translatePage(root = document.body) {
  document.documentElement.lang = current;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.nodeValue.trim();
    if (/[А-Яа-яЁё]/.test(text)) node.nodeValue = node.nodeValue.replace(text, t(text));
  }
  for (const element of root.querySelectorAll('[aria-label],[title]')) {
    for (const attr of ['aria-label', 'title']) {
      if (element.hasAttribute(attr)) element.setAttribute(attr, t(element.getAttribute(attr)));
    }
  }
}
