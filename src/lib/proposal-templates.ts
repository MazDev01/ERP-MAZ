"use client";

/*
 * แม่แบบ Proposal ของผู้บริหาร (ยกมาจาก ERP_Test · รอบที่ 134)
 *
 * กรอบ Proposal หลักของบริษัท — ผู้บริหารหรือผู้ดูแลระบบอัปโหลดไว้ที่หน้าตั้งค่า
 * ฝ่ายขายกับทีมก่อนการขายเปิดหรือดาวน์โหลดจากการ์ดในหน้าผู้สนใจ
 *
 * ต่างจาก "คลังเทมเพลต" ของทีมก่อนการขาย (presales-templates) ซึ่งเป็นไฟล์งาน
 * ที่เลือกไปแนบตอนส่งข้อเสนอรายใบ · ของชุดนี้เป็นโครงกลางของบริษัท
 *
 * ของเดิมใน ERP_Test เก็บใน localStorage — ที่นี่ต่อฐานข้อมูลจริงและอัปไฟล์ขึ้นถัง
 */

import { useSyncExternalStore } from "react";
import { hasBackend } from "./supabase/env";
import {
  fetchProposalTemplates,
  sbAddProposalTemplate,
  sbRemoveProposalTemplate,
  sbUploadProposalFile,
  type ProposalTemplate,
} from "./supabase/proposal-templates";

export type { ProposalTemplate };

const EMPTY: ProposalTemplate[] = [];
let cache: ProposalTemplate[] = EMPTY;
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
  void fetchProposalTemplates()
    .then((rows) => {
      cache = rows;
      loaded = true;
    })
    .finally(() => {
      loading = false;
      bump();
    });
}

export function refreshProposalTemplates() {
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

/** แม่แบบที่ยังเปิดใช้งาน เรียงใหม่สุดก่อน */
export function useProposalTemplates() {
  void useSyncExternalStore(subscribe, () => version, () => 0);
  return useSyncExternalStore(subscribe, snapshot, () => EMPTY);
}

export type TplResult = { ok: true } | { ok: false; message: string };

/**
 * เพิ่มแม่แบบ — แนบไฟล์จริง หรือใส่ลิงก์ก็ได้
 * ไฟล์ขึ้นถังของระบบใต้โฟลเดอร์ proposal ฝ่ายขายจึงเปิดได้จากทุกเครื่อง
 */
export async function addProposalTemplate(input: {
  name: string;
  note: string;
  url?: string;
  file?: File;
  by: string;
}): Promise<TplResult> {
  if (!input.name.trim()) return { ok: false, message: "ใส่ชื่อแม่แบบก่อน" };
  if (!hasBackend) return { ok: false, message: "ยังไม่ได้ต่อฐานข้อมูล" };

  let path: string | undefined;
  if (input.file) {
    const up = await sbUploadProposalFile(input.file);
    if (!up.ok) return { ok: false, message: up.message };
    path = up.path;
  }
  const res = await sbAddProposalTemplate({
    name: input.name.trim(),
    note: input.note.trim(),
    file: input.file?.name ?? input.url?.trim() ?? "",
    size: input.file?.size ?? 0,
    url: input.url?.trim() ?? "",
    path,
    by: input.by,
  });
  if (res.ok) refreshProposalTemplates();
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}

export async function removeProposalTemplate(id: string): Promise<TplResult> {
  if (!hasBackend) return { ok: false, message: "ยังไม่ได้ต่อฐานข้อมูล" };
  const res = await sbRemoveProposalTemplate(id);
  if (res.ok) refreshProposalTemplates();
  return res.ok ? { ok: true } : { ok: false, message: res.message };
}
