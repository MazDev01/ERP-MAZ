/*
 * ตัวช่วยสร้าง store ที่ทุกหน้าอ่านร่วมกันและเก็บลง localStorage
 * ใช้กับ useSyncExternalStore ได้ตรง ๆ (React 19 ห้าม setState ใน effect)
 *
 * เปิดหลายแท็บพร้อมกันได้ (ตรวจระบบ 5 ต.ค. 2569 · BUG-001)
 * เดิมอ่าน localStorage ครั้งเดียวแล้วจำไว้ แท็บที่เปิดค้างจึงถือข้อมูลเก่า
 * พอบันทึกก็เขียนทับของที่อีกแท็บเพิ่งเพิ่มไปจนหายถาวร แก้สองทาง
 *   1. ก่อนเขียนทุกครั้ง อ่านค่าล่าสุดจากเครื่องก่อน ไม่ใช้ค่าที่จำไว้
 *   2. ฟัง event "storage" — แท็บอื่นเขียนเมื่อไร ทิ้งค่าที่จำไว้แล้ววาดใหม่
 */
import { reportStorageError } from "./storage-health";

export type PersistedStore<T> = {
  subscribe: (onChange: () => void) => () => void;
  get: () => T;
  /** ตอน SSR ยังไม่มี localStorage — คืนค่าเริ่มต้นที่อ้างอิงคงที่ */
  getServer: () => T;
  set: (next: T) => void;
  update: (fn: (current: T) => T) => void;
  reset: () => void;
};

export function createPersistedStore<T>(
  key: string,
  initial: T,
  /** ตรวจว่าข้อมูลใน localStorage ยังใช้ได้ กันข้อมูลเก่าคนละรูปแบบ */
  isValid: (value: unknown) => value is T = (v): v is T => v !== null,
  /**
   * ปรับข้อมูลเก่าที่ยังใช้ได้ให้ทันค่าตั้งต้นล่าสุด — เช่นเติมรายการที่เพิ่มเข้าชุดตั้งต้นทีหลัง
   * ไม่ใช้วิธีเปลี่ยนคีย์ เพราะจะทิ้งทุกอย่างที่ผู้ใช้แก้ไว้ในเครื่องไปด้วย
   */
  migrate?: (value: T) => T,
): PersistedStore<T> {

  let cache: T | undefined;
  /** ข้อความดิบที่เราเขียนลงเครื่องครั้งล่าสุด — ใช้เทียบว่า event storage เป็นของเราเองหรือของแท็บอื่น */
  let lastRaw: string | null = null;
  const listeners = new Set<() => void>();
  let watching = false;

  function parse(raw: string | null): T {
    try {
      if (!raw) return initial;
      const parsed: unknown = JSON.parse(raw);
      if (!isValid(parsed)) return initial;
      return migrate ? migrate(parsed) : parsed;
    } catch {
      return initial;
    }
  }

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      lastRaw = raw;
      return parse(raw);
    } catch {
      return initial;
    }
  }

  function write(value: T) {
    const raw = JSON.stringify(value);
    try {
      window.localStorage.setItem(key, raw);
      lastRaw = raw;
    } catch (error) {
      /* โควตาเต็มหรือโหมดส่วนตัว — หน้าจอยังเปลี่ยนตามได้ แต่ต้องบอกผู้ใช้ว่าข้อมูลไม่ได้ถูกเก็บ */
      reportStorageError(error);
    }
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  /** แท็บอื่นเขียนคีย์เดียวกัน — ทิ้งค่าที่จำไว้แล้วให้หน้าจอวาดใหม่จากของจริง */
  function watch() {
    if (watching || typeof window === "undefined") return;
    watching = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== null && e.key !== key) return;
      /* ค่าที่เราเพิ่งเขียนเอง ไม่ต้องวาดใหม่ */
      if (e.newValue === lastRaw) return;
      lastRaw = e.newValue;
      cache = parse(e.newValue);
      notify();
    });
  }

  return {
    subscribe(onChange) {
      watch();
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
    get() {
      cache ??= read();
      return cache;
    },
    getServer() {
      return initial;
    },
    set(next) {
      cache = next;
      write(next);
      notify();
    },
    update(fn) {
      /* อ่านของล่าสุดจากเครื่องก่อนเสมอ — แท็บอื่นอาจเพิ่งเพิ่มข้อมูลไป ถ้าใช้ค่าที่จำไว้จะเขียนทับจนหาย */
      cache = fn(read());
      write(cache);
      notify();
    },
    reset() {
      cache = initial;
      try {
        window.localStorage.removeItem(key);
        lastRaw = null;
      } catch {
        // ไม่เป็นไร ค่าในหน่วยความจำถูกรีเซ็ตแล้ว
      }
      notify();
    },
  };
}
