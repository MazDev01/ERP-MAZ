"use client";

/*
 * สโตร์ของงานโฆษณา — แผนสื่อ ใบสั่งรัน และผลที่กรอก
 *
 * แยกจาก pm-store เพราะไม่ได้ส่งงานต่อกัน งานโฆษณาอ้างถึงโปรเจคด้วยเลขที่ดีลเท่านั้น
 * ผลโฆษณากรอกด้วยมือทั้งหมด ยังไม่ได้ต่อ API ของแพลตฟอร์ม
 */

import { useSyncExternalStore } from "react";
import {
  AD_CONTENTS,
  AD_RUNS,
  type AdContent,
  type AdMetric,
  type AdRun,
} from "./ads-data";
import { bkkStamp } from "./format";
import { createPersistedStore } from "./persisted-store";

export type AdsState = {
  runs: AdRun[];
  contents: AdContent[];
};

const INITIAL: AdsState = { runs: AD_RUNS, contents: AD_CONTENTS };

function isAdsState(value: unknown): value is AdsState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return Array.isArray(s.runs) && Array.isArray(s.contents);
}

const store = createPersistedStore<AdsState>("maz-erp.ads.v2", INITIAL, isAdsState);

export function useAds() {
  return useSyncExternalStore(store.subscribe, store.get, store.getServer);
}

export function resetAds() {
  store.reset();
}

/**
 * บันทึกผลของชิ้นงานหนึ่งชิ้น
 *
 * ระบุชิ้นงานด้วย ดีล + รอบเดือน + ชื่อชิ้นงาน เพราะชิ้นงานไม่มีรหัสของตัวเอง
 * ชื่อซ้ำในรอบเดียวกันไม่ควรมี ถ้ามีถือว่าเป็นชิ้นเดียวกัน
 */
export function saveMetric(deal: string, round: string, name: string, m: AdMetric, by: string) {
  /* ตัวเลขผลโฆษณาคีย์มือ — บันทึกผู้กรอกและเวลาทุกครั้ง (PM-BR-10) */
  const at = bkkStamp();
  store.update((s) => ({
    ...s,
    contents: s.contents.map((c) =>
      c.deal === deal && c.round === round && c.name === name ? { ...c, m, by, at } : c,
    ),
  }));
}

/**
 * เพิ่มใบสั่งรันโฆษณาใบใหม่
 *
 * สั่งแล้วสถานะเริ่มที่ "ยังไม่รัน" เสมอ ต้องกลับมากดยืนยันเมื่อรันจริง
 * เพราะวันที่สั่งกับวันที่เงินออกจริงไม่ใช่วันเดียวกัน
 */
export function addRun(run: Omit<AdRun, "ran">) {
  store.update((s) => ({ ...s, runs: [...s.runs, { ...run, ran: false }] }));
}

/** ยืนยันว่าใบสั่งรันใบนี้รันจริงแล้ว — ระบุด้วย ดีล + รอบ + ช่องทาง + เครื่องมือ */
export function markRun(deal: string, round: string, channel: string, tool: string, by: string) {
  /* บันทึกผู้ยืนยันและเวลา — ตรวจย้อนได้ว่าใครยืนยันว่าเงินลูกค้าออกไปแล้ว */
  const at = bkkStamp();
  store.update((s) => ({
    ...s,
    runs: s.runs.map((r) =>
      r.deal === deal && r.round === round && r.channel === channel && r.tool === tool
        ? { ...r, ran: true, ranBy: by, ranAt: at }
        : r,
    ),
  }));
}
