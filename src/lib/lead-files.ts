"use client";

/*
 * ไฟล์ Proposal และเอกสารของผู้สนใจแต่ละราย (ผู้ใช้สั่ง 14 ต.ค. 2569)
 *
 * ฝ่ายขายทำ Proposal เอง แล้วแนบไว้ที่หน้าผู้สนใจ /leads/[code]
 * แยกสโตร์ของตัวเอง ไม่แตะสโตร์ CRM — จับคู่กับผู้สนใจด้วยรหัสผู้สนใจ (lead)
 * ต่อฐานข้อมูลแล้ว (รอบที่ 115) — ไฟล์จริงขึ้นถัง docs ทีมเปิดดูได้จากทุกเครื่อง
 * ลิงก์ (Google Drive, Canva) เก็บแค่ที่อยู่ ไม่ต้องอัปโหลด
 * ยังไม่ได้ต่อฐานข้อมูล (dev ที่ไม่มีคีย์) ถอยไปเก็บชื่อไว้ในเบราว์เซอร์เหมือนเดิม
 */

import { useSyncExternalStore } from "react";
import { bkkStamp } from "./format";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import { fetchLeadFiles, sbAddLeadFiles, sbRemoveLeadFile } from "./supabase/lead-files";

export type LeadFile = {
  id: string;
  /** รหัสผู้สนใจที่ไฟล์นี้อยู่ */
  lead: string;
  name: string;
  /** ไบต์ — ลิงก์เป็น 0 */
  size: number;
  url?: string;
  /** ชื่อคนแนบ — คนแนบเท่านั้นที่ลบได้ */
  by: string;
  /** "yyyy-mm-dd HH:mm" เวลาไทย */
  at: string;
  /** ที่อยู่ไฟล์ในถังของระบบ — ลิงก์และไฟล์ที่เก็บแค่ชื่อไม่มีค่านี้ */
  path?: string;
};

function isFiles(v: unknown): v is LeadFile[] {
  return (
    Array.isArray(v) &&
    v.every((f) => typeof f === "object" && f !== null && typeof f.id === "string" && typeof f.lead === "string")
  );
}

const EMPTY: LeadFile[] = [];
const store = createPersistedStore<LeadFile[]>("maz-erp.lead-files.v1", EMPTY, isFiles);

/* ─── ชั้นต่อฐานข้อมูล ───────────────────────────────────────────── */
const live = hasBackend;
let fromDb: LeadFile[] | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || fromDb !== null) return;
  loading = true;
  void fetchLeadFiles()
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

function refresh() {
  if (!live) return;
  fromDb = null;
  loading = false;
  load();
  tell();
}

function snapshot(): LeadFile[] {
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

export function useLeadFiles() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

export function addLeadFiles(
  lead: string,
  files: { name: string; size: number; url?: string; file?: File }[],
  by: string,
) {
  if (!files.length) return;
  if (live) {
    void sbAddLeadFiles(lead, files, by).then(refresh, refresh);
    return;
  }
  const at = bkkStamp();
  const stamp = Date.now().toString(36);
  const added: LeadFile[] = files.map((f, i) => ({
    id: `lf-${stamp}-${i}`,
    lead,
    name: f.name,
    size: f.size,
    url: f.url,
    by,
    at,
  }));
  store.update((list) => [...added, ...list]);
}

export function removeLeadFile(id: string) {
  if (live) {
    const path = snapshot().find((f) => f.id === id)?.path;
    void sbRemoveLeadFile(id, path).then(refresh, refresh);
    return;
  }
  store.update((list) => list.filter((f) => f.id !== id));
}
