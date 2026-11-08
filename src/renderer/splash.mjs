// Визитка при запуске. Окном и временем показа управляет главный процесс.
import { t, translatePage } from './i18n.mjs';
import { petSprite } from './pet.mjs';

translatePage();
document.getElementById('splash-logo').append(petSprite('play'));
document.getElementById('splash-version').textContent = t('Версия {0}', [window.school.version]);
document.body.addEventListener('click', () => window.school.skipSplash(), { once: true });

const { theme } = await window.school.getSettings();
if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
