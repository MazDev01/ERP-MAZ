"use client";

/*
 * สโตร์ที่แยกข้อมูลตามบทบาท
 *
 * งานส่วนตัวในกลุ่ม "ของฉัน" (ตอกบัตร ใบลา โอที ใบเบิก) เป็นของ "คน" ไม่ใช่ของระบบ
 * และในระบบนี้หนึ่งบทบาทคือหนึ่งคน (ดู mock-data.ts) สลับบทบาทจึงต้องได้ข้อมูลของคนนั้น
 * ไม่ใช่ใบลาของคนก่อนหน้าค้างอยู่
 *
 * เก็บลง localStorage เป็นก้อนเดียว { sales: [...], pm: [...], acc: [...] }
 * แล้วหั่นเฉพาะส่วนของบทบาทปัจจุบันตอนอ่าน — ข้อมูลของบทบาทอื่นไม่หายไปไหน
 *
 * ต่อฐานข้อมูลแล้ว (ส่ง remote เข้ามา) จะอ่านจากฐานข้อมูลแทน โดยฐานข้อมูล
 * กรองด้วยรหัสพนักงานของผู้ล็อกอินให้เอง (RLS) แล้วชั้นนี้หั่นเข้ารูป Record<Role, T>
 * เดิมเพื่อให้หน้าจอทุกหน้าใช้ต่อได้โดยไม่ต้องแก้
 *
 * ของที่ยังเขียนลงเครื่องอยู่ไม่ได้หายไป แต่จะไม่ถูกอ่านอีกเมื่อต่อฐานข้อมูลแล้ว
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { currentRole, subscribeRole, ROLES, type Role } from "./role";
import { hasBackend } from "./supabase/env";

export type ByRole<T> = Record<Role, T>;

/**
 * ที่มาจากฐานข้อมูล — ขอทีเดียวได้ทั้ง "ของฉัน" และ "ของทุกบทบาทที่มีสิทธิ์เห็น"
 * เพราะทั้งสองมาจากคำขอเดียวกัน ยิงสองรอบเปลืองเปล่า ๆ
 */
export type RemoteSource<T> = {
  fetch: () => Promise<{ mine: T; byRole: ByRole<T> }>;
  /**
   * ค่าว่างของข้อมูลหนึ่งบทบาท — ใช้ตอนยังโหลดไม่เสร็จหรือโหลดไม่ได้
   *
   * ต้องว่างจริง ห้ามใช้ข้อมูลตั้งต้น (seed) เพราะหน้าจอจะโชว์ข้อมูลจำลอง
   * ค้างอยู่ปนกับของจริง และถ้าโหลดพลาดก็จะดูเหมือนมีข้อมูลทั้งที่ไม่มี
   * (เจอตอนย้ายใบลา 2 พ.ย. 2569 — คิวอนุมัติโชว์ใบจำลอง 18 ใบ)
   */
  empty: T;
};

export function createRoleStore<T>(
  key: string,
  seed: ByRole<T>,
  /** ตรวจว่าส่วนของบทบาทหนึ่งยังใช้ได้ กันข้อมูลเก่าคนละรูปแบบ */
  isSlice: (value: unknown) => value is T,
  /** ปรับข้อมูลเก่าของแต่ละบทบาทให้ทันรูปแบบล่าสุด */
  fixSlice?: (value: T) => T,
  /** มีค่าและต่อฐานข้อมูลแล้ว = อ่านจากฐานข้อมูลแทน localStorage */
  remote?: RemoteSource<T>,
) {
  /* บทบาทที่เพิ่มทีหลัง (เช่น ceo, gm) ยังไม่มีส่วนของตัวเองในข้อมูลที่เก็บไว้ก่อน
     จึงตรวจเฉพาะส่วนที่มีอยู่ แล้วค่อยเติมส่วนที่ขาดจากชุดตั้งต้น — ไม่งั้นข้อมูลเดิมทั้งก้อนถูกทิ้ง */
  function isByRole(value: unknown): value is ByRole<T> {
    if (typeof value !== "object" || value === null) return false;
    const all = value as Record<string, unknown>;
    const have = ROLES.filter((r) => r.key in all);
    return have.length > 0 && have.every((r) => isSlice(all[r.key]));
  }

  function fill(all: ByRole<T>): ByRole<T> {
    const out = { ...all };
    for (const r of ROLES) {
      if (!(r.key in out)) out[r.key] = seed[r.key];
      if (fixSlice) out[r.key] = fixSlice(out[r.key]);
    }
    return out;
  }

  const store = createPersistedStore<ByRole<T>>(key, seed, isByRole, fill);

  /* ─── ที่มาจากฐานข้อมูล ─────────────────────────────────────────
   * useSyncExternalStore ต้องได้คำตอบทันที รอ await ไม่ได้ ครั้งแรกจึงคืน
   * ค่าตั้งต้นว่างและสั่งโหลดไว้ พอข้อมูลมาถึงก็บอกให้ทุกหน้าวาดใหม่
   */
  const live = Boolean(remote) && hasBackend;
  const BLANK = remote?.empty as T;
  const EMPTY_ALL = Object.fromEntries(ROLES.map((r) => [r.key, BLANK])) as ByRole<T>;
  let mine: T | null = null;
  let byRole: ByRole<T> | null = null;
  let loading = false;
  const watchers = new Set<() => void>();

  function tell() {
    for (const fn of watchers) fn();
  }

  function load() {
    if (!live || loading || byRole !== null) return;
    loading = true;
    void remote!
      .fetch()
      .then((got) => {
        mine = got.mine;
        byRole = got.byRole;
      })
      .catch(() => {
        /* อ่านไม่ได้ — ให้เป็นค่าว่างไว้ก่อน ไม่ปล่อยเป็น null
           ไม่งั้นจะวนยิงใหม่ทุกครั้งที่ React อ่าน snapshot */
        mine = BLANK;
        byRole = EMPTY_ALL;
      })
      .finally(() => {
        loading = false;
        tell();
      });
  }

  /** สั่งอ่านจากฐานข้อมูลใหม่ — เรียกหลังยื่น อนุมัติ หรือยกเลิก */
  function refresh() {
    if (!live) return;
    byRole = null;
    mine = null;
    load();
  }

  const get = () => {
    if (live) {
      load();
      return mine ?? BLANK;
    }
    return store.get()[currentRole()];
  };
  const getAll = () => {
    if (live) {
      load();
      return byRole ?? EMPTY_ALL;
    }
    return store.get();
  };
  const getServer = () => store.getServer().sales;

  /* ข้อมูลเปลี่ยนได้สองทาง — แก้ข้อมูลเอง หรือสลับบทบาท จึงต้องฟังทั้งคู่ */
  function subscribe(onChange: () => void) {
    watchers.add(onChange);
    const off = [store.subscribe(onChange), subscribeRole(onChange)];
    return () => {
      watchers.delete(onChange);
      off.forEach((fn) => fn());
    };
  }

  return {
    /** ข้อมูลของบทบาทที่ล็อกอินอยู่ */
    use: () => useSyncExternalStore(subscribe, get, getServer),
    /**
     * ข้อมูลของทุกบทบาท — ใช้เฉพาะหน้าอนุมัติ ที่หัวหน้าต้องเห็นคำขอของลูกน้อง
     * หน้าอื่นห้ามใช้ ไม่งั้นพนักงานจะเห็นใบลาของคนอื่นไปด้วย
     */
    useAll: () => useSyncExternalStore(subscribe, getAll, store.getServer),
    /** อ่านนอก React */
    current: get,
    /** ทุกบทบาทนอก React — ใช้หาเลขที่เอกสารถัดไป ที่ต้องไม่ซ้ำทั้งบริษัท */
    all: (): T[] => ROLES.map((r) => getAll()[r.key]).filter((v) => v !== undefined),
    /** อ่านส่วนของบทบาทที่ระบุนอก React — ใช้หาใบที่หัวหน้ากำลังอนุมัติ */
    ofRole: (role: Role) => getAll()[role],
    /** แก้เฉพาะส่วนของบทบาทที่ล็อกอินอยู่ */
    update(fn: (slice: T) => T) {
      const role = currentRole();
      store.update((all) => ({ ...all, [role]: fn(all[role]) }));
    },
    /** แก้ส่วนของบทบาทที่ระบุ — สำหรับหัวหน้าที่อนุมัติคำขอของลูกน้อง */
    updateRole(role: Role, fn: (slice: T) => T) {
      store.update((all) => ({ ...all, [role]: fn(all[role]) }));
    },
    reset: store.reset,
    /** อ่านจากฐานข้อมูลอยู่หรือไม่ — ตัวเรียกใช้ตัดสินว่าจะเขียนลงเครื่องหรือส่งขึ้นฐานข้อมูล */
    live,
    /** สั่งอ่านจากฐานข้อมูลใหม่ (ไม่ต่อฐานข้อมูลก็ไม่ทำอะไร) */
    refresh,
  };
}
