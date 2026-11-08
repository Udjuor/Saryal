'use strict';
// Данные класса в одном файле data.json. Запись через временный файл: если
// компьютер выключат посреди записи, останется прежняя целая версия.
const fs = require('node:fs/promises');
const { existsSync, readFileSync } = require('node:fs');
const path = require('node:path');

const BACKUP_PREFIX = 'Kerdiis-School-';
const BACKUPS_KEPT = 30;

class Store {
  constructor(home, normalize, today) {
    this.home = home;
    this.file = path.join(home, 'data.json');
    this.backupDir = path.join(home, 'backups');
    this.normalize = normalize;
    this.today = today;
    this.queue = Promise.resolve();
  }

  /** Читает данные. Испорченный файл откладывается в сторону, а не теряется. */
  load() {
    if (!existsSync(this.file)) return this.normalize(null, this.today());
    try {
      return this.normalize(JSON.parse(readFileSync(this.file, 'utf8')), this.today());
    } catch (err) {
      const aside = `${this.file}.broken-${Date.now()}`;
      require('node:fs').renameSync(this.file, aside);
      console.error('data.json не прочитан, отложен в', aside, err.message);
      return this.normalize(null, this.today());
    }
  }

  /** Записи идут по очереди, чтобы быстрые отметки не перепутали порядок. */
  save(data) {
    const text = `${JSON.stringify(this.normalize(data, this.today()), null, 1)}\n`;
    this.queue = this.queue.then(async () => {
      await fs.mkdir(this.home, { recursive: true });
      const tmp = `${this.file}.tmp`;
      await fs.writeFile(tmp, text, 'utf8');
      await fs.rename(tmp, this.file);
    });
    return this.queue;
  }

  /** Копия за день: одна на дату, хранятся последние 30. */
  async dailyBackup() {
    if (!existsSync(this.file)) return null;
    await fs.mkdir(this.backupDir, { recursive: true });
    const target = path.join(this.backupDir, `${BACKUP_PREFIX}${this.today()}.json`);
    if (!existsSync(target)) await fs.copyFile(this.file, target);
    const old = (await fs.readdir(this.backupDir)).filter((name) => name.startsWith(BACKUP_PREFIX)).sort().reverse().slice(BACKUPS_KEPT);
    await Promise.all(old.map((name) => fs.rm(path.join(this.backupDir, name), { force: true })));
    return target;
  }

  async exportTo(file) {
    await this.queue;
    await fs.copyFile(this.file, file);
  }

  /** Восстановление из файла копии. Текущие данные сначала сохраняются в копии. */
  async importFrom(file) {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.students)) throw Object.assign(new Error('not a backup'), { code: 'not-backup' });
    await this.queue;
    if (existsSync(this.file)) {
      await fs.mkdir(this.backupDir, { recursive: true });
      await fs.copyFile(this.file, path.join(this.backupDir, `${BACKUP_PREFIX}${this.today()}-before-restore-${Date.now()}.json`));
    }
    const data = this.normalize(raw, this.today());
    await this.save(data);
    return data;
  }
}

module.exports = { Store, BACKUP_PREFIX, BACKUPS_KEPT };
