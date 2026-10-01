"use client";

/*
 * สถานะบัญชีผู้ใช้ — ฝ่ายบุคคลระงับบัญชี หรือสั่งให้ตั้งรหัสผ่านใหม่ได้ที่ /hr/accounts
 * (ผู้ใช้สั่ง 18 ก.ย. 2569 ให้บัญชีผู้ใช้เป็นหน้าที่ของฝ่ายบุคคล หน้าของผู้ดูแลระบบถูกเอาออก)
 *
 * สถานะเก็บ "ตามคน" (รหัสพนักงาน) ตั้งแต่ 1 ต.ค. 2569
 * เดิมเก็บตามบทบาท พอบทบาทเดียวมีหลายคน ระงับคนหนึ่งเลยไปโดนคนอื่นในบทบาทเดียวกันด้วย
 * หน้าเข้าสู่ระบบอ่านสถานะจากที่นี่: ระงับอยู่ → ขึ้นหน้าบัญชีถูกระงับ · ต้องตั้งรหัสใหม่ → ไปหน้าตั้งรหัสผ่าน
 *
 * ยังไม่มี backend — กันได้แค่ในเครื่องนี้ ของจริงต้องตรวจที่เซิร์ฟเวอร์ตอนล็อกอิน
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import type { Role } from "./role";
import { ROLE_EMPLOYEE } from "./hr-data";

export type Account = {
  suspended: boolean;
  suspendedWhy: string;
  suspendedAt: string;
  mustResetPassword: boolean;
  lastLoginAt: string;
};

/* คีย์ = รหัสพนักงาน (E05) — บัญชีเป็นของคน ไม่ใช่ของบทบาท
   บทบาทที่ไม่มีคนในทะเบียน (ผู้บริหาร) ใช้ชื่อบทบาทเป็นคีย์แทน */
export type Accounts = Partial<Record<string, Account>>;

const BLANK: Account = {
  suspended: false,
  suspendedWhy: "",
  suspendedAt: "",
  mustResetPassword: false,
  lastLoginAt: "",
};

const store = createPersistedStore<Accounts>("maz-erp.accounts.v1", {}, (v): v is Accounts =>
  typeof v === "object" && v !== null && !Array.isArray(v),
);

export function useAccounts() {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/**
 * คีย์ของบัญชีที่ล็อกอินอยู่ — รหัสพนักงานของคนนั้น
 * พนักงานมีหลายคน จึงต้องส่งรหัสของคนที่เลือกไว้มาด้วย (staff-identity)
 */
export function accountKey(role: Role, staffId?: string): string {
  if (role === "staff") return staffId || ROLE_EMPLOYEE.staff || "staff";
  return ROLE_EMPLOYEE[role] ?? role;
}

export function accountOf(key: string, all: Accounts = store.get()): Account {
  /* ข้อมูลเก่าเก็บด้วยชื่อบทบาท — ถ้าคีย์ใหม่ยังว่าง อ่านของเดิมของบทบาทที่ผูกกับคนนี้ไว้ก่อน */
  if (!all[key]) {
    const legacy = (Object.keys(ROLE_EMPLOYEE) as Role[]).find((r) => ROLE_EMPLOYEE[r] === key);
    if (legacy && all[legacy]) return { ...BLANK, ...all[legacy] };
  }
  return { ...BLANK, ...all[key] };
}

function patch(key: string, p: Partial<Account>) {
  store.update((all) => ({ ...all, [key]: { ...accountOf(key, all), ...p } }));
}

export function suspendAccount(key: string, why: string, at: string) {
  patch(key, { suspended: true, suspendedWhy: why, suspendedAt: at });
}

export function restoreAccount(key: string) {
  patch(key, { suspended: false, suspendedWhy: "", suspendedAt: "" });
}

export function requirePasswordReset(key: string, on: boolean) {
  patch(key, { mustResetPassword: on });
}

export function markLogin(key: string, at: string) {
  patch(key, { lastLoginAt: at });
}

export function resetAccounts() {
  store.reset();
}
