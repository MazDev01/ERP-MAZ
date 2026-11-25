"use client";

/*
 * อ่านข้อความถึงไหนแล้ว — ทำให้สายข้อความของงานใช้งานเหมือนแชททั่วไป (เจ้าของสั่ง 5 ต.ค. 2569)
 *
 * เดิมส่งข้อความหากันได้ แต่ไม่มีใครรู้ว่ามีข้อความใหม่ ต้องไล่เปิดทีละงาน
 * ไฟล์นี้จำว่าแต่ละคนอ่านสายข้อความของงานไหนถึงข้อความเวลาใดแล้ว
 * นับเฉพาะข้อความของ "อีกฝ่าย" เป็นข้อความใหม่ ของตัวเองไม่ต้องนับ
 *
 * เก็บแยกตามคน (PM ใช้คีย์ "PM" · ผู้รับงานใช้รหัสพนักงาน) เหมือนที่สโตร์อื่นทำ
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 115 ตาราง talk_reads) — เปลี่ยนเครื่องแล้วจุดแดงไม่ขึ้นใหม่ทั้งหมด
 * แต่ละแถวเป็นของพนักงานคนนั้น เห็นได้เฉพาะของตัวเอง
 * ยังไม่ได้ต่อฐานข้อมูล (dev ที่ไม่มีคีย์) ถอยไปเก็บในเบราว์เซอร์เหมือนเดิม
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { talkKey, type TaskTalk } from "./pm-store";
import { hasBackend } from "./supabase/env";
import { fetchTalkReads, sbMarkRead } from "./supabase/talk-reads";

/**
 * { "<ผู้ใช้>": { "<deal>|<ชื่องาน>": จำนวนข้อความของอีกฝ่ายที่อ่านไปแล้ว } }
 *
 * เก็บเป็น "จำนวนข้อความที่อ่านแล้ว" ไม่ใช่เวลาล่าสุด เพราะเวลาที่ประทับละเอียดแค่ระดับนาที
 * ถ้าสองคนพิมพ์ในนาทีเดียวกัน การเทียบเวลาจะนับผิด (ไม่ขึ้นว่ามีข้อความใหม่ หรือขึ้นค้างไม่หาย)
 */
type ReadMarks = Record<string, Record<string, number>>;

const store = createPersistedStore<ReadMarks>(
  "maz-erp.talk-read.v1",
  {},
  (v): v is ReadMarks => typeof v === "object" && v !== null && !Array.isArray(v),
);

/* ─── ชั้นต่อฐานข้อมูล ───────────────────────────────────────────── */
const live = hasBackend;
const EMPTY: ReadMarks = {};
let fromDb: ReadMarks | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || fromDb !== null) return;
  loading = true;
  void fetchTalkReads()
    .then((got) => {
      fromDb = got;
    })
    .catch(() => {
      fromDb = EMPTY;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/** จดลงฐานข้อมูลแล้วขยับค่าที่ถืออยู่เลย ไม่ต้องอ่านใหม่ทั้งก้อน */
function bump(who: string, key: string, seen: number) {
  const base = fromDb ?? EMPTY;
  fromDb = { ...base, [who]: { ...(base[who] ?? {}), [key]: seen } };
  tell();
  void sbMarkRead(who, key, seen);
}

function marksNow(): ReadMarks {
  if (!live) return store.get();
  load();
  return fromDb ?? EMPTY;
}

function subscribeAll(onChange: () => void) {
  const off = store.subscribe(onChange);
  watchers.add(onChange);
  return () => {
    off();
    watchers.delete(onChange);
  };
}

export function useTalkRead() {
  return useSyncExternalStore(subscribeAll, marksNow, store.getServer);
}

/** นับข้อความของอีกฝ่ายในสายนี้ */
function fromOthers(who: string, talks: TaskTalk[]) {
  return talks.filter((m) => m.who !== who).length;
}

/* ── ใช้กับสายสนทนาอื่นที่ไม่ใช่งานในโปรเจค (เช่น คำขอก่อนการขาย) ──
   ส่ง "คีย์ของสาย" กับ "จำนวนข้อความของอีกฝ่าย" มาเอง */

export function markReadKey(who: string, key: string, othersTotal: number) {
  if ((marksNow()[who]?.[key] ?? 0) === othersTotal) return;
  if (live) {
    bump(who, key, othersTotal);
    return;
  }
  store.update((s) => ({ ...s, [who]: { ...(s[who] ?? {}), [key]: othersTotal } }));
}

export function unreadByKey(marks: ReadMarks, who: string, key: string, othersTotal: number) {
  return Math.max(0, othersTotal - (marks[who]?.[key] ?? 0));
}

/** เปิดอ่านสายข้อความแล้ว — จำว่าอ่านข้อความของอีกฝ่ายไปกี่ข้อความ */
export function markTalkRead(who: string, deal: string, taskName: string, talks: TaskTalk[]) {
  const seen = fromOthers(who, talks);
  const key = talkKey(deal, taskName);
  /* ไม่มีอะไรเปลี่ยนก็ไม่ต้องแตะสโตร์ — กันหน้าจอวนเรนเดอร์ */
  if ((marksNow()[who]?.[key] ?? 0) === seen) return;
  if (live) {
    bump(who, key, seen);
    return;
  }
  store.update((s) => ({ ...s, [who]: { ...(s[who] ?? {}), [key]: seen } }));
}

/** ข้อความของอีกฝ่ายที่ยังไม่ได้อ่านในสายนี้มีกี่ข้อความ */
export function unreadCount(marks: ReadMarks, who: string, deal: string, taskName: string, talks: TaskTalk[]) {
  const read = marks[who]?.[talkKey(deal, taskName)] ?? 0;
  return Math.max(0, fromOthers(who, talks) - read);
}
