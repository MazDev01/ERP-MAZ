/*
 * ตั้งค่าการแจ้งเตือนของพนักงาน — หน้าโปรไฟล์เป็นคนแก้ หน้าอื่นเป็นคนใช้
 * (หน้าตอกบัตรใช้เวลาเตือนล่วงหน้า · กระดิ่งใช้ว่าเรื่องไหนเปิดอยู่)
 */

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import { fetchNotifySettings, saveNotifySettingsRemote } from "./supabase/notify";

/** เรื่องที่แจ้งเตือนได้ — คีย์เดียวกับที่การแจ้งเตือนในกระดิ่งใช้จัดกลุ่ม */
export const NOTIFY_EVENTS = [
  { key: "checkin", title: "เตือนเช็คอินเข้างาน", detail: "แจ้งเมื่อถึงเวลาเข้างานและอยู่ในพื้นที่ทำงาน" },
  { key: "checkout", title: "เตือนเช็คเอาท์ออกงาน", detail: "แจ้งตอนครบเวลาเลิกงานของกะวันนั้น" },
  { key: "forgot", title: "ลืมเช็คเอาท์", detail: "เตือนอีกครั้ง 30 นาทีหลังเลิกงานถ้ายังไม่กด" },
  { key: "leave", title: "ผลอนุมัติใบลา", detail: "เมื่อหัวหน้าอนุมัติหรือไม่อนุมัติใบลาของคุณ" },
  { key: "presales", title: "คำขอก่อนการขายส่งกลับ", detail: "เมื่อ BD หรือ SA ส่งข้อเสนอกลับมาให้คุณ" },
  { key: "quotexp", title: "ใบเสนอราคาใกล้หมดอายุ", detail: "เตือนล่วงหน้าก่อนใบเสนอราคาที่คุณออกจะหมดอายุ" },
] as const;

export type NotifyEventKey = (typeof NOTIFY_EVENTS)[number]["key"];

export const NOTIFY_CHANNELS = [
  { key: "popup", label: "ป๊อปอัป" },
  { key: "sound", label: "เสียง" },
  { key: "vibrate", label: "สั่น" },
] as const;

export type NotifyChannel = (typeof NOTIFY_CHANNELS)[number]["key"];

export type NotifySettings = {
  /** สวิตช์ใหญ่ ปิดแล้วไม่เตือนอะไรเลย */
  on: boolean;
  /** เตือนก่อนเวลาเข้างานกี่นาที (0 = ตรงเวลา) */
  leadIn: number;
  /** เตือนก่อนเลิกงานกี่นาที */
  leadOut: number;
  /** ยังไม่กดแล้วเตือนซ้ำทุกกี่นาที (0 = ไม่เตือนซ้ำ) */
  repeat: number;
  /** ช่วงพักกลางวันเตือนแบบเงียบ */
  quietLunch: boolean;
  channels: Record<string, Record<string, boolean>>;
};

export const DEFAULT_NOTIFY: NotifySettings = {
  on: true,
  leadIn: 10,
  leadOut: 0,
  repeat: 5,
  quietLunch: true,
  channels: Object.fromEntries(
    NOTIFY_EVENTS.map((e) => [
      e.key,
      {
        popup: true,
        sound: e.key === "checkin" || e.key === "checkout",
        vibrate: e.key === "checkin",
      },
    ]),
  ),
};

function isSettings(value: unknown): value is NotifySettings {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.on === "boolean" && typeof s.leadIn === "number";
}

const store = createPersistedStore<NotifySettings>(
  "maz-erp.notify.v1",
  DEFAULT_NOTIFY,
  isSettings,
);

/*
 * ต่อฐานข้อมูลแล้วเก็บที่ notify_settings ของคนนั้น
 * ตั้งค่าที่มือถือแล้วคอมต้องรู้ด้วย ไม่ใช่ต่างเครื่องต่างตั้ง
 */
const live = hasBackend;
let pulled = false;
let pulling = false;
const watchers = new Set<() => void>();

function pull() {
  if (!live || pulling || pulled) return;
  pulling = true;
  void fetchNotifySettings()
    .then((got) => {
      pulled = true;
      if (got) store.set({ ...DEFAULT_NOTIFY, ...(got as Partial<NotifySettings>) });
    })
    .catch(() => {
      pulled = true;
    })
    .finally(() => {
      pulling = false;
      for (const fn of watchers) fn();
    });
}

function subscribe(onChange: () => void) {
  watchers.add(onChange);
  const off = store.subscribe(onChange);
  return () => {
    watchers.delete(onChange);
    off();
  };
}

function snapshot(): NotifySettings {
  pull();
  return store.get();
}

export function useNotifySettings() {
  return useSyncExternalStore(subscribe, snapshot, store.getServer);
}

export function saveNotifySettings(next: NotifySettings) {
  store.set(next);
  if (live) void saveNotifySettingsRemote(next);
}

export function resetNotifySettings() {
  store.reset();
}

/** เรื่องนี้เตือนแบบป๊อปอัปอยู่ไหม — ปิดสวิตช์ใหญ่แล้วถือว่าปิดหมด */
export function popupOn(s: NotifySettings, event: NotifyEventKey) {
  return s.on && (s.channels[event]?.popup ?? true);
}
