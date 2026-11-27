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
  /**
   * เก็บไว้ที่ระบบด้วย ไม่ใช่แค่ในเครื่องนี้ (รอบที่ 155)
   * ใช้กับค่าตั้งส่วนตัวและร่างที่ยังไม่ยืนยัน — เปลี่ยนเครื่องแล้วต้องยังเห็นของเดิม
   * คีย์ต้องอยู่ในรายชื่อที่ฐานข้อมูลรับ (pref_key_ok) ไม่งั้นบันทึกไม่ขึ้น
   */
  cloud = false,
): PersistedStore<T> {

  let cache: T | undefined;
  let watching = false;
  /** ฟังก์ชันบันทึกขึ้นระบบ — มีค่าเมื่อผูกกับค่าตั้งในระบบสำเร็จแล้ว */
  let push: ((value: T) => void) | undefined;
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

  /*
   * ผูกกับค่าตั้งในระบบ — โหลดตอนมีคนใช้ชุดข้อมูลนี้จริง ไม่ใช่ตอน import
   * (ฝั่งเซิร์ฟเวอร์ไม่มี window และหน้าที่ไม่ได้ใช้ชุดนี้ก็ไม่ต้องยิงถาม)
   */
  function joinCloud() {
    if (!cloud || push || typeof window === "undefined") return;
    push = () => {};
    void import("./user-prefs").then((m) => {
      m.attachCloudPref(key, (value) => {
        /* ค่าจากระบบต้องผ่านตัวตรวจรูปแบบเดียวกับค่าในเครื่อง */
        if (!isValid(value)) return;
        const next = migrate ? migrate(value) : value;
        cache = next;
        write(next);
        notify();
      });
      push = (value) => m.pushCloudPref(key, value);
    });
  }

  return {
    subscribe(onChange) {
      watchOtherTabs();
      joinCloud();
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
      push?.(next);
      notify();
    },
    update(fn) {
      cache ??= read();
      cache = fn(cache);
      write(cache);
      push?.(cache);
      notify();
    },
    reset() {
      cache = initial;
      try {
        window.localStorage.removeItem(key);
      } catch {
        // ไม่เป็นไร ค่าในหน่วยความจำถูกรีเซ็ตแล้ว
      }
      /* ล้างในเครื่องแล้วต้องล้างที่ระบบด้วย ไม่งั้นเปิดใหม่ของเก่ากลับมา */
      push?.(initial);
      notify();
    },
  };
}
