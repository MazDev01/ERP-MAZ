"use client";

/*
 * อ่านข้อความถึงไหนแล้ว — ทำให้สายข้อความของงานใช้งานเหมือนแชททั่วไป (เจ้าของสั่ง 5 ต.ค. 2569)
 *
 * เดิมส่งข้อความหากันได้ แต่ไม่มีใครรู้ว่ามีข้อความใหม่ ต้องไล่เปิดทีละงาน
 * ไฟล์นี้จำว่าแต่ละคนอ่านสายข้อความของงานไหนถึงข้อความเวลาใดแล้ว
 * นับเฉพาะข้อความของ "อีกฝ่าย" เป็นข้อความใหม่ ของตัวเองไม่ต้องนับ
 *
 * เก็บแยกตามคน (PM ใช้คีย์ "PM" · ผู้รับงานใช้รหัสพนักงาน) เหมือนที่สโตร์อื่นทำ
 * TODO: ต่อ backend แล้วเก็บเป็น task_talk_read (user_id, talk_key, read_at)
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { talkKey, type TaskTalk } from "./pm-store";

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

export function useTalkRead() {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

/** นับข้อความของอีกฝ่ายในสายนี้ */
function fromOthers(who: string, talks: TaskTalk[]) {
  return talks.filter((m) => m.who !== who).length;
}

/** เปิดอ่านสายข้อความแล้ว — จำว่าอ่านข้อความของอีกฝ่ายไปกี่ข้อความ */
export function markTalkRead(who: string, deal: string, taskName: string, talks: TaskTalk[]) {
  const seen = fromOthers(who, talks);
  /* ไม่มีอะไรเปลี่ยนก็ไม่ต้องแตะสโตร์ — กันหน้าจอวนเรนเดอร์ */
  if ((store.get()[who]?.[talkKey(deal, taskName)] ?? 0) === seen) return;
  store.update((s) => ({
    ...s,
    [who]: { ...(s[who] ?? {}), [talkKey(deal, taskName)]: seen },
  }));
}

/** ข้อความของอีกฝ่ายที่ยังไม่ได้อ่านในสายนี้มีกี่ข้อความ */
export function unreadCount(marks: ReadMarks, who: string, deal: string, taskName: string, talks: TaskTalk[]) {
  const read = marks[who]?.[talkKey(deal, taskName)] ?? 0;
  return Math.max(0, fromOthers(who, talks) - read);
}
