import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { config } from '../config.js';
import { MIGRATIONS } from './migrations.js';

export type Row = Record<string, unknown>;
type Param = SQLInputValue | boolean | undefined;

function norm(params: Param[]): SQLInputValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

export class Db {
  readonly raw: DatabaseSync;
  constructor(file: string) {
    this.raw = new DatabaseSync(file);
    this.raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  }
  get<T = Row>(sql: string, ...params: Param[]): T | undefined {
    return this.raw.prepare(sql).get(...norm(params)) as T | undefined;
  }
  all<T = Row>(sql: string, ...params: Param[]): T[] {
    return this.raw.prepare(sql).all(...norm(params)) as T[];
  }
  run(sql: string, ...params: Param[]): { changes: number } {
    const r = this.raw.prepare(sql).run(...norm(params));
    return { changes: Number(r.changes) };
  }
  tx<T>(fn: () => T): T {
    this.raw.exec('BEGIN');
    try {
      const out = fn();
      this.raw.exec('COMMIT');
      return out;
    } catch (e) {
      this.raw.exec('ROLLBACK');
      throw e;
    }
  }
  migrate(): void {
    const current = Number((this.raw.prepare('PRAGMA user_version').get() as { user_version: number }).user_version);
    for (let v = current; v < MIGRATIONS.length; v++) {
      this.tx(() => {
        this.raw.exec(MIGRATIONS[v]);
        this.raw.exec(`PRAGMA user_version = ${v + 1}`);
      });
    }
  }
  close(): void {
    this.raw.close();
  }
}

let instance: Db | null = null;

export function getDb(): Db {
  if (!instance) {
    instance = new Db(config.dbPath);
    instance.migrate();
  }
  return instance;
}

/** For tests: use an isolated database file (or ':memory:'). */
export function setDb(db: Db): void {
  instance = db;
}

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string' || v === '') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
