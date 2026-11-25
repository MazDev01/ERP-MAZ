"use client";

/*
 * สโตร์ของงานโฆษณา — แผนสื่อ ใบสั่งรัน และผลที่กรอก
 *
 * แยกจาก pm-store เพราะไม่ได้ส่งงานต่อกัน งานโฆษณาอ้างถึงโปรเจคด้วยเลขที่โปรเจค (PJ-) — เดิมเลขที่ดีล (เปลี่ยน 5 ต.ค. 2569)
 * ผลโฆษณากรอกด้วยมือทั้งหมด ยังไม่ได้ต่อ API ของแพลตฟอร์ม
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 114) — ใบสั่งรันคือ "ให้เอาเงินลูกค้าไปยิงโฆษณา"
 * และผลคือตัวเลขที่ใช้รายงานลูกค้า อยู่ในเครื่องใครเครื่องมันไม่ได้
 * แผนสื่อ (AD_PLANS) ยังเป็นข้อมูลตั้งต้นในโค้ด หน้าจอแก้ไม่ได้ จึงยังไม่มีตาราง
 * ยังไม่ได้ต่อฐานข้อมูล (dev ที่ไม่มีคีย์) ถอยไปใช้ของในเบราว์เซอร์เหมือนเดิม
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
import { legacyPj } from "./pm-data";
import { hasBackend } from "./supabase/env";
import { fetchAds, sbAddContent, sbAddRun, sbMarkRun, sbSaveMetric } from "./supabase/ads";

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

/* ข้อมูลรุ่นก่อน 5 ต.ค. 2569 เก็บเลขที่ดีลในช่อง deal — ย้ายไปช่อง pj (เลขดีลของชุดตั้งต้นแปลงเป็นเลข PJ) */
function migrateAds(v: AdsState): AdsState {
  const fix = <T extends { pj: string }>(x: T): T => {
    if (x.pj) return x;
    const { deal, ...rest } = x as T & { deal?: string };
    return { ...(rest as T), pj: legacyPj(deal) };
  };
  if (![...v.runs, ...v.contents].some((x) => !x.pj)) return v;
  return { runs: v.runs.map(fix), contents: v.contents.map(fix) };
}

const store = createPersistedStore<AdsState>("maz-erp.ads.v2", INITIAL, isAdsState, migrateAds);

/* ─── ชั้นต่อฐานข้อมูล ───────────────────────────────────────────── */
const live = hasBackend;
const EMPTY: AdsState = { runs: [], contents: [] };
let fromDb: AdsState | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || fromDb !== null) return;
  loading = true;
  void fetchAds()
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

/** หน้าจอไม่รอผลลัพธ์ — เขียนแล้วค่อยอ่านใหม่เมื่อฐานข้อมูลตอบ */
function after(job: Promise<unknown>) {
  void job.then(refresh, refresh);
}

function snapshot(): AdsState {
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

export function useAds() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

export function resetAds() {
  if (live) {
    refresh();
    return;
  }
  store.reset();
}

/**
 * บันทึกผลของชิ้นงานหนึ่งชิ้น
 *
 * ระบุชิ้นงานด้วย โปรเจค + รอบเดือน + ชื่อชิ้นงาน เพราะชิ้นงานไม่มีรหัสของตัวเอง
 * ชื่อซ้ำในรอบเดียวกันไม่ควรมี ถ้ามีถือว่าเป็นชิ้นเดียวกัน
 */
export function saveMetric(pj: string, round: string, name: string, m: AdMetric, by: string) {
  /* ตัวเลขผลโฆษณาคีย์มือ — บันทึกผู้กรอกและเวลาทุกครั้ง (PM-BR-10) */
  const at = bkkStamp();
  if (live) {
    const kind = snapshot().contents.find((c) => c.pj === pj && c.round === round && c.name === name)?.type;
    after(sbSaveMetric(pj, round, name, m, by, kind));
    return;
  }
  store.update((s) => ({
    ...s,
    contents: s.contents.map((c) =>
      c.pj === pj && c.round === round && c.name === name ? { ...c, m, by, at } : c,
    ),
  }));
}

/**
 * เพิ่มชิ้นงานของรอบนั้นเอง (ผลยังว่าง)
 *
 * ตามแบบที่วางไว้ ชิ้นงานควรขึ้นเองจากเฟสผลิตชิ้นงานของโปรเจค ซึ่งยังไม่ได้เชื่อม
 * ระหว่างนี้ให้ฝ่ายโครงการเพิ่มเองได้ ไม่งั้นแท็บรายงานผลจะว่างตลอดและกรอกผลไม่ได้เลย
 */
export function addContent(pj: string, round: string, name: string, type: AdContent["type"]) {
  const clean = name.trim();
  if (!clean) return;
  if (live) {
    after(sbAddContent(pj, round, clean, type));
    return;
  }
  store.update((s) =>
    s.contents.some((c) => c.pj === pj && c.round === round && c.name === clean)
      ? s
      : { ...s, contents: [...s.contents, { pj, round, name: clean, type, m: null }] },
  );
}

/**
 * เพิ่มใบสั่งรันโฆษณาใบใหม่
 *
 * สั่งแล้วสถานะเริ่มที่ "ยังไม่รัน" เสมอ ต้องกลับมากดยืนยันเมื่อรันจริง
 * เพราะวันที่สั่งกับวันที่เงินออกจริงไม่ใช่วันเดียวกัน
 */
export function addRun(run: Omit<AdRun, "ran">) {
  if (live) {
    after(sbAddRun(run));
    return;
  }
  store.update((s) => ({ ...s, runs: [...s.runs, { ...run, ran: false }] }));
}

/** ยืนยันว่าใบสั่งรันใบนี้รันจริงแล้ว — ระบุด้วย โปรเจค + รอบ + ช่องทาง + เครื่องมือ */
export function markRun(pj: string, round: string, channel: string, tool: string, by: string) {
  /* บันทึกผู้ยืนยันและเวลา — ตรวจย้อนได้ว่าใครยืนยันว่าเงินลูกค้าออกไปแล้ว */
  const at = bkkStamp();
  if (live) {
    after(sbMarkRun(pj, round, channel, tool, by));
    return;
  }
  store.update((s) => ({
    ...s,
    runs: s.runs.map((r) =>
      r.pj === pj && r.round === round && r.channel === channel && r.tool === tool
        ? { ...r, ran: true, ranBy: by, ranAt: at }
        : r,
    ),
  }));
}
