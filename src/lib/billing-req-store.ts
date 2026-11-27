"use client";

import { useSyncExternalStore } from "react";
import { hasBackend } from "./supabase/env";
import {
  fetchBillingRequests,
  sbBillingRequestAdd,
  sbBillingRequestCancel,
  sbBillingRequestDone,
  type BillingRequest,
  type BillKind,
} from "./supabase/billing-requests";

/*
 * คำขอถึงบัญชีจากฝั่งโปรเจค — ต่อบริการเดิม (รอบที่ 139)
 *
 * ลูกค้าเก่าติดต่อ PM เอง → PM แจ้งบัญชีออกใบเสนอราคา/ใบแจ้งหนี้ได้เลย ไม่ต้องเปิดผู้สนใจใหม่
 * โหมดไม่มีฐานข้อมูลเก็บไว้ในหน่วยความจำของแท็บ เพราะเป็นงานที่ต้องถึงบัญชีจริง
 * เก็บในเครื่องแล้วไม่มีประโยชน์ (ท่าเดียวกับการแจ้งทำงานที่บ้าน)
 */

const EMPTY: BillingRequest[] = [];
let cache: BillingRequest[] = EMPTY;
let loaded = false;
let loading = false;
let version = 0;
const listeners = new Set<() => void>();

function bump() {
  version += 1;
  for (const l of listeners) l();
}

function load() {
  if (!hasBackend || loaded || loading) return;
  loading = true;
  void fetchBillingRequests()
    .then((rows) => {
      cache = rows;
      loaded = true;
    })
    .finally(() => {
      loading = false;
      bump();
    });
}

/** สั่งอ่านใหม่ — ใช้หลังแจ้ง ปิด หรือยกเลิก */
export function refreshBillingReq() {
  loaded = false;
  load();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  load();
  return () => listeners.delete(onChange);
}

const snapshot = () => {
  load();
  return cache;
};
const server = () => EMPTY;

/** คำขอที่ผู้ใช้คนนี้เห็น — PM/GM/บัญชี/ผู้บริหาร (ฐานข้อมูลคัดให้) */
export function useBillingReq() {
  void useSyncExternalStore(subscribe, () => version, () => 0);
  return useSyncExternalStore(subscribe, snapshot, server);
}

export const BILL_KIND: Record<BillKind, string> = {
  quotation: "ใบเสนอราคา",
  invoice: "ใบแจ้งหนี้",
};

export type BillReqResult = { ok: true; no?: string } | { ok: false; message: string };

const SAY: Record<string, string> = {
  not_allowed: "บทบาทนี้ทำรายการนี้ไม่ได้",
  bad_kind: "เลือกว่าขอใบเสนอราคาหรือใบแจ้งหนี้",
  need_note: "เขียนรายละเอียดที่ลูกค้าขอก่อน",
  no_project: "ไม่พบโปรเจคนี้",
  no_customer: "โปรเจคนี้ยังไม่ผูกกับลูกค้า",
  already_open: "มีคำขอประเภทนี้ของโปรเจคนี้ค้างอยู่แล้ว",
  need_doc: "ใส่เลขเอกสารที่ออกให้ลูกค้า",
  need_why: "บอกเหตุผลที่ยกเลิก",
  not_open: "คำขอนี้ปิดไปแล้ว หรือไม่ใช่คำขอของคุณ",
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
};

const done = (res: { ok: boolean; reason?: string; no?: string }, fail: string): BillReqResult => {
  if (res.ok) {
    refreshBillingReq();
    return { ok: true, no: res.no };
  }
  return { ok: false, message: SAY[res.reason ?? ""] ?? fail };
};

/** PM แจ้งบัญชีจากโปรเจค */
export async function askBilling(pj: string, kind: BillKind, note: string, service = ""): Promise<BillReqResult> {
  if (!note.trim()) return { ok: false, message: SAY.need_note };
  if (!hasBackend) return { ok: false, message: SAY.no_backend };
  const res = await sbBillingRequestAdd(pj, kind, note.trim(), service);
  return done(res as { ok: boolean; reason?: string; no?: string }, "แจ้งไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/** บัญชีทำเสร็จ — ผูกเลขเอกสารที่ออกให้ */
export async function closeBilling(no: string, docNo: string): Promise<BillReqResult> {
  if (!hasBackend) return { ok: false, message: SAY.no_backend };
  const res = await sbBillingRequestDone(no, docNo.trim());
  return done(res as { ok: boolean; reason?: string }, "ปิดคำขอไม่สำเร็จ ลองใหม่อีกครั้ง");
}

/** ยกเลิกคำขอ — คนแจ้งเองหรือบัญชี */
export async function dropBilling(no: string, why: string): Promise<BillReqResult> {
  if (!hasBackend) return { ok: false, message: SAY.no_backend };
  const res = await sbBillingRequestCancel(no, why.trim());
  return done(res as { ok: boolean; reason?: string }, "ยกเลิกไม่สำเร็จ ลองใหม่อีกครั้ง");
}
