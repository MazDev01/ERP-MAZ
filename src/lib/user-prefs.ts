"use client";

/*
 * สะพานระหว่างชุดข้อมูลในเครื่องกับค่าตั้งส่วนตัวในระบบ (รอบที่ 155)
 *
 * ชุดข้อมูลที่เปิดโหมดนี้ (ดู createPersistedStore พารามิเตอร์ cloud) จะ
 *   · ตอนเปิดแอป อ่านค่าของคนที่ล็อกอินจากระบบมาทับค่าในเครื่อง
 *   · ทุกครั้งที่แก้ บันทึกขึ้นระบบให้ (หน่วงไว้หน่อย เพราะหน้าร่างบันทึกทุกตัวอักษร)
 *   · เปลี่ยนคนล็อกอิน อ่านของคนใหม่ทันที ไม่ใช้ค่าที่ค้างจากคนก่อน
 *
 * ยังไม่ได้ต่อฐานข้อมูลหรืออ่านไม่ได้ → เงียบ ๆ ใช้ค่าในเครื่องเหมือนเดิม
 * ค่าในเครื่องยังเขียนอยู่ด้วย จึงเปิดแอปครั้งถัดไปเห็นของเดิมทันทีไม่ต้องรอเน็ต
 */

import { hasBackend } from "./supabase/env";
import { meNow, subscribeMe } from "./supabase/me";
import { fetchPrefs, savePref } from "./supabase/prefs";

/** หน่วงก่อนบันทึกขึ้นระบบ — หน้าร่างพิมพ์ทีละตัวอักษร ไม่ควรยิงทุกตัว */
const PUSH_MS = 800;

type Hook = {
  key: string;
  /** เอาค่าจากระบบมาใส่ชุดข้อมูลในเครื่อง — ชุดข้อมูลตรวจรูปแบบเองว่ารับได้ไหม */
  apply: (value: unknown) => void;
};

const hooks = new Map<string, Hook>();
/** ค่าที่อ่านมาแล้วรอบนี้ — รีเซ็ตเมื่อเปลี่ยนคนล็อกอิน */
let pulled: Promise<Record<string, unknown> | null> | null = null;
let pulledFor = "";
const timers = new Map<string, number>();
let watching = false;

function whoNow() {
  return meNow()?.username ?? "";
}

/** อ่านค่าตั้งของคนที่ล็อกอินอยู่ แล้วแจกให้ชุดข้อมูลที่เปิดโหมดนี้ */
function pull() {
  if (!hasBackend) return;
  const me = whoNow();
  if (pulled && pulledFor === me) return;
  pulledFor = me;
  pulled = fetchPrefs();
  void pulled.then((all) => {
    if (!all || pulledFor !== whoNow()) return;
    for (const hook of hooks.values()) {
      if (hook.key in all) hook.apply(all[hook.key]);
    }
  });
}

/*
 * เปลี่ยนคนล็อกอิน — ของคนก่อนใช้ต่อไม่ได้
 * (หน้า login อ่านค่าไว้ตอนยังไม่รู้ว่าเป็นใคร จึงต้องอ่านใหม่เมื่อรู้ตัวตนแล้ว)
 */
function watchIdentity() {
  if (watching || !hasBackend) return;
  watching = true;
  subscribeMe(() => {
    if (whoNow() === pulledFor) return;
    pulled = null;
    pull();
  });
}

/** ชุดข้อมูลหนึ่งชุดขอใช้ค่าตั้งในระบบ — เรียกครั้งเดียวตอนมีคนเปิดหน้าที่ใช้ชุดนี้ */
export function attachCloudPref(key: string, apply: (value: unknown) => void) {
  if (!hasBackend || hooks.has(key)) return;
  hooks.set(key, { key, apply });
  watchIdentity();
  pull();
}

/** ชุดข้อมูลถูกแก้ — บันทึกขึ้นระบบ (หน่วงรวบ) */
export function pushCloudPref(key: string, value: unknown) {
  if (!hasBackend || !hooks.has(key)) return;
  window.clearTimeout(timers.get(key));
  timers.set(
    key,
    window.setTimeout(() => {
      timers.delete(key);
      void savePref(key, value);
    }, PUSH_MS),
  );
}
