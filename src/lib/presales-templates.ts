"use client";

/*
 * คลังเทมเพลตของทีมก่อนการขาย (บทบาท ps) — หน้า /presales-templates
 *
 * เก็บเทมเพลตข้อเสนอที่ใช้ซ้ำบ่อย แยกตามประเภทบริการชุดเดียวกับใบเสนอราคา (services() ใน pm-data)
 * ชนิดของเทมเพลตมีสี่แบบ — ไฟล์ PowerPoint · ไฟล์ PDF · ลิงก์ Canva · ลิงก์อื่น ๆ (เจ้าของสั่ง 6 ต.ค. 2569)
 * ไฟล์ที่อัปโหลดเองเก็บตัวไฟล์ไว้ในเครื่อง (file-store.ts) จึงเปิดกลับมาดูได้
 * ส่วนเทมเพลตชุดตั้งต้นมีแค่ชื่อไฟล์ เพราะยังไม่มีที่เก็บไฟล์ของระบบ
 * เลือกเทมเพลตไปแนบในหน้าส่งงาน (presales-work) แล้วนับจำนวนครั้งที่ใช้ให้
 *
 * ต่อฐานข้อมูลแล้ว (รอบที่ 109) — คลังเป็นของทีม ไม่ใช่ของเครื่องใครเครื่องมัน
 * จำนวนครั้งที่ใช้ให้ฐานข้อมูลบวกเอง สองคนส่งงานพร้อมกันจะได้ไม่ทับกัน
 * ยังไม่ได้ต่อฐานข้อมูล (dev ที่ไม่มีคีย์) ถอยไปใช้ชุดตั้งต้นในเบราว์เซอร์เหมือนเดิม
 */

import { useSyncExternalStore } from "react";
import { todayIso } from "./format";
import { createPersistedStore } from "./persisted-store";
import { hasBackend } from "./supabase/env";
import {
  fetchTemplates,
  sbAddTemplate,
  sbCountTemplateUse,
  sbPutTemplateFile,
  sbRetireTemplate,
  sbUpdateTemplate,
} from "./supabase/presales";

export type TemplateKind = "ppt" | "pdf" | "canva" | "link";

export type PresalesTemplate = {
  id: string;
  name: string;
  /** รหัสประเภทบริการ — ServiceKey ของ pm-data */
  service: string;
  kind: TemplateKind;
  /** ชื่อไฟล์ (ชนิด ppt/pdf) หรือที่อยู่ลิงก์ (canva/link) */
  file: string;
  url?: string;
  /** ขนาดไฟล์เป็นไบต์ — ลิงก์ไม่มี */
  size?: number;
  /** รหัสไฟล์จริงที่เก็บไว้ในเครื่อง (file-store.ts) — เทมเพลตชุดตั้งต้นยังไม่มีไฟล์จริง */
  fileId?: string;
  /*
   * ที่อยู่ไฟล์ในถังของระบบ (รอบที่ 158)
   * คลังเป็นของทีม ไฟล์จึงต้องอยู่ที่ระบบ ไม่ใช่ในเครื่องคนที่อัป
   * เทมเพลตที่เพิ่มก่อนรอบนี้ไม่มีช่องนี้ — เปิดได้แค่เครื่องที่อัปเหมือนเดิม
   */
  path?: string;
  note: string;
  uploadedBy: string;
  /** วันที่แก้ล่าสุด YYYY-MM-DD */
  updatedAt: string;
  /** แนบไปกับข้อเสนอแล้วกี่ครั้ง */
  uses: number;
  /*
   * เลิกใช้แล้ว — ไม่ขึ้นให้เลือกตอนส่งข้อเสนอ แต่ยังอยู่ในคลัง (เจ้าของสั่ง 6 ต.ค. 2569)
   * เลิกใช้แทนการลบ เพราะข้อเสนอเก่าที่อ้างเทมเพลตนี้ต้องตามย้อนได้ว่าใช้ฉบับไหน
   */
  off?: boolean;
};

const SEED: PresalesTemplate[] = [
  {
    id: "tpl-01",
    name: "โครงข้อเสนอแผนธุรกิจ SME ฉบับมาตรฐาน",
    service: "bplan",
    kind: "pdf",
    file: "BusinessPlan_Proposal_SME_v3.pdf",
    size: 2_480_000,
    note: "มีหน้าวิเคราะห์ตลาดและประมาณการรายได้ 3 ปี แก้ตัวเลขตามลูกค้าได้เลย",
    uploadedBy: "ปิยะวัฒน์ (SA)",
    updatedAt: "2026-09-12",
    uses: 14,
  },
  {
    id: "tpl-02",
    name: "Brand Identity Deck — ร้านอาหารและคาเฟ่",
    service: "branding",
    kind: "canva",
    file: "https://www.canva.com/design/DAF-brand-cafe/view",
    url: "https://www.canva.com/design/DAF-brand-cafe/view",
    note: "ใช้กับลูกค้าสายอาหาร มีหน้าตัวอย่างโลโก้ สี และมู้ดบอร์ด",
    uploadedBy: "ปิยะวัฒน์ (SA)",
    updatedAt: "2026-09-18",
    uses: 9,
  },
  {
    id: "tpl-03",
    name: "ข้อเสนอ SEO รายเดือน 6 เดือน",
    service: "seo",
    kind: "pdf",
    file: "SEO_6Months_Proposal.pdf",
    size: 1_320_000,
    note: "แพ็กเกจ 3 ระดับ ระบุจำนวนคีย์เวิร์ดและบทความต่อเดือน",
    uploadedBy: "ธนดล (BD)",
    updatedAt: "2026-08-29",
    uses: 6,
  },
  {
    id: "tpl-04",
    name: "แผนขยายแฟรนไชส์ ระยะที่ 1",
    service: "franchise",
    kind: "canva",
    file: "https://www.canva.com/design/DAF-franchise-p1/view",
    url: "https://www.canva.com/design/DAF-franchise-p1/view",
    note: "มีหน้าคู่มือแฟรนไชส์และโครงสร้างค่าธรรมเนียม",
    uploadedBy: "ปิยะวัฒน์ (SA)",
    updatedAt: "2026-09-05",
    uses: 3,
  },
  {
    id: "tpl-05",
    name: "Digital Marketing Plan — Facebook และ TikTok Ads",
    service: "dm",
    kind: "link",
    file: "https://docs.google.com/presentation/d/dm-ads-plan",
    url: "https://docs.google.com/presentation/d/dm-ads-plan",
    note: "Google Slides แก้ร่วมกันได้ ตารางงบโฆษณาอยู่หน้าท้าย",
    uploadedBy: "ธนดล (BD)",
    updatedAt: "2026-09-20",
    uses: 11,
  },
  {
    id: "tpl-06",
    name: "ข้อเสนอเว็บไซต์องค์กร พร้อมผังหน้าเว็บ",
    service: "website",
    kind: "pdf",
    file: "Website_Corporate_Sitemap.pdf",
    size: 3_150_000,
    note: "ผังหน้าเว็บ 8 หน้า และระยะเวลาทำงาน 45 วัน",
    uploadedBy: "ปิยะวัฒน์ (SA)",
    updatedAt: "2026-09-01",
    uses: 5,
  },
];

function isTemplates(v: unknown): v is PresalesTemplate[] {
  return Array.isArray(v) && v.every((t) => typeof t === "object" && t !== null && typeof t.id === "string");
}

const store = createPersistedStore<PresalesTemplate[]>("maz-erp.presales-templates.v1", SEED, isTemplates);

/* ─── ชั้นต่อฐานข้อมูล ───────────────────────────────────────────── */
const live = hasBackend;
let fromDb: PresalesTemplate[] | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function load() {
  if (!live || loading || fromDb !== null) return;
  loading = true;
  void fetchTemplates()
    .then((got) => {
      fromDb = got;
    })
    .catch(() => {
      fromDb = [];
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

/** รอให้ฐานข้อมูลตอบแล้วอ่านคลังใหม่ — หน้าจอไม่รอผลลัพธ์ */
function after(job: Promise<unknown>) {
  void job.then(refresh, refresh);
}

const EMPTY: PresalesTemplate[] = [];

function snapshot(): PresalesTemplate[] {
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

export function useTemplates() {
  return useSyncExternalStore(subscribeAll, snapshot, store.getServer);
}

export function resetTemplates() {
  if (live) {
    refresh();
    return;
  }
  store.reset();
}

/** ชนิดจากนามสกุลไฟล์ — PowerPoint หรือ PDF */
export function fileKindOf(name: string): TemplateKind {
  return /\.pptx?$/i.test(name) ? "ppt" : "pdf";
}

/** ลิงก์ Canva ขึ้นป้าย Canva · ลิงก์อื่นขึ้นป้ายลิงก์ */
export function linkKind(url: string): TemplateKind {
  return /canva\.(com|link)/i.test(url) ? "canva" : "link";
}

export type TemplateInput = Pick<PresalesTemplate, "name" | "service" | "kind" | "file" | "url" | "size" | "note">;

/**
 * เพิ่มเทมเพลต — ไฟล์ที่เลือกจากเครื่องถูกส่งขึ้นถังของระบบต่อให้ (รอบที่ 158)
 * ส่งไฟล์ไม่สำเร็จไม่ล้มทั้งใบ แถวยังถูกบันทึก แต่เพื่อนร่วมทีมจะเปิดไฟล์ไม่ได้
 * คืนข้อความบอกเหตุให้หน้าจอแสดง — null คือเรียบร้อย
 */
export async function addTemplate(input: TemplateInput, by: string, file?: File): Promise<string | null> {
  if (live) {
    const id = await sbAddTemplate(input, by);
    refresh();
    if (!id) return "บันทึกเทมเพลตไม่สำเร็จ ลองใหม่อีกครั้ง";
    if (file) {
      const put = await sbPutTemplateFile(id, file);
      refresh();
      if (!put) return "บันทึกชื่อเทมเพลตแล้ว แต่ส่งไฟล์ขึ้นระบบไม่สำเร็จ — เพื่อนร่วมทีมจะยังเปิดไฟล์นี้ไม่ได้";
    }
    return null;
  }
  const t: PresalesTemplate = {
    ...input,
    id: `tpl-${Date.now().toString(36)}`,
    uploadedBy: by,
    updatedAt: todayIso(),
    uses: 0,
  };
  store.update((list) => [t, ...list]);
  return null;
}

export async function updateTemplate(id: string, input: TemplateInput, file?: File): Promise<string | null> {
  if (live) {
    await sbUpdateTemplate(id, input);
    /* เปลี่ยนไฟล์แนบด้วย — ไฟล์ใหม่ขึ้นถังแล้วผูกที่อยู่ใหม่กับแถวเดิม (รอบที่ 158) */
    if (file) {
      const put = await sbPutTemplateFile(id, file);
      refresh();
      if (!put) return "แก้ข้อมูลแล้ว แต่ส่งไฟล์ใหม่ขึ้นระบบไม่สำเร็จ — ไฟล์ที่เพื่อนร่วมทีมเปิดจะยังเป็นไฟล์เดิม";
    }
    refresh();
    return null;
  }
  store.update((list) => list.map((t) => (t.id === id ? { ...t, ...input, updatedAt: todayIso() } : t)));
  return null;
}

/** ลบเทมเพลตได้เฉพาะตอนยังไม่ต่อฐานข้อมูล — ของจริงใช้เลิกใช้แทน ข้อเสนอเก่าจะได้ตามย้อนได้ */
export function removeTemplate(id: string) {
  if (live) return;
  store.update((list) => list.filter((t) => t.id !== id));
}

/** เลิกใช้หรือกลับมาใช้อีกครั้ง — ไม่ลบทิ้ง ข้อเสนอเก่าจึงยังอ้างฉบับที่ใช้จริงได้ */
export function toggleTemplateOff(id: string) {
  if (live) {
    const now = snapshot().find((t) => t.id === id);
    after(sbRetireTemplate(id, !now?.off));
    return;
  }
  store.update((list) => list.map((t) => (t.id === id ? { ...t, off: !t.off, updatedAt: todayIso() } : t)));
}

/** นับว่าเทมเพลตถูกแนบไปกับข้อเสนอ — เรียกตอนส่งงานจริง */
export function countTemplateUse(ids: string[]) {
  if (!ids.length) return;
  if (live) {
    after(sbCountTemplateUse(ids));
    return;
  }
  store.update((list) => list.map((t) => (ids.includes(t.id) ? { ...t, uses: t.uses + ids.filter((x) => x === t.id).length } : t)));
}
