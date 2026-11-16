"use client";

import { useSyncExternalStore } from "react";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import { fetchReadKeys, markReadRemote } from "./supabase/notify";

/*
 * เก็บเฉพาะ "อ่านแล้ว" ของแต่ละเรื่อง ตัวเนื้อหาคำนวณสดจากข้อมูลจริงเสมอ
 * ถ้าเรื่องนั้นจบไปแล้ว รายการหายเอง ไม่ต้องมาไล่ลบ
 */
const store = createPersistedStore<string[]>(
  "maz-erp.notice-read.v1",
  [],
  (v): v is string[] => Array.isArray(v),
);

/*
 * ต่อฐานข้อมูลแล้วเก็บที่ notification_reads ของคนนั้น
 * ของเดิมอยู่ในเครื่อง เปิดอีกเครื่องกระดิ่งขึ้นแดงอีกรอบทั้งที่อ่านไปแล้ว
 *
 * หน้าจอขยับทันทีที่กด (เก็บลงเครื่องด้วย) แล้วค่อยยืนยันกับฐานข้อมูล
 * เพราะการ "อ่านแล้ว" ไม่ใช่เรื่องที่ต้องรอ และพลาดก็แค่ขึ้นใหม่รอบหน้า
 */
const live = hasBackend;
let remote: string[] | null = null;
let loading = false;
const watchers = new Set<() => void>();
const EMPTY: string[] = [];

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || remote !== null) return;
  loading = true;
  void fetchReadKeys()
    .then((keys) => {
      /* null = บัญชีนี้เก็บในฐานข้อมูลไม่ได้ (ไม่ใช่พนักงาน) ใช้ของในเครื่องต่อ */
      remote = keys ?? EMPTY;
    })
    .catch(() => {
      remote = EMPTY;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/* รวมของในเครื่องกับของในฐานข้อมูล — จำไว้ให้ snapshot คืนวัตถุเดิมถ้าไม่มีอะไรเปลี่ยน */
let merged: string[] = EMPTY;
let fromLocal: string[] | null = null;
let fromRemote: string[] | null = null;

function snapshot(): string[] {
  const local = store.get();
  if (!live) return local;
  load();
  const got = remote ?? EMPTY;
  if (fromLocal !== local || fromRemote !== got) {
    fromLocal = local;
    fromRemote = got;
    merged = got.length ? [...new Set([...got, ...local])] : local;
  }
  return merged;
}

function subscribe(onChange: () => void) {
  watchers.add(onChange);
  const off = store.subscribe(onChange);
  return () => {
    watchers.delete(onChange);
    off();
  };
}

export function useReadNotices() {
  return useSyncExternalStore(subscribe, snapshot, store.getServer);
}

export function markRead(id: string) {
  store.update((ids) => (ids.includes(id) ? ids : [...ids, id]));
  if (live) void markReadRemote([id]);
}

export function markAllRead(ids: string[]) {
  store.update((current) => [...new Set([...current, ...ids])]);
  if (live) void markReadRemote(ids);
}
