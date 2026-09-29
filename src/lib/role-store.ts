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
 * TODO: เมื่อต่อ backend ให้แทนด้วยการกรองด้วย employee_id ของผู้ล็อกอินแทน
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { ROLES, type Role } from "./role";
import { personKey, personKeysOf, subscribePerson } from "./person-key";

export type ByRole<T> = Record<Role, T>;

/**
 * เก็บแยก "ตามคน" ไม่ใช่ตามบทบาท (เจ้าของสั่ง 29 ก.ย. 2569)
 * บทบาทที่มีคนเดียวใช้ชื่อบทบาทเป็นคีย์เหมือนเดิม ข้อมูลที่เก็บไว้ก่อนจึงไม่หาย
 * ส่วนทีมงานแยกเป็น staff:<รหัสพนักงาน> ทีละคน
 */
export function createRoleStore<T>(
  key: string,
  seed: ByRole<T>,
  /** ตรวจว่าส่วนของคนหนึ่งยังใช้ได้ กันข้อมูลเก่าคนละรูปแบบ */
  isSlice: (value: unknown) => value is T,
  /** ปรับข้อมูลเก่าของแต่ละคนให้ทันรูปแบบล่าสุด */
  fixSlice?: (value: T) => T,
  /**
   * รวมข้อมูลของหลายคนในบทบาทเดียว — หน้าอนุมัติมองทีมงานเป็นก้อนเดียว
   * ไม่ส่งมาคือใช้ก้อนแรก (สโตร์ที่ไม่ใช่ลิสต์)
   */
  mergeSlices?: (list: T[]) => T,
  /**
   * ก้อนของคนที่ยังไม่เคยมีข้อมูล — ทีมงานคนอื่นต้องเริ่มจากศูนย์
   * ไม่ใช่ได้ใบลาตัวอย่างของคนตั้งต้นติดมาทั้งชุด (เลขที่ใบจะซ้ำกันด้วย)
   */
  emptySlice?: T,
) {
  /* บทบาทที่เพิ่มทีหลัง (เช่น ceo, gm) ยังไม่มีส่วนของตัวเองในข้อมูลที่เก็บไว้ก่อน
     จึงตรวจเฉพาะส่วนที่มีอยู่ แล้วค่อยเติมส่วนที่ขาดจากชุดตั้งต้น — ไม่งั้นข้อมูลเดิมทั้งก้อนถูกทิ้ง */
  type Slices = Record<string, T>;

  function isSlices(value: unknown): value is Slices {
    if (typeof value !== "object" || value === null) return false;
    const all = value as Record<string, unknown>;
    const have = Object.keys(all);
    return have.length > 0 && have.every((k) => isSlice(all[k]));
  }

  function fill(all: Slices): Slices {
    const out = { ...all };
    for (const r of ROLES) {
      if (!(r.key in out)) out[r.key] = seed[r.key];
    }
    if (fixSlice) for (const k of Object.keys(out)) out[k] = fixSlice(out[k]);
    return out;
  }

  const store = createPersistedStore<Slices>(key, seed as Slices, isSlices, fill);

  /* คนที่เพิ่งถูกเลือกครั้งแรกยังไม่มีก้อนของตัวเอง — เริ่มจากก้อนของบทบาทนั้น
     ทีมงานคนแรก (ที่ผูกไว้แต่เดิม) จึงยังได้ข้อมูลตัวอย่างชุดเดิม ส่วนคนอื่นเริ่มจากชุดเดียวกัน */
  function sliceOf(all: Slices, k: string): T {
    if (k in all) return all[k];
    const role = (k.split(":")[0] as Role) ?? "sales";
    /* ทีมงานคนที่เพิ่งถูกเลือกครั้งแรกเริ่มจากศูนย์ ส่วนคีย์ของบทบาทใช้ชุดตั้งต้นเดิม */
    if (k !== role && emptySlice !== undefined) return emptySlice;
    return all[role] ?? seed[role];
  }

  const merge = (list: T[]): T => (mergeSlices ? mergeSlices(list) : list[0]);

  const get = () => sliceOf(store.get(), personKey());
  const getServer = () => store.getServer().sales;

  /* ข้อมูลเปลี่ยนได้สามทาง — แก้ข้อมูลเอง สลับบทบาท หรือสลับคนในทีม */
  function subscribe(onChange: () => void) {
    const off = [store.subscribe(onChange), subscribePerson(onChange)];
    return () => off.forEach((fn) => fn());
  }

  /** มองทั้งระบบเป็นรายบทบาท — ทีมงานรวมทุกคนเป็นก้อนเดียวให้หน้าอนุมัติ */
  function byRole(all: Slices): ByRole<T> {
    return Object.fromEntries(
      ROLES.map((r) => [r.key, merge(personKeysOf(r.key).map((k) => sliceOf(all, k)))]),
    ) as ByRole<T>;
  }

  let seenAll: Slices | null = null;
  let seenByRole: ByRole<T> | null = null;
  function byRoleCached(all: Slices): ByRole<T> {
    if (all !== seenAll || seenByRole === null) {
      seenAll = all;
      seenByRole = byRole(all);
    }
    return seenByRole;
  }

  return {
    /** ข้อมูลของบทบาทที่ล็อกอินอยู่ */
    use: () => useSyncExternalStore(subscribe, get, getServer),
    /**
     * ข้อมูลของทุกบทบาท — ใช้เฉพาะหน้าอนุมัติ ที่หัวหน้าต้องเห็นคำขอของลูกน้อง
     * หน้าอื่นห้ามใช้ ไม่งั้นพนักงานจะเห็นใบลาของคนอื่นไปด้วย
     */
    useAll: () =>
      useSyncExternalStore(
        subscribe,
        () => byRoleCached(store.get()),
        () => byRoleCached(store.getServer()),
      ),
    /** อ่านนอก React */
    current: get,
    /** ทุกบทบาทนอก React — ใช้หาเลขที่เอกสารถัดไป ที่ต้องไม่ซ้ำทั้งบริษัท */
    all: (): T[] => Object.values(store.get()).filter((v) => v !== undefined),
    /** อ่านส่วนของบทบาทที่ระบุนอก React — ใช้หาใบที่หัวหน้ากำลังอนุมัติ */
    ofRole: (role: Role) => merge(personKeysOf(role).map((k) => sliceOf(store.get(), k))),
    /** แก้เฉพาะส่วนของบทบาทที่ล็อกอินอยู่ */
    update(fn: (slice: T) => T) {
      const k = personKey();
      store.update((all) => ({ ...all, [k]: fn(sliceOf(all, k)) }));
    },
    /** แก้ส่วนของบทบาทที่ระบุ — สำหรับหัวหน้าที่อนุมัติคำขอของลูกน้อง */
    updateRole(role: Role, fn: (slice: T) => T) {
      /* ทีมงานมีหลายคน — ใบที่หัวหน้ากดอยู่จะอยู่ในก้อนของคนใดคนหนึ่ง จึงไล่ทำให้ทุกคน */
      store.update((all) => {
        const out = { ...all };
        for (const k of personKeysOf(role)) out[k] = fn(sliceOf(all, k));
        return out;
      });
    },
    reset: store.reset,
  };
}
