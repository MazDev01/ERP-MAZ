"use client";

import { useSyncExternalStore } from "react";
import { fetchAnnounces, type Announce } from "./supabase/announce";
import { hasBackend } from "./supabase/env";

/*
 * ประกาศที่คนที่ล็อกอินอยู่เห็นได้ — อ่านครั้งเดียวต่อการเปิดแอป
 * ไม่มีฐานข้อมูล (โหมดเดโม) ก็เป็นรายการเปล่า ไม่ใช่ข้อมูลจำลอง
 * เพราะประกาศปลอมบนหน้าจอจริงอันตรายกว่าหน้าจอว่าง
 */

const EMPTY: Announce[] = [];

let rows: Announce[] | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!hasBackend || loading || rows !== null) return;
  loading = true;
  void fetchAnnounces()
    .then((list) => {
      rows = list;
    })
    .catch(() => {
      rows = EMPTY;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/** สั่งอ่านใหม่ — เรียกหลังฝ่ายบุคคลโพสต์หรือลบประกาศ */
export function refreshAnnounces() {
  rows = null;
  load();
}

function snapshot(): Announce[] {
  load();
  return rows ?? EMPTY;
}

function subscribe(onChange: () => void) {
  watchers.add(onChange);
  return () => {
    watchers.delete(onChange);
  };
}

export function useAnnounces(): Announce[] {
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}
