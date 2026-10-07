/*
 * ตัวช่วยสร้าง store ที่ทุกหน้าอ่านร่วมกันและเก็บลง localStorage
 * ใช้กับ useSyncExternalStore ได้ตรง ๆ (React 19 ห้าม setState ใน effect)
 */
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
  let watching = false;
  const listeners = new Set<() => void>();

  function read(): T {
    try {
      const raw = window.localStorage.getItem(key);
      if (!raw) return initial;
      const parsed: unknown = JSON.parse(raw);
      if (!isValid(parsed)) return initial;
      return migrate ? migrate(parsed) : parsed;
    } catch {
      return initial;
    }
  }

  function write(value: T) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // โควตาเต็มหรือโหมดส่วนตัว — ยังให้หน้าจอเปลี่ยนตามได้
    }
  }

  function notify() {
    for (const listener of listeners) listener();
  }

  /*
   * อีกแท็บของเบราว์เซอร์เดียวกันแก้ข้อมูลชุดนี้ — ทิ้งค่าที่จำไว้แล้ววาดใหม่
   * ไม่งั้นแต่ละแท็บทำงานบนข้อมูลคนละชุด แล้วแท็บที่บันทึกทีหลังจะเขียนทับของอีกแท็บ
   * (เจอตอนทดสอบสองแท็บกดรับงานใบเดียวกัน 7 ต.ค. 2569 — รับได้ทั้งคู่ทั้งที่ควรได้คนเดียว)
   */
  function watchOtherTabs() {
    if (typeof window === "undefined" || watching) return;
    watching = true;
    window.addEventListener("storage", (e) => {
      if (e.key !== key && e.key !== null) return;
      cache = undefined;
      notify();
    });
  }

  return {
    subscribe(onChange) {
      watchOtherTabs();
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
      cache ??= read();
      cache = fn(cache);
      write(cache);
      notify();
    },
    reset() {
      cache = initial;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ไม่เป็นไร ค่าในหน่วยความจำถูกรีเซ็ตแล้ว
      }
      notify();
    },
  };
}
