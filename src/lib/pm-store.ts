"use client";

/*
 * งาน PM ทั้งสายอยู่ในสโตร์เดียว เพราะแต่ละขั้นส่งงานต่อกัน:
 * งานเข้าใหม่ → ส่งไปวางแผน → ยืนยันแผน → กลายเป็นโปรเจค
 * ถ้าแยกสโตร์จะเกิดสถานะที่ขัดกันเอง เช่น งานยังอยู่ในกล่องเข้าทั้งที่เปิดโปรเจคแล้ว
 */

import { useSyncExternalStore } from "react";
import { addDays, bkkStamp, daysBetween, nextDocNo, todayIso } from "./format";
import { settings } from "./system-settings";
import { currentRole } from "./role";
import {
  PM_INBOX,
  PM_PROJECTS,
  PM_TEAM,
  fileKind,
  isRef,
  type Activity,
  type ChatMessage,
  type InboxJob,
  type Member,
  type Project,
  type ProjectDoc,
  type ProjectPhase,
  type TaskFile,
  type TeamRole,
  type ProjectTask,
  type Submission,
  type TaskStatus,
} from "./pm-data";
import { createPersistedStore } from "./persisted-store";
import { hrSnapshot, subscribeHr } from "./hr-store";
import type { Employee } from "./hr-data";
import { TEAM_ROLES_BY_POSITION } from "./pm-data";
import { USERS } from "./mock-data";
import { hasBackend } from "./supabase/env";
import {
  EMPTY_PM,
  fetchPm,
  sbAcceptInbox,
  sbAddInbox,
  sbConfirmPlan,
  sbCreateProject,
  sbAddAct,
  sbAddDocs,
  sbClearDraft,
  sbMarkInboxSeen,
  sbPatchProject,
  sbPatchTask,
  sbSetReviewers,
  sbTaskReview,
  sbPostChat,
  sbPostTaskTalk,
  sbRemoveDoc,
  sbSaveDraft,
  sbTransferProject,
  type PmData,
} from "./supabase/pm";

/* ─── ร่างแผนงานที่ยังไม่ยืนยัน ─────────────────────────────────────
 * เฟสและงานย่อยระหว่างวางแผน เก็บรูปเดียวกับกระดานในหน้าจัดคิวงาน
 * อยู่ในสโตร์ ไม่ใช่ state ของหน้า — ปิดหน้าหรือรีโหลดแล้วสิ่งที่กรอกไว้ต้องยังอยู่
 */
export type DraftPhase = {
  name: string;
  role?: TeamRole;
  start: string;
  end: string;
  /** PM สร้างเฟสนี้เอง ไม่ได้มาจากข้อเสนอ */
  own?: boolean;
  baseName?: string;
  baseStart?: string;
  baseEnd?: string;
};

export type DraftTask = {
  /** ดัชนีงานเดิมในโปรเจค — มีเฉพาะตอนแก้แผนของโปรเจคที่เดินงานอยู่ */
  from?: number;
  name: string;
  role?: TeamRole;
  whos: string[];
  start: string;
  due: string;
  /** โจทย์ที่ PM เขียนให้คนทำ */
  brief?: string;
  /** ไฟล์ประกอบโจทย์ที่ PM แนบมา */
  files?: TaskFile[];
};

export type PlanDraft = {
  phases: DraftPhase[];
  plan: DraftTask[][];
  /** แก้ล่าสุดเมื่อไร "YYYY-MM-DD HH:mm" — หน้าจออื่นใช้บอกว่ามีร่างค้างอยู่ */
  at: string;
  by: string;
};

/*
 * ข้อความที่ผูกกับงานย่อยใบเดียว — คนละอันกับแชทโปรเจค
 *
 * แชทโปรเจคอยู่ในหน้าของ PM ซึ่งทีมงาน (บทบาท staff) เปิดไม่ได้ตามกติกาเมนูตามบทบาท
 * PM จึงพิมพ์ทวงงานไปโดยที่ไม่มีใครเห็น แล้วต้องไปตามกันในไลน์อีกที
 * สายนี้ผูกกับ "งานใบนั้น" ผู้รับงานจึงเห็นได้ในหน้างานที่ได้รับของตัวเอง โดยไม่ต้องเปิดหน้าของ PM
 * ทุกข้อความส่งเข้าแชทโปรเจคด้วย (postTaskTalk) PM จึงยังอ่านที่เดียวได้เหมือนเดิม
 */
export type TaskTalk = {
  /** "PM" หรือรหัสพนักงานของผู้รับงาน */
  who: string;
  /** "YYYY-MM-DD HH:mm" */
  at: string;
  tx: string;
  /** ข้อความนี้คือการทวงงาน — ผู้รับงานต้องเห็นเป็นเรื่องที่ต้องตอบ ไม่ใช่ข้อความทั่วไป */
  nudge?: boolean;
};

/** คีย์ของสายข้อความหนึ่งงาน — เลขที่โปรเจคกับชื่องาน (ชื่องานไม่ซ้ำกันในโปรเจคเดียว) · เดิมใช้เลขดีล (เปลี่ยน 5 ต.ค. 2569) */
export function talkKey(pj: string, taskName: string) {
  return `${pj}|${taskName}`;
}

export type PmState = {
  inbox: InboxJob[];
  projects: Project[];
  /** ข้อความของงานย่อยแต่ละใบ — คีย์จาก talkKey() */
  talks: Record<string, TaskTalk[]>;
  /*
   * ทีมที่รับงานได้ — ยังไม่มีหน้าจัดการทีมในระบบ (ไม่มีในเมนูตามต้นแบบ)
   * ตอนนี้แก้ได้ทางเดียวคือแก้ PM_TEAM ในชุดข้อมูลตั้งต้น
   */
  team: Member[];
  /*
   * ร่างแผนที่ยังไม่ยืนยัน แยกตามเลขที่โปรเจค (เดิมเลขที่ดีล — เปลี่ยน 5 ต.ค. 2569) — กติกาเดียวกับใบเสนอราคา
   * บันทึกตั้งแต่ตอนแก้ ไม่มีปุ่มบันทึก · "ยืนยันแผน" เป็นแค่การเปลี่ยนสถานะ
   *
   * TODO: ระบบจริงต้องเก็บร่างไว้ที่เซิร์ฟเวอร์ ไม่ใช่ในเบราว์เซอร์
   * ตอนนี้ยังไม่มี backend ร่างจึงลงมาที่ localStorage เหมือนสโตร์อื่นทั้งระบบ
   * ผลคือเปิดจากอีกเครื่องหรืออีกคนจะไม่เห็นร่างนี้ ซึ่งผิดกติกาของเจ้าของระบบ
   */
  drafts: Record<string, PlanDraft>;
};

const INITIAL: PmState = { inbox: PM_INBOX, projects: PM_PROJECTS, team: PM_TEAM, drafts: {}, talks: {} };

function isPmState(value: unknown): value is PmState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return Array.isArray(s.inbox) && Array.isArray(s.projects) && Array.isArray(s.team);
}

/*
 * เติมของที่เพิ่มเข้าชุดตั้งต้นทีหลังให้ข้อมูลเก่าที่ค้างอยู่ในเครื่องผู้ใช้
 *
 * ไม่เปลี่ยนคีย์ เพราะจะทิ้งงานที่ทีมส่งและผลตรวจที่ PM กดไปแล้วทั้งหมด
 * กติกาคือ "เติมของที่หาย ไม่ทับของที่มี" — สถานะงานที่ผู้ใช้ทำไว้เองต้องอยู่เหมือนเดิม
 */
/*
 * ข้อมูลรุ่นก่อน 5 ต.ค. 2569 ระบุโปรเจคด้วยเลขที่ดีล ยังไม่มีเลขที่โปรเจค (ผู้ใช้สั่ง 5 ต.ค. 2569)
 * รายการที่ตรงกับชุดตั้งต้น (เทียบเลขดีล) ได้เลข PJ กับใบแจ้งหนี้งวดแรกตามชุดตั้งต้น
 * ที่เหลือออกเลข PJ ใหม่ต่อจากเลขสูงสุดที่มี · ใบแจ้งหนี้งวดแรกปล่อยว่างไว้ — หน้าจอหาเองจากเลขดีลผ่าน flow.ts
 * ร่างแผนกับสายข้อความที่เก็บคีย์ด้วยเลขดีล ย้ายไปคีย์ด้วยเลข PJ
 */
function assignPj(v: PmState): PmState {
  const legacy = (x: { pj?: string }) => !x.pj;
  if (!v.inbox.some(legacy) && !v.projects.some(legacy)) return v;
  const seed = new Map([...PM_PROJECTS, ...PM_INBOX].map((x) => [x.deal ?? "", x]));
  const used = [...v.inbox, ...v.projects, ...PM_PROJECTS, ...PM_INBOX].map((x) => x.pj).filter(Boolean);
  const byDeal = new Map<string, string>();
  const fix = <T extends InboxJob | Project>(x: T): T => {
    if (x.pj) return x;
    const dealNo = (x as { deal?: string }).deal ?? "";
    const known = byDeal.get(dealNo) ?? seed.get(dealNo)?.pj;
    const pj = known ?? nextDocNo(settings().docs.project, used);
    if (!known) used.push(pj);
    byDeal.set(dealNo, pj);
    return { ...x, pj, bill: x.bill ?? seed.get(dealNo)?.bill ?? "", deal: dealNo || undefined };
  };
  const inbox = v.inbox.map(fix);
  const projects = v.projects.map(fix);
  const rekey = <T,>(rec: Record<string, T> | undefined, key: (k: string) => string) =>
    Object.fromEntries(Object.entries(rec ?? {}).map(([k, x]) => [key(k), x]));
  const drafts = rekey(v.drafts, (k) => byDeal.get(k) ?? k);
  const talks = rekey(v.talks, (k) => {
    const i = k.indexOf("|");
    const pj = i > 0 ? byDeal.get(k.slice(0, i)) : undefined;
    return pj ? `${pj}${k.slice(i)}` : k;
  });
  return { ...v, inbox, projects, drafts, talks };
}

function migratePm(input: PmState): PmState {
  const v = assignPj(input);
  const seedOf = new Map(PM_PROJECTS.map((p) => [p.pj, p]));

  const projects = v.projects.map((p) => {
    const seed = seedOf.get(p.pj);
    if (!seed) return p;
    const has = new Set(p.tasks.map((t) => t.name));
    return {
      ...p,
      /* ชื่อลูกค้าแก้ในระบบไม่ได้ ถือว่าของชุดตั้งต้นถูกเสมอ */
      cus: seed.cus,
      /* ชื่อโปรเจคเพิ่มเข้าชุดตั้งต้น 21 ก.ย. — เติมเฉพาะที่ยังไม่ได้ตั้ง ชื่อที่ PM แก้เองห้ามทับ */
      name: p.name ?? seed.name,
      tasks: [
        ...p.tasks.map((t) => {
          const st = seed.tasks.find((x) => x.name === t.name);
          if (!st) return t;
          /* เติมเฉพาะช่องที่ยังว่าง สถานะและรอบที่ส่งไปแล้วห้ามแตะ */
          return { ...t, brief: t.brief ?? st.brief, doneAt: t.doneAt ?? st.doneAt };
        }),
        ...seed.tasks.filter((t) => !has.has(t.name)),
      ],
    };
  });

  /* โปรเจคที่เพิ่งเพิ่มเข้าชุดตั้งต้น — ของเก่ายังไม่มี ต้องต่อท้ายให้ */
  const known = new Set(v.projects.map((p) => p.pj));
  const added = PM_PROJECTS.filter((p) => !known.has(p.pj));

  /* ตัวอย่างดีลที่ถูกยกเลิก (ครัวคุณจิ) เพิ่มเข้าชุดตั้งต้น 21 ก.ย. 2569 — เครื่องที่เก็บข้อมูลไว้ก่อนให้เห็นด้วย
     ใช้เฉพาะรายการตั้งต้นที่มีการยกเลิก และของในเครื่องยังเดินอยู่ ไม่ทับของที่ผู้ใช้ยกเลิกเอง */
  const cancelled = [...projects, ...added].map((p) => {
    const seed = seedOf.get(p.pj);
    return seed?.cancelled && p.status === "running" && !p.cancelled
      ? { ...p, status: "cancelled" as const, cancelled: seed.cancelled, updated: seed.updated }
      : p;
  });

  /* ร่างแผนเพิ่มเข้ามา 23 ก.ย. · สายข้อความของงานย่อยเพิ่ม 24 ก.ย. —
     ข้อมูลที่ยังไม่มีช่องพวกนี้ถือว่ายังว่าง เติมให้ ไม่เปลี่ยนคีย์ จะได้ไม่ทิ้งงานที่ทำไว้แล้ว */
  /* ชื่อคนรับงานเพิ่ม 5 ต.ค. 2569 (กระดานรับงาน) — งานตั้งต้นที่รับไปแล้วเติมชื่อจากชุดตั้งต้น
     งานอื่นที่รับไปก่อนมีช่องนี้ปล่อยว่าง หน้าจอขึ้นแค่ "รับแล้ว" */
  const inboxSeed = new Map(PM_INBOX.map((j) => [j.pj, j]));
  const inbox = v.inbox.map((j) => {
    const seed = inboxSeed.get(j.pj);
    return j.stage === "plan" && !j.takenBy && seed?.takenBy
      ? { ...j, takenBy: seed.takenBy, takenAt: j.takenAt ?? seed.takenAt }
      : j;
  });

  /* เอกสารแนบของโปรเจคเพิ่ม 5 ต.ค. 2569 — ข้อมูลเก่าที่ยังไม่มีช่องนี้ถือว่ายังไม่มีเอกสาร (ผู้ใช้สั่ง 5 ต.ค. 2569)
     ชื่อโปรเจคที่เก็บไว้แล้วไม่แตะ แม้จะเป็นรูปแบบเดิม "ลูกค้า – ขอบเขตงาน" */
  return {
    ...v,
    inbox: inbox.map((j) => (j.docs ? j : { ...j, docs: [] })),
    projects: cancelled.map((p) => (p.docs ? p : { ...p, docs: [] })),
    drafts: v.drafts ?? {},
    talks: v.talks ?? {},
  };
}

/* ขึ้นเป็น v4 เพราะรูปข้อมูลเปลี่ยน — งานย่อยมีผู้มอบหมาย/เวลา และสโตร์มีร่างแผน */
const store = createPersistedStore<PmState>("maz-erp.pm.v4", INITIAL, isPmState, migratePm);

/**
 * ยกเลิกงานของดีลที่ถูกยกเลิก — โปรเจคเปลี่ยนเป็น "ยกเลิก" งานหยุด
 * เรียกผ่าน cancelDealFlow เท่านั้น
 *
 * งานที่ PM รับไว้แล้วและกำลังวางแผนอยู่ (stage "plan") ต้องไม่หายเงียบ ๆ
 * (เจ้าของสั่ง 24 ก.ย. 2569 — เดิมโยนทิ้งจาก inbox ทั้งใบ แผนที่ PM ลงแรงทำไว้
 * จึงหายไปโดยไม่มีใครรู้ และคนที่ถูกมอบหมายก็ไม่รู้ว่างานตายแล้ว)
 * ใบแบบนี้จึงกลายเป็นโปรเจคสถานะ "ยกเลิก" ที่เก็บแผนร่างไว้ครบ เปิดดูย้อนหลังได้
 * ร่างยังอยู่ใน drafts ด้วย เผื่อดีลกลับมาใหม่จะได้ไม่ต้องวางแผนใหม่ทั้งชุด
 *
 * งานที่ยังไม่เคยกดรับ (stage "new") เอาออกจากกล่องงานเข้าใหม่ตามเดิม — ยังไม่มีใครลงแรงกับมัน
 */
export function cancelDealWork(deal: string, c: { at: string; by: string; why: string }) {
  store.update((s) => {
    const job = s.inbox.find((j) => j.deal === deal && j.stage === "plan");
    /* ร่างแผนคีย์ด้วยเลขที่โปรเจค — ดีลเป็นแค่ตัวบอกว่าโปรเจคไหนต้องหยุด */
    const draft = job ? s.drafts[job.pj] : undefined;
    const known = s.projects.some((p) => p.deal === deal);
    const day = c.at.slice(0, 10);
    /* แผนร่าง → งานของโปรเจคที่ถูกยกเลิก (สถานะ "ยังไม่เริ่ม" เพราะยังไม่เคยมอบหมายจริง) */
    const tasks: ProjectTask[] =
      draft?.plan.flatMap((col, phase) =>
        col.map<ProjectTask>((t) => ({
          name: t.name,
          phase,
          whos: [...t.whos],
          start: t.start,
          due: t.due,
          status: "todo" as const,
          pct: 0,
          files: (t.files ?? []).map((f) => ({ ...f })),
          brief: t.brief?.trim() || undefined,
        })),
      ) ?? [];
    const kept: Project[] =
      job && !known
        ? [
            {
              pj: job.pj,
              bill: job.bill,
              deal: job.deal,
              service: job.service,
              name: job.name,
              cus: job.cus,
              quo: job.quo,
              net: job.net,
              scope: job.scope,
              pm: USERS.pm.name,
              start: job.projectStart || day,
              due: job.planEnd || day,
              status: "cancelled" as const,
              cancelled: c,
              updated: day,
              tone: "c" as const,
              phases: (draft?.phases ?? job.phases).map((ph) => ({
                name: ph.name,
                role: ph.role ?? "ba",
                start: ph.start,
                end: ph.end,
              })),
              tasks,
              source: job,
              chat: [],
              acts: [
                {
                  kind: "status" as const,
                  who: "PM",
                  at: c.at,
                  tx: `ดีลถูกยกเลิกโดย${c.by} · ${c.why} — แผนที่วางไว้เก็บไว้ดูย้อนหลังได้`,
                },
              ],
            },
          ]
        : [];
    return {
      ...s,
      inbox: s.inbox.filter((j) => j.deal !== deal),
      projects: [
        ...kept,
        ...s.projects.map((p) =>
          p.deal === deal && p.status !== "cancelled"
            ? { ...p, status: "cancelled" as const, cancelled: c, updated: day }
            : p,
        ),
      ],
    };
  });
}

/*
 * ชุดข้อมูลที่หน้าจอกำลังวาดอยู่ — memberOf/memberName อ่านจากตัวนี้ ไม่อ่านสโตร์ตรง ๆ
 * ตอน hydrate usePm ได้ชุดของฝั่งเซิร์ฟเวอร์ ชื่อที่ memberOf คืนจึงตรงกับ HTML ที่ส่งมา
 * พอ hydrate เสร็จ usePm ได้ชุดจริงแล้ววาดใหม่ ชื่อก็ตามมาเอง
 */
let rendering: "server" | "client" = "server";

/* ─── งานฝ่ายโครงการจากฐานข้อมูล (รอบที่ 102–104) ─────────────────
 *
 * ต่อฐานข้อมูลแล้ว งานเข้าใหม่ · โปรเจค · ร่างแผน · ข้อความของงานย่อย อ่านจากฐานข้อมูล
 * ส่วน team ยังมาจากทะเบียนพนักงานเหมือนเดิม (teamFrom) ไม่ได้เก็บแยก
 *
 * ระหว่างยังโหลดไม่เสร็จให้เป็นกองว่างไว้ก่อน ไม่ใช่ข้อมูลตัวอย่างในเครื่อง
 */
const live = hasBackend;
let pmData: PmData | null = null;
let loading = false;
const watchers = new Set<() => void>();

function tell() {
  for (const fn of watchers) fn();
}

function loadPm() {
  if (!live || loading || pmData !== null) return;
  loading = true;
  void fetchPm()
    .then((got) => {
      pmData = got;
    })
    .catch(() => {
      pmData = EMPTY_PM;
    })
    .finally(() => {
      loading = false;
      tell();
    });
}

/** ขอข้อมูลใหม่หลังเขียน */
function refreshPm() {
  if (!live) return;
  pmData = null;
  loading = false;
  loadPm();
  tell();
}

let lastLocal: PmState | null = null;
let lastPm: PmData | null = null;
let lastMerged: PmState | null = null;

function mergedState(): PmState {
  const local = store.get();
  if (!live) return local;
  loadPm();
  if (lastMerged && lastLocal === local && lastPm === pmData) return lastMerged;
  lastLocal = local;
  lastPm = pmData;
  lastMerged = {
    ...local,
    inbox: pmData?.inbox ?? [],
    projects: pmData?.projects ?? [],
    talks: (pmData?.talks ?? {}) as PmState["talks"],
    drafts: (pmData?.drafts ?? {}) as PmState["drafts"],
  };
  return lastMerged;
}

function subscribeAll(onChange: () => void) {
  const off = store.subscribe(onChange);
  watchers.add(onChange);
  return () => {
    off();
    watchers.delete(onChange);
  };
}

/* React เรียก getServer ตอน hydrate และ get หลังจากนั้น — จำไว้ว่ารอบวาดนี้ใช้ชุดไหน */
const readClient = () => {
  rendering = "client";
  return mergedState();
};
const readServer = () => {
  rendering = "server";
  return store.getServer();
};

export function usePm() {
  return useSyncExternalStore(subscribeAll, readClient, readServer);
}

/** ข้อมูลจากฐานข้อมูลมาถึงหรือยัง — หน้าที่ตั้งค่าเริ่มต้นของฟอร์มครั้งเดียวต้องรอตัวนี้ */
export function usePmReady() {
  useSyncExternalStore(subscribeAll, readClient, readServer);
  return !live || pmData !== null;
}

export function resetPm() {
  store.reset();
  refreshPm();
}

/** อ่านค่าปัจจุบันนอกคอมโพเนนต์ — ใช้ตอนส่งงานข้ามฝ่าย (ดู flow.ts) */
export function pmSnapshot() {
  return mergedState();
}

/*
 * ค้นทีมจากรหัสพนักงาน — อ่านจากสโตร์ ไม่ใช่จากชุดข้อมูลตั้งต้น
 * ไม่งั้นชื่อที่ PM เพิ่งแก้จะไม่เปลี่ยนตามในการ์ดงานและหน้าแผนงาน
 */
/*
 * ทีมงาน = ทะเบียนพนักงานชุดเดียวกับฝ่ายบุคคล (ERD HR-BR-19)
 * ชื่อและสถานะอ่านจากทะเบียนเสมอ (แก้ชื่อที่ฝ่ายบุคคลแล้วตามมาเอง) · ทักษะและจำนวนงานเป็นของฝั่ง PM
 * พนักงานใหม่ในตำแหน่งสายผลิตเข้าทีมเอง · คนที่พ้นสภาพยังอยู่ (left) เพื่อแสดงชื่อในงานเก่า
 */
export function teamFrom(stored: Member[], emp: Employee[]): Member[] {
  const byId = new Map(emp.map((e) => [e.id, e]));
  const fromStore = stored.map((m) => {
    const e = byId.get(m.id);
    return e ? { ...m, name: e.name, left: e.status === "left" } : m;
  });
  const have = new Set(stored.map((m) => m.id));
  const joined = emp
    .filter((e) => !have.has(e.id) && e.status === "active" && TEAM_ROLES_BY_POSITION[e.pos])
    .map((e) => ({ id: e.id, name: e.name, roles: TEAM_ROLES_BY_POSITION[e.pos], load: 0 }));
  return [...fromStore, ...joined];
}

/*
 * ซิงก์รายชื่อทีมในสโตร์ของ PM ตามทะเบียนฝ่ายบุคคล — ตอนเปิดแอป และทุกครั้งที่ทะเบียนเปลี่ยน
 * เขียนลงสโตร์ของ PM เลย ทุกหน้าจึงอ่าน pm.team / memberOf ได้ตามปกติ ไม่ต้องอ่านสองสโตร์ตอนวาด
 * (อ่านสองสโตร์ตอนวาดทำให้หน้าที่ hydrate ช้า เช่นใน Suspense ได้ชื่อไม่ตรงกับฝั่งเซิร์ฟเวอร์)
 */
function syncTeamFromHr() {
  const cur = store.get().team;
  const next = teamFrom(cur, hrSnapshot().emp);
  if (JSON.stringify(next) !== JSON.stringify(cur)) store.update((s) => ({ ...s, team: next }));
}

if (typeof window !== "undefined") {
  subscribeHr(syncTeamFromHr);
  queueMicrotask(syncTeamFromHr);
}

/** ทีมงานสำหรับหน้าจอ — ซิงก์จากทะเบียนฝ่ายบุคคลแล้ว */
export function useTeam() {
  return usePm().team;
}

export function memberOf(id: string) {
  return (rendering === "client" ? store.get() : store.getServer()).team.find((m) => m.id === id);
}

export function memberName(id: string) {
  return memberOf(id)?.name ?? id;
}

/**
 * บัญชีรับเงินงวดแรกแล้ว งานจึงเข้ากล่องงานใหม่ของ PM — เกิดโปรเจคพร้อมเลขที่โปรเจคตรงนี้ (ผู้ใช้สั่ง 5 ต.ค. 2569)
 * กันซ้ำด้วยใบแจ้งหนี้งวดแรก (และเลขดีลถ้ามี) เผื่อบัญชีแก้แล้วบันทึกเงินเข้าซ้ำ
 * คืนเลขที่โปรเจค — ของที่มีอยู่แล้วคืนเลขเดิม
 */
export async function addInboxJob(job: Omit<InboxJob, "pj">): Promise<string> {
  const same = (x: InboxJob | Project) =>
    (Boolean(job.bill) && x.bill === job.bill) || (Boolean(job.deal) && x.deal === job.deal);
  if (live) {
    /* กันซ้ำด้วยใบแจ้งหนี้งวดแรก (และเลขดีลถ้ามี) เผื่อบัญชีแก้แล้วบันทึกเงินเข้าซ้ำ */
    const now = mergedState();
    const had0 = now.inbox.find(same) ?? now.projects.find(same);
    if (had0) return had0.pj;
    const got = await sbAddInbox(job);
    refreshPm();
    return got.ok && got.pj ? got.pj : "";
  }
  const cur = store.get();
  const had = cur.inbox.find(same) ?? cur.projects.find(same);
  if (had) return had.pj;
  const pj = nextDocNo(settings().docs.project, [...cur.inbox, ...cur.projects].map((x) => x.pj));
  store.update((s) => ({ ...s, inbox: [{ ...job, pj }, ...s.inbox] }));
  return pj;
}

function today() {
  return todayIso();
}

/** เปิดดูเอกสารของงานแล้ว — จุดแดงหน้าแถวในกล่องงานเข้าใหม่หายไป */
export async function markInboxSeen(pj: string) {
  if (live) {
    await sbMarkInboxSeen(pj);
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (isRef(j, pj) && !j.seen ? { ...j, seen: true } : j)),
  }));
}

/**
 * รับงาน (ตามต้นแบบ pm-inbox.html) — งานออกจากกล่องงานเข้าใหม่ไปรอจัดคิวในหน้าวางแผน
 *
 * ข้อเสนอกำหนดเป็นช่วงสัปดาห์ ไม่ได้ระบุวันเริ่มตายตัว
 * เลือกวันเริ่มแล้วเลื่อนทุกเฟสไปทั้งชุด ระยะของแต่ละเฟสเท่าเดิมตามที่ตกลงกับลูกค้า
 * งานที่ไม่มีข้อเสนอไม่มีเฟส — แค่จำวันเริ่มไว้ แล้ว PM สร้างเฟสเองในหน้าวางแผน
 */
export type AcceptResult = { ok: true } | { ok: false; reason: "taken" | "start"; takenBy: string };

/*
 * กระดานรับงาน (ผู้ใช้สั่ง 5 ต.ค. 2569) — ใครรับก่อนได้งาน จดชื่อคนรับไว้
 * งานที่ไม่อยู่ขั้น "new" แล้วคือมีคนรับไปก่อน (เช่นเปิดแท็บค้างไว้) ปฏิเสธและบอกชื่อคนที่รับไป
 */
export async function acceptInboxJob(pj: string, start: string, name = ""): Promise<AcceptResult> {
  const cur = mergedState().inbox.find((j) => isRef(j, pj));
  if (!cur || cur.stage !== "new") return { ok: false, reason: "taken", takenBy: cur?.takenBy ?? "" };
  if (!start) return { ok: false, reason: "start", takenBy: "" };
  const by = USERS[currentRole()]?.name ?? "";
  const at = today();
  if (live) {
    /* เลื่อนทุกเฟสไปทั้งชุดตามวันเริ่มที่เลือก ระยะของแต่ละเฟสเท่าเดิม */
    const nm = name.trim() || cur.cus;
    const shift = cur.phases.length && cur.planStart ? daysBetween(cur.planStart, start) : 0;
    const patch: Record<string, unknown> = {
      stage: "plan",
      seen: true,
      name: nm,
      taken_by: by,
      taken_at: at,
      project_start: start,
      plan_start: cur.phases.length && cur.planStart ? addDays(cur.planStart, shift) : start,
    };
    if (cur.phases.length && cur.planStart) {
      patch.plan_end = cur.planEnd ? addDays(cur.planEnd, shift) : null;
      patch.phases = cur.phases.map((ph) => ({
        ...ph,
        start: addDays(ph.start, shift),
        end: addDays(ph.end, shift),
      }));
    }
    const got = await sbAcceptInbox(cur.pj, patch);
    refreshPm();
    /* กระดานรับงานกลาง — คนอื่นอาจกดรับไปก่อนระหว่างที่เราเปิดหน้าค้างไว้ */
    if (!got.ok) return { ok: false, reason: "taken", takenBy: cur.takenBy ?? "" };
    return { ok: true };
  }
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => {
      if (!isRef(j, pj) || j.stage !== "new") return j;
      /* ชื่อโปรเจค (PM-BR-03) — ว่างใช้แค่ชื่อลูกค้า PM ค่อยแก้ชื่อหลังเปิดโฟลเดอร์ (ผู้ใช้สั่ง 5 ต.ค. 2569 — เดิม "ลูกค้า – ขอบเขตงาน") */
      const nm = name.trim() || j.cus;
      if (!j.phases.length || !j.planStart) {
        return { ...j, stage: "plan" as const, seen: true, projectStart: start, planStart: start, name: nm, takenBy: by, takenAt: at };
      }
      const d = daysBetween(j.planStart, start);
      return {
        ...j,
        stage: "plan" as const,
        seen: true,
        name: nm,
        takenBy: by,
        takenAt: at,
        projectStart: start,
        planStart: addDays(j.planStart, d),
        planEnd: j.planEnd ? addDays(j.planEnd, d) : j.planEnd,
        phases: j.phases.map((ph) => ({ ...ph, start: addDays(ph.start, d), end: addDays(ph.end, d) })),
      };
    }),
  }));
  return { ok: true };
}

export type PlannedTask = {
  /** ดัชนีงานเดิมในโปรเจค — มีเฉพาะตอนแก้แผนของโปรเจคที่เดินงานอยู่ */
  from?: number;
  name: string;
  phase: number;
  whos: string[];
  start: string;
  due: string;
  /** โจทย์ที่ PM เขียนให้คนทำ — ว่างได้ แต่คนทำจะไม่รู้ว่าต้องทำอะไรนอกจากชื่องาน */
  brief?: string;
  /** ไฟล์ประกอบโจทย์ที่ PM แนบมาให้ */
  files?: TaskFile[];
};

/* ─── ร่างแผนที่ยังไม่ยืนยัน ────────────────────────────────────────
 * กติกาเดียวกับใบเสนอราคา — แก้ปุ๊บบันทึกปั๊บ ไม่มีปุ่มบันทึก
 * "ยืนยันแผน" เปลี่ยนแค่สถานะ (ร่าง → โปรเจค) ไม่ใช่จุดที่เพิ่งเริ่มบันทึก
 */
export async function savePlanDraft(pj: string, draft: Omit<PlanDraft, "at" | "by">, by: string) {
  if (live) {
    /* ร่างอยู่ที่ฐานข้อมูลแล้ว เปิดจากอีกเครื่องหรืออีกคนก็เห็นร่างเดียวกัน */
    await sbSaveDraft(pj, { phases: draft.phases, plan: draft.plan, by });
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    drafts: { ...s.drafts, [pj]: { ...draft, at: bkkStamp(), by } },
  }));
}

/** ทิ้งร่างของดีลนี้ — ยืนยันแผนแล้วร่างหมดหน้าที่ */
export async function clearPlanDraft(pj: string) {
  if (live) {
    await sbClearDraft(pj);
    refreshPm();
    return;
  }
  store.update((s) => {
    if (!s.drafts[pj]) return s;
    const next = { ...s.drafts };
    delete next[pj];
    return { ...s, drafts: next };
  });
}

/*
 * ประทับว่าใครมอบงานใบนี้และเมื่อไร — ผู้รับงานต้องแยกงานใหม่ออกจากงานเก่าได้
 * งานที่ยังไม่มีผู้รับผิดชอบยังไม่ถือว่ามอบหมาย จึงไม่ประทับเวลา
 */
function stampAssign(t: ProjectTask, what: "assign" | "due" | "owner", at: string, by: string): ProjectTask {
  return {
    ...t,
    assignedAt: what === "due" ? t.assignedAt : t.whos.length ? at : undefined,
    lastChange: { at, what, by },
  };
}

/**
 * ยืนยันแผนงาน — งานออกจากกล่องเข้าแล้วเปิดเป็นโปรเจคจริง
 *
 * โทนสีปกวนสามแบบตามจำนวนโปรเจคที่มีอยู่ จะได้ไม่ซ้ำกับใบก่อนหน้าติดกัน
 */
export async function confirmPlan(
  pj: string,
  tasks: PlannedTask[],
  pmName: string,
  /** เฟสหลัง PM แก้หรือเพิ่มเองในหน้าวางแผน */
  phases: ProjectPhase[],
) {
  const at = bkkStamp();
  if (live) {
    const cur = mergedState();
    const job = cur.inbox.find((j) => isRef(j, pj));
    if (!job) return;
    /* งานที่ไม่มีข้อเสนอไม่มีวันจบจากใบเสนอราคา ใช้วันจบของเฟสสุดท้ายที่ PM วางไว้แทน */
    const lastEnd = phases.reduce((m, ph) => (ph.end > m ? ph.end : m), "");
    const tones = ["a", "b", "c"] as const;
    const made: ProjectTask[] = tasks.map((t) =>
      stampAssign(
        {
          name: t.name,
          phase: t.phase,
          whos: [...t.whos],
          start: t.start,
          due: t.due,
          status: "todo",
          pct: 0,
          files: (t.files ?? []).map((f) => ({ ...f })),
          brief: t.brief?.trim() || undefined,
        },
        "assign",
        at,
        pmName,
      ),
    );
    await sbCreateProject({
      project: {
        pj: job.pj,
        bill: job.bill,
        deal: job.deal,
        service: job.service,
        name: job.name,
        cus: job.cus,
        quo: job.quo,
        net: job.net,
        scope: job.scope,
        pm: pmName,
        start: job.projectStart || today(),
        due: job.planEnd || lastEnd,
        status: "running",
        updated: today(),
        tone: tones[cur.projects.length % tones.length],
        phases: phases.map((ph) => ({ ...ph })),
        source: job,
        docs: (job.docs ?? []).map((d) => ({ ...d })),
        tasks: made,
        chat: [],
        acts: [],
      },
      tasks: made,
      /* เวลาที่กดจริงเหมือนกิจกรรมอื่นทุกรายการ ไม่ใช่ 09:00 ตายตัว */
      firstAct: { kind: "status", who: "PM", at, tx: "เปิดโปรเจคและมอบหมายงานให้ทีม" },
    });
    refreshPm();
    return;
  }
  store.update((s) => {
    const job = s.inbox.find((j) => isRef(j, pj));
    if (!job) return s;
    /* งานที่ไม่มีข้อเสนอไม่มีวันจบจากใบเสนอราคา ใช้วันจบของเฟสสุดท้ายที่ PM วางไว้แทน */
    const lastEnd = phases.reduce((m, ph) => (ph.end > m ? ph.end : m), "");
    const tones = ["a", "b", "c"] as const;
    const project: Project = {
      pj: job.pj,
      bill: job.bill,
      deal: job.deal,
      service: job.service,
      name: job.name,
      cus: job.cus,
      quo: job.quo,
      net: job.net,
      scope: job.scope,
      pm: pmName,
      start: job.projectStart || today(),
      due: job.planEnd || lastEnd,
      status: "running",
      updated: today(),
      tone: tones[s.projects.length % tones.length],
      phases: phases.map((ph) => ({ ...ph })),
      source: job,
      /* เอกสารที่แนบไว้ตอนวางแผนติดไปกับโปรเจค ทีมจะได้เห็น (ผู้ใช้สั่ง 5 ต.ค. 2569) */
      docs: (job.docs ?? []).map((d) => ({ ...d })),
      /* ทุกใบเพิ่งถูกมอบหมายรอบแรก จึงประทับเวลาและผู้มอบให้ทั้งชุด */
      tasks: tasks.map<ProjectTask>((t) =>
        stampAssign(
          {
            name: t.name,
            phase: t.phase,
            whos: [...t.whos],
            start: t.start,
            due: t.due,
            status: "todo",
            pct: 0,
            files: (t.files ?? []).map((f) => ({ ...f })),
            brief: t.brief?.trim() || undefined,
          },
          "assign",
          at,
          pmName,
        ),
      ),
      chat: [],
      /* เวลาที่กดจริงเหมือนกิจกรรมอื่นทุกรายการ ไม่ใช่ 09:00 ตายตัว */
      acts: [{ kind: "status", who: "PM", at, tx: "เปิดโปรเจคและมอบหมายงานให้ทีม" }],
    };
    /* ยืนยันแล้วร่างหมดหน้าที่ — แผนจริงอยู่ในโปรเจคแล้ว */
    const drafts = { ...s.drafts };
    delete drafts[pj];
    return {
      ...s,
      inbox: s.inbox.filter((j) => !isRef(j, pj)),
      projects: [project, ...s.projects],
      drafts,
    };
  });
}

export async function createOwnProject(input: {
  name: string;
  cus: string;
  scope: string;
  start: string;
  due: string;
  pm: string;
  phases: { name: string; start: string; end: string }[];
  tasks: { name: string; phase: number; due: string; done: boolean }[];
}) {
  const at = bkkStamp();
  const day = today();
  if (live) {
    /* เลขที่โปรเจคออกจากฐานข้อมูล ไม่ใช่จากเบราว์เซอร์ */
    const cur = mergedState();
    const tones = ["a", "b", "c"] as const;
    const tasks = input.tasks.map<ProjectTask>((t) => ({
      name: t.name,
      phase: t.phase,
      /* ยังไม่ได้มอบหมายให้ใคร — PM มอบหมายทีหลังในหน้าโปรเจค */
      whos: [],
      start: input.start || day,
      due: t.due,
      status: t.done ? "done" : "todo",
      pct: t.done ? 100 : 0,
      files: [],
    }));
    const got = await sbCreateProject({
      project: {
        pj: "",
        /* โปรเจคที่ตั้งเองไม่ได้มาจากวางบิลและไม่มีดีล */
        bill: "",
        /* งานที่ตั้งเองยังไม่รู้ประเภทบริการ ใช้ค่าตั้งต้นให้การ์ดมีไอคอน แล้ว PM แก้ทีหลังได้ */
        service: "website",
        name: input.name,
        cus: input.cus,
        quo: "",
        net: 0,
        scope: input.scope,
        pm: input.pm,
        start: input.start || day,
        due: input.due || input.phases.reduce((m, ph) => (ph.end > m ? ph.end : m), ""),
        status: "running",
        updated: day,
        tone: tones[cur.projects.length % tones.length],
        phases: input.phases.map((ph) => ({ name: ph.name, role: "ba", start: ph.start, end: ph.end })),
        tasks,
        chat: [],
        acts: [],
      },
      tasks,
      firstAct: { kind: "status", who: "PM", at, tx: "เปิดโปรเจคที่ตั้งเอง ยังไม่ได้มอบหมายงาน" },
    });
    refreshPm();
    return got.ok && got.pj ? got.pj : "";
  }
  let created = "";
  store.update((s) => {
    /* เลขที่โปรเจคชุดเดียวกับงานที่มาจากวางบิล (PJ-2569-xxxx) ออกเลขต่อจากที่มีอยู่ */
    const pj = nextDocNo(settings().docs.project, [...s.projects, ...s.inbox].map((x) => x.pj));
    created = pj;
    const tones = ["a", "b", "c"] as const;
    const project: Project = {
      pj,
      /* โปรเจคที่ตั้งเองไม่ได้มาจากวางบิลและไม่มีดีล */
      bill: "",
      /* งานที่ตั้งเองยังไม่รู้ประเภทบริการ ใช้ค่าตั้งต้นให้การ์ดมีไอคอน แล้ว PM แก้ทีหลังได้ */
      service: "website",
      name: input.name,
      cus: input.cus,
      quo: "",
      net: 0,
      scope: input.scope,
      pm: input.pm,
      start: input.start || day,
      due: input.due || input.phases.reduce((m, ph) => (ph.end > m ? ph.end : m), ""),
      status: "running",
      updated: day,
      tone: tones[s.projects.length % tones.length],
      phases: input.phases.map((ph) => ({ name: ph.name, role: "ba" as const, start: ph.start, end: ph.end })),
      tasks: input.tasks.map<ProjectTask>((t) => ({
        name: t.name,
        phase: t.phase,
        /* ยังไม่ได้มอบหมายให้ใคร — PM มอบหมายทีหลังในหน้าโปรเจค */
        whos: [],
        start: input.start || day,
        due: t.due,
        status: t.done ? "done" : "todo",
        pct: t.done ? 100 : 0,
        files: [],
      })),
      chat: [],
      acts: [{ kind: "status", who: "PM", at, tx: "เปิดโปรเจคที่ตั้งเอง ยังไม่ได้มอบหมายงาน" }],
    };
    return { ...s, projects: [project, ...s.projects] };
  });
  return created;
}

/**
 * แก้แผนของโปรเจคที่ยืนยันไปแล้ว (ปุ่ม "วางแผนงาน" ในหน้ารายละเอียดโปรเจค)
 *
 * งานเดิมเก็บสถานะ ความคืบหน้า ไฟล์ และรอบส่งงานไว้ทั้งหมด เปลี่ยนแค่ชื่อ เฟส คน และวัน
 * งานที่เพิ่มใหม่เริ่มที่ "ยังไม่เริ่ม"
 */
export async function replanProject(pj: string, tasks: PlannedTask[], phases: ProjectPhase[]) {
  const at = bkkStamp();
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    if (!p0) return;
    const lastEnd = phases.reduce((m, ph) => (ph.end > m ? ph.end : m), p0.due);
    const made = tasks.map<ProjectTask>((t) => {
      const old = t.from !== undefined ? p0.tasks[t.from] : undefined;
      const base: ProjectTask =
        old ?? { name: t.name, phase: t.phase, whos: [], start: "", due: "", status: "todo", pct: 0, files: [] };
      const next: ProjectTask = {
        ...base,
        name: t.name,
        phase: t.phase,
        whos: [...t.whos],
        start: t.start,
        due: t.due,
        files: t.files ? t.files.map((f) => ({ ...f })) : base.files,
        brief: t.brief?.trim() || undefined,
      };
      /* งานเก่าที่ไม่ได้แตะไม่ต้องประทับใหม่ ไม่งั้นทุกใบจะขึ้นว่า "เพิ่งเปลี่ยน" ทั้งกระดาน */
      if (!old) return stampAssign(next, "assign", at, p0.pm);
      if (old.whos.join(",") !== next.whos.join(",")) return stampAssign(next, "owner", at, p0.pm);
      if (old.due !== next.due) return stampAssign(next, "due", at, p0.pm);
      return next;
    });
    await sbConfirmPlan(p0.pj, phases, made);
    await sbPatchProject(p0.pj, { due: lastEnd, updated: today() });
    /* เวลาที่กดจริง ไม่ใช่ 09:00 ตายตัว — นี่คือหลักฐานว่าใครแก้แผนตอนไหน */
    await sbAddAct(p0.pj, { kind: "status", who: "PM", at, tx: "ปรับแผนงานของโปรเจค" });
    await sbClearDraft(p0.pj);
    refreshPm();
    return;
  }
  store.update((s) => {
    const drafts = { ...s.drafts };
    delete drafts[pj];
    return {
    ...s,
    drafts,
    projects: s.projects.map((p) => {
      if (!isRef(p, pj)) return p;
      const lastEnd = phases.reduce((m, ph) => (ph.end > m ? ph.end : m), p.due);
      return {
        ...p,
        due: lastEnd,
        updated: today(),
        phases: phases.map((ph) => ({ ...ph })),
        tasks: tasks.map<ProjectTask>((t) => {
          const old = t.from !== undefined ? p.tasks[t.from] : undefined;
          const base: ProjectTask = old ?? { name: t.name, phase: t.phase, whos: [], start: "", due: "", status: "todo", pct: 0, files: [] };
          const next: ProjectTask = {
            ...base,
            name: t.name,
            phase: t.phase,
            whos: [...t.whos],
            start: t.start,
            due: t.due,
            files: t.files ? t.files.map((f) => ({ ...f })) : base.files,
            brief: t.brief?.trim() || undefined,
          };
          /*
           * สิ่งที่ผู้รับงานต้องรู้มีสามอย่าง — เพิ่งได้รับงาน · เปลี่ยนคนทำ · เลื่อนกำหนดส่ง
           * งานเก่าที่ไม่ได้แตะไม่ต้องประทับใหม่ ไม่งั้นทุกใบจะขึ้นว่า "เพิ่งเปลี่ยน" ทั้งกระดาน
           */
          if (!old) return stampAssign(next, "assign", at, p.pm);
          if (old.whos.join(",") !== next.whos.join(",")) return stampAssign(next, "owner", at, p.pm);
          if (old.due !== next.due) return stampAssign(next, "due", at, p.pm);
          return next;
        }),
        /* เวลาที่กดจริง ไม่ใช่ 09:00 ตายตัว — นี่คือหลักฐานว่าใครแก้แผนตอนไหน */
        acts: [{ kind: "status" as const, who: "PM", at, tx: "ปรับแผนงานของโปรเจค" }, ...p.acts],
      };
    }),
    };
  });
}

/**
 * แก้ชื่อโปรเจค (PM-BR-03) — PM ตั้งและแก้ได้เอง ส่วนลูกค้า บริการ และขอบเขตมาจากดีล แก้ตรงนี้ไม่ได้
 * งานที่ยังรอวางแผน (อยู่ในกล่องงานเข้า) แก้ที่งานนั้น ชื่อจะติดไปตอนยืนยันแผน
 */
export function renameProject(pj: string, name: string) {
  const v = name.trim();
  if (!v) return;
  if (live) {
    const cur = mergedState();
    /* ยังวางแผนอยู่ ชื่ออยู่ที่ใบงานในกล่องเข้า · เปิดโปรเจคแล้ว ชื่ออยู่ที่โปรเจค */
    const p0 = cur.projects.find((x) => isRef(x, pj));
    const j0 = cur.inbox.find((x) => isRef(x, pj));
    if (p0) void sbPatchProject(p0.pj, { name: v, updated: today() }).then(() => refreshPm());
    else if (j0) void sbAcceptInbox(j0.pj, { name: v }).then(() => refreshPm());
    return;
  }
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (isRef(j, pj) ? { ...j, name: v } : j)),
    projects: s.projects.map((p) => (isRef(p, pj) ? { ...p, name: v, updated: today() } : p)),
  }));
}

/*
 * แนบเอกสารอื่นให้โปรเจค (ผู้ใช้สั่ง 5 ต.ค. 2569) — ปุ่ม "+" ข้างใบเสนอราคา/Proposal
 * งานที่ยังวางแผนอยู่เก็บที่ใบงานในกล่องเข้า (ติดไปตอนยืนยันแผน) · โปรเจคที่เดินแล้วเก็บที่โปรเจค
 * ชื่อซ้ำกับที่มีอยู่ไม่เพิ่มซ้ำ — ลบใช้ชื่อเป็นตัวระบุ
 */
export function addProjectDocs(pj: string, docs: ProjectDoc[]) {
  if (!docs.length) return;
  const at = bkkStamp();
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    /* ยังไม่ได้ยืนยันแผน เอกสารเก็บติดกับงานเข้าใหม่ไปก่อน แล้วค่อยติดไปกับโปรเจคตอนเปิด */
    if (!p0) return;
    const have = new Set((p0.docs ?? []).map((d) => d.n));
    const add = docs.filter((d) => !have.has(d.n));
    if (!add.length) return;
    void sbAddDocs(p0.pj, add)
      .then(() => sbAddAct(p0.pj, { kind: "file", who: "PM", at, tx: `แนบเอกสารโปรเจค ${add.length} ไฟล์` }))
      .then(() => refreshPm());
    return;
  }
  const merge = (cur: ProjectDoc[] | undefined) => {
    const have = new Set((cur ?? []).map((d) => d.n));
    return [...docs.filter((d) => !have.has(d.n)), ...(cur ?? [])];
  };
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (isRef(j, pj) ? { ...j, docs: merge(j.docs) } : j)),
    projects: s.projects.map((p) =>
      isRef(p, pj)
        ? {
            ...p,
            docs: merge(p.docs),
            updated: today(),
            acts: [
              { kind: "file" as const, who: "PM", at, tx: `แนบเอกสารโปรเจค ${docs.length} รายการ` },
              ...p.acts,
            ],
          }
        : p,
    ),
  }));
}

/** เอาเอกสารแนบของโปรเจคออก (PM/GM กดยืนยันก่อน) */
export function removeProjectDoc(pj: string, name: string) {
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    if (!p0) return;
    void sbRemoveDoc(p0.pj, name)
      .then(() => sbPatchProject(p0.pj, { updated: today() }))
      .then(() => refreshPm());
    return;
  }
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (isRef(j, pj) ? { ...j, docs: (j.docs ?? []).filter((d) => d.n !== name) } : j)),
    projects: s.projects.map((p) =>
      isRef(p, pj) ? { ...p, docs: (p.docs ?? []).filter((d) => d.n !== name), updated: today() } : p,
    ),
  }));
}

/*
 * โอนโปรเจคให้เจ้าของคนใหม่ (Proposal · PM — Transfer Project)
 * โปรเจคมีเจ้าของได้คนเดียว โอนแล้วเจ้าของเดิมหมดสิทธิ์ทันที
 * โอนหลังตกลงกันแล้วเท่านั้น จึงบังคับให้ใส่เหตุผล และเก็บไว้เป็นประวัติทุกครั้ง
 * งานย่อยกับคนที่ถูกมอบหมายไม่เปลี่ยน — เปลี่ยนแค่คนที่ดูแลโปรเจค
 */
export function transferProject(pj: string, to: string, why: string, by: string) {
  const name = to.trim();
  const reason = why.trim();
  if (!name || !reason) return false;
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    /* โอนให้คนเดิมไม่ใช่การโอน อย่าลงประวัติหลอก ๆ ไว้ */
    if (!p0 || p0.pm === name) return false;
    const at = bkkStamp();
    void sbTransferProject(p0.pj, { from: p0.pm, to: name, by, why: reason })
      .then(() => sbAddAct(p0.pj, { kind: "status", who: by, at, tx: `โอนโปรเจคให้ ${name}` }))
      .then(() => sbPatchProject(p0.pj, { updated: today() }))
      .then(() => refreshPm());
    return true;
  }
  let done = false;
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (!isRef(p, pj)) return p;
      /* โอนให้คนเดิมไม่ใช่การโอน อย่าลงประวัติหลอก ๆ ไว้ */
      if (p.pm === name) return p;
      done = true;
      const at = bkkStamp();
      return {
        ...p,
        pm: name,
        updated: today(),
        transfers: [...(p.transfers ?? []), { at, from: p.pm, to: name, by, why: reason }],
        acts: [
          { kind: "status" as const, who: by, at, tx: `โอนโปรเจคให้ ${name} · ${reason}` },
          ...p.acts,
        ].slice(0, 40),
      };
    }),
  }));
  return done;
}

/** เลื่อนสถานะงานย่อย — เสร็จแล้วให้ความคืบหน้าเต็ม 100 เสมอ */
export async function setTaskStatus(pj: string, taskIndex: number, status: TaskStatus) {
  if (live) {
    const p0 = mergedState().projects.find((p) => isRef(p, pj));
    const t0 = p0?.tasks[taskIndex];
    if (!p0 || !t0) return;
    const pct = status === "done" ? 100 : status === "todo" ? 0 : t0.pct;
    await sbPatchTask(p0.pj, taskIndex, { status, pct });
    /* ปิดงานเป็นเรื่องที่ PM กดเอง (รอบที่ 132) — ที่นี่แค่ขยับวันที่แก้ล่าสุด */
    await sbPatchProject(p0.pj, { updated: today() });
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (!isRef(p, pj)) return p;
      const tasks = p.tasks.map((t, i) =>
        i === taskIndex
          ? { ...t, status, pct: status === "done" ? 100 : status === "todo" ? 0 : t.pct }
          : t,
      );
      /* ปิดงานเป็นเรื่องที่ PM กดเอง (รอบที่ 132) */
      return { ...p, tasks, updated: today() };
    }),
  }));
}

/**
 * ปรับความคืบหน้าของงานที่กำลังทำอยู่
 *
 * สถานะกับเปอร์เซ็นต์ต้องไม่ขัดกัน — 0 คือยังไม่เริ่ม 100 คือเสร็จ
 * จึงเลื่อนสถานะให้ตามค่าที่กรอกด้วย ไม่ให้เกิดงาน "เสร็จแล้ว 40%"
 */
export async function setTaskProgress(pj: string, taskIndex: number, pct: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  if (live) {
    const p0 = mergedState().projects.find((p) => isRef(p, pj));
    if (!p0 || !p0.tasks[taskIndex]) return;
    const status = clamped >= 100 ? "done" : clamped <= 0 ? "todo" : "doing";
    await sbPatchTask(p0.pj, taskIndex, { pct: clamped, status });
    await sbPatchProject(p0.pj, { updated: today() });
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (!isRef(p, pj)) return p;
      const tasks = p.tasks.map((t, i) =>
        i === taskIndex
          ? {
              ...t,
              pct: clamped,
              status:
                clamped >= 100 ? ("done" as const) : clamped <= 0 ? ("todo" as const) : ("doing" as const),
            }
          : t,
      );
      /* ปิดงานเป็นเรื่องที่ PM กดเอง (รอบที่ 132) */
      return { ...p, tasks, updated: today() };
    }),
  }));
}

/**
 * แนบไฟล์เข้ากับงานย่อย
 *
 * ยังไม่มีที่เก็บไฟล์จริง จึงบันทึกได้แค่รายการว่ามีไฟล์อะไร ใครส่ง ส่งเมื่อไร
 * ตัวไฟล์เปิดได้เฉพาะในรอบที่เพิ่งเลือกเข้ามา (ดู objectURL ในหน้าโปรเจค)
 * เมื่อต่อ backend ให้อัปโหลดขึ้น storage แล้วเก็บ URL แทน
 */
export function attachFile(pj: string, taskIndex: number, file: TaskFile) {
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    const t0 = p0?.tasks[taskIndex];
    if (!p0 || !t0) return;
    void sbPatchTask(p0.pj, taskIndex, { files: [file, ...t0.files] })
      .then(() => sbPatchProject(p0.pj, { updated: today() }))
      .then(() => refreshPm());
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      isRef(p, pj)
        ? {
            ...p,
            tasks: p.tasks.map((t, i) =>
              i === taskIndex ? { ...t, files: [file, ...t.files] } : t,
            ),
            updated: today(),
          }
        : p,
    ),
  }));
}

export function removeFile(pj: string, taskIndex: number, name: string) {
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    const t0 = p0?.tasks[taskIndex];
    if (!p0 || !t0) return;
    void sbPatchTask(p0.pj, taskIndex, { files: t0.files.filter((f) => f.n !== name) }).then(() => refreshPm());
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      isRef(p, pj)
        ? {
            ...p,
            tasks: p.tasks.map((t, i) =>
              i === taskIndex ? { ...t, files: t.files.filter((f) => f.n !== name) } : t,
            ),
          }
        : p,
    ),
  }));
}

// ─── ส่งงานให้ตรวจ และผลตรวจ ─────────────────────────────────────

/** หางานย่อยใบเดียวจากรหัสดีลกับชื่องาน — สองอย่างนี้รวมกันไม่ซ้ำกันในระบบ */
function patchTask(
  s: PmState,
  pj: string,
  taskName: string,
  fn: (t: ProjectTask) => ProjectTask,
  /* ความเคลื่อนไหวที่จะขึ้นในกิจกรรมล่าสุดของโปรเจค — งานขยับแล้วต้องมีร่องรอยเสมอ
     ไม่งั้น PM เปิดหน้าโปรเจคแล้วเห็นสถานะเปลี่ยนโดยไม่รู้ว่าใครทำเมื่อไหร่ */
  act: Activity,
): PmState {
  return {
    ...s,
    projects: s.projects.map((p) => {
      if (!isRef(p, pj)) return p;
      const tasks = p.tasks.map((t) => (t.name === taskName ? fn(t) : t));
      /* ปิดงานเป็นเรื่องที่ PM กดเอง (รอบที่ 132) */
      return { ...p, tasks, acts: [act, ...p.acts], updated: today() };
    }),
  };
}

/**
 * ทีมส่งผลงานให้ PM ตรวจ — ใช้ได้ทั้งรอบแรกและรอบที่ส่งแก้
 *
 * เก็บทุกรอบไว้ต่อกัน ไม่ทับของเดิม เพราะตอน PM ตรวจต้องเทียบได้ว่ารอบก่อนตีกลับเพราะอะไร
 * แล้วรอบนี้แก้ตรงนั้นหรือยัง · ส่งใหม่แล้วเหตุผลที่ตีกลับถือว่าจบไป จึงล้าง back ทิ้ง
 */
export async function submitWork(
  pj: string,
  taskName: string,
  input: { by: string; files: string[]; note: string; at: string },
) {
  const sub: Submission = {
    at: input.at,
    by: input.by,
    files: input.files,
    note: input.note,
  };
  if (live) {
    const p0 = mergedState().projects.find((p) => isRef(p, pj));
    const i = p0?.tasks.findIndex((t) => t.name === taskName) ?? -1;
    if (!p0 || i < 0) return;
    const t0 = p0.tasks[i];
    await sbPatchTask(p0.pj, i, {
      status: "sent",
      subs: [...(t0.subs ?? []), sub],
      back: null,
    });
    await sbAddAct(p0.pj, { kind: "done", who: input.by, at: input.at, tx: `ส่งงาน ${taskName} ให้ตรวจ` });
    refreshPm();
    return;
  }
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => ({
        ...t,
        status: "sent",
        subs: [...(t.subs ?? []), sub],
        back: undefined,
      }),
      /* รอบแรกกับรอบแก้เขียนคนละแบบ PM จะได้รู้ว่าใบนี้เคยตีกลับไปแล้ว */
      {
        kind: "done",
        who: input.by,
        at: input.at,
        tx: `ส่งงาน ${taskName} ให้ตรวจ`,
      },
    ),
  );
}

/** PM ตรวจผ่าน — งานจบที่ 100% ไม่ต้องให้ทีมมากดปิดซ้ำอีกที */
/* ── ผู้ตรวจหลายคน (รอบที่ 130 · คำตอบเจ้าของ 25 พ.ย. 2569) ───────── */

/** ฝ่ายโครงการตั้งผู้ตรวจของใบงาน — ว่าง = ฝ่ายโครงการตรวจคนเดียวเหมือนเดิม */
export async function setTaskReviewers(pj: string, taskName: string, who: string[]) {
  if (live) {
    const hit = await pmTask(pj, taskName);
    if (!hit) return false;
    const res = await sbSetReviewers(hit.pj, hit.i, who);
    refreshPm();
    return res.ok;
  }
  const at0 = bkkStamp();
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => ({ ...t, reviewers: who.length ? who : undefined, reviews: undefined }),
      { kind: "status", who: "PM", at: at0, tx: `ตั้งผู้ตรวจของ ${taskName} ${who.length} คน` },
    ),
  );
  return true;
}

/**
 * ผู้ตรวจกดผลของตัวเอง — ครบทุกคนแล้วฐานข้อมูลปิดงานให้เอง
 * คืนสถานะที่ได้ (done / sent / revise) เพื่อให้หน้าจอบอกผลได้ตรง
 */
export async function reviewTask(pj: string, taskName: string, ok: boolean, note = "") {
  if (live) {
    const hit = await pmTask(pj, taskName);
    if (!hit) return { ok: false as const };
    const res = await sbTaskReview(hit.pj, hit.i, ok, note);
    refreshPm();
    return res.ok ? { ok: true as const, status: res.status, left: res.left } : { ok: false as const };
  }
  /* โหมดไม่มีฐานข้อมูล — นับผลในเครื่องด้วยกติกาเดียวกัน */
  const at = bkkStamp();
  const me = USERS[currentRole()]?.employeeId ?? "me";
  let status = "sent";
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => {
        if (!ok) {
          status = "revise";
          return { ...t, status: "revise", back: { why: note || "ขอแก้งาน", at, by: me }, reviews: undefined };
        }
        const list = [...(t.reviews ?? []).filter((r) => r.who !== me), { who: me, ok: true, note, at }];
        const need = Math.max(t.reviewers?.length ?? 0, 1);
        if (list.filter((r) => r.ok).length >= need) {
          status = "done";
          return { ...t, status: "done", pct: 100, doneAt: at, back: undefined, reviews: list };
        }
        return { ...t, reviews: list };
      },
      { kind: "status", who: me, at, tx: ok ? `ตรวจผ่าน ${taskName}` : `ขอแก้ ${taskName}` },
    ),
  );
  return { ok: true as const, status };
}

/**
 * PM กดปิดงาน (รอบที่ 132 · เจ้าของสั่ง 25 พ.ย. 2569)
 *
 * งานย่อยต้องเสร็จครบก่อน · งาน DM ต้องยิงแอดครบทุกตัวด้วย (ฐานข้อมูลกันไว้อีกชั้น)
 * คืนเหตุผลเป็นข้อความเมื่อปิดไม่ได้ เพื่อให้หน้าจอบอกตรง ๆ
 */
export async function closeProject(pj: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = mergedState().projects.find((x) => isRef(x, pj));
  if (!now) return { ok: false, message: "ไม่พบโปรเจคนี้" };
  if (now.status === "cancelled") return { ok: false, message: "โปรเจคนี้ถูกยกเลิกไปแล้ว" };
  const left = now.tasks.filter((t) => t.status !== "done").length;
  if (left > 0) return { ok: false, message: `ยังมีงานที่ไม่เสร็จอีก ${left} ใบ` };

  const at = bkkStamp();
  if (live) {
    const res = await sbPatchProject(now.pj, { status: "done", updated: today() });
    if (!res.ok) {
      /* ปิดไม่สำเร็จ = ไม่มีอะไรเปลี่ยน ไม่ต้องอ่านใหม่
         (อ่านใหม่แล้วหน้าจอวาดรอบใหม่ ข้อความบอกเหตุหายไปทันที) */
      return {
        ok: false,
        /* ฐานข้อมูลส่งข้อความไทยกลับมาตรง ๆ (ตัวกันปิดงานของรอบที่ 132) */
        message: /ยิง|โฆษณา|ปิดงาน/.test(res.reason ?? "")
          ? (res.reason as string)
          : "ปิดงานไม่สำเร็จ ลองใหม่อีกครั้ง",
      };
    }
    await sbAddAct(now.pj, { kind: "status", who: "PM", at, tx: "ปิดงาน" });
    refreshPm();
    return { ok: true };
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      isRef(p, pj)
        ? {
            ...p,
            status: "done" as const,
            updated: today(),
            acts: [{ kind: "status" as const, who: "PM", at, tx: "ปิดงาน" }, ...p.acts],
          }
        : p,
    ),
  }));
  return { ok: true };
}

export async function approveWork(pj: string, taskName: string, stamp: string) {
  if (live) {
    const hit = await pmTask(pj, taskName);
    if (!hit) return;
    await sbPatchTask(hit.pj, hit.i, { status: "done", pct: 100, done_at: stampToIso(stamp), back: null });
    await sbAddAct(hit.pj, { kind: "status", who: "PM", at: stamp, tx: `ตรวจผ่าน ${taskName}` });
    /* งานครบทุกใบแล้วถือว่าโปรเจคส่งมอบเสร็จ ไม่ต้องมากดปิดซ้ำอีกที
       (ทางเดิมคิดให้ใน patchTask — ทางฐานข้อมูลต้องคิดตรงนี้เอง) */
    /*
     * ไม่ปิดโปรเจคให้เองแล้ว (รอบที่ 132 · เจ้าของสั่ง 25 พ.ย. 2569 ว่า "PM เป็นคนกดปิด")
     * งาน DM ยังต้องยิงแอดให้ครบก่อน งานครบทุกใบจึงไม่เท่ากับปิดงานได้
     */
    await sbPatchProject(hit.pj, { updated: today() });
    refreshPm();
    return;
  }
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => ({
        ...t,
        status: "done",
        pct: 100,
        doneAt: stamp,
        back: undefined,
      }),
      { kind: "status", who: "PM", at: stamp, tx: `ตรวจผ่าน ${taskName}` },
    ),
  );
}

/* หางานย่อยใบหนึ่งจากชื่อ — คืนเลขที่โปรเจคกับลำดับงาน เพราะฐานข้อมูลอ้างด้วยลำดับ */
async function pmTask(pj: string, taskName: string) {
  const p0 = mergedState().projects.find((p) => isRef(p, pj));
  const i = p0?.tasks.findIndex((t) => t.name === taskName) ?? -1;
  return p0 && i >= 0 ? { pj: p0.pj, i } : null;
}

/** "YYYY-MM-DD HH:mm" (เวลาไทย) เป็นเวลาแบบที่ฐานข้อมูลเก็บ */
function stampToIso(stamp: string) {
  const t = stamp.trim().replace(" ", "T");
  const iso = new Date((t.length === 16 ? t + ":00" : t) + "+07:00");
  return Number.isNaN(iso.getTime()) ? null : iso.toISOString();
}

/** PM ตีกลับให้แก้ — เหตุผลบังคับ ฝั่งที่เรียกต้องกันไว้ก่อนแล้ว */
export async function sendBackWork(pj: string, taskName: string, why: string, stamp: string) {
  if (live) {
    const hit = await pmTask(pj, taskName);
    if (!hit) return;
    await sbPatchTask(hit.pj, hit.i, { status: "revise", back: { why, at: stamp, by: "PM" } });
    await sbAddAct(hit.pj, { kind: "status", who: "PM", at: stamp, tx: `ส่งกลับให้แก้ ${taskName}` });
    /* ยังมีงานค้าง โปรเจคกลับมาเดินอยู่ */
    await sbPatchProject(hit.pj, { status: "running", updated: today() });
    refreshPm();
    return;
  }
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => ({
        ...t,
        status: "revise",
        back: { why, at: stamp, by: "PM" },
      }),
      { kind: "status", who: "PM", at: stamp, tx: `ส่งกลับให้แก้ ${taskName}` },
    ),
  );
}

/**
 * PM ส่งงานที่ตรวจผ่านแล้วให้ลูกค้าตรวจผ่านลิงก์ (client-review-store) — งานเป็น "รอลูกค้าตรวจ"
 * ลูกค้าอนุมัติแล้ว PM ปิดด้วย approveWork · ลูกค้ามีความเห็นก็ตีกลับด้วย sendBackWork ตามทางเดิม
 */
export async function sendToClientWork(pj: string, taskName: string, round: number, stamp: string) {
  if (live) {
    const hit = await pmTask(pj, taskName);
    if (!hit) return;
    await sbPatchTask(hit.pj, hit.i, { status: "wait", back: null });
    await sbAddAct(hit.pj, {
      kind: "status",
      who: "PM",
      at: stamp,
      tx: `ส่ง ${taskName} ให้ลูกค้าตรวจ รอบที่ ${round}`,
    });
    refreshPm();
    return;
  }
  store.update((s) =>
    patchTask(
      s,
      pj,
      taskName,
      (t) => ({ ...t, status: "wait", back: undefined }),
      { kind: "status", who: "PM", at: stamp, tx: `ส่ง ${taskName} ให้ลูกค้าตรวจ รอบที่ ${round}` },
    ),
  );
}

/** ลงกิจกรรมของโปรเจคจากนอกสโตร์ — ตอนนี้ใช้กับลูกค้าที่ส่งความเห็นผ่านลิงก์ตรวจงาน */
export function addProjectAct(pj: string, act: Activity) {
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    if (!p0) return;
    void sbAddAct(p0.pj, act).then(() => refreshPm());
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => (isRef(p, pj) ? { ...p, acts: [act, ...p.acts], updated: today() } : p)),
  }));
}

export async function postChat(
  pj: string,
  text: string,
  stamp: string,
  files: { n: string; sz: string }[] = [],
  /** ผู้ส่ง — "PM" หรือรหัสพนักงานของทีมงานที่ส่งจากหน้างานที่ได้รับ (ผู้ใช้สั่ง 5 ต.ค. 2569) */
  who = "PM",
) {
  const message: ChatMessage = { who, at: stamp, tx: text, files: files.length ? files : undefined };
  const act = files.length ? `ส่งไฟล์ในแชทโปรเจค ${files.length} ไฟล์` : "ส่งข้อความในแชทโปรเจค";
  /* ไฟล์ที่ส่งในแชทเก็บเข้าไฟล์ของโปรเจคด้วย จะได้หาเจอโดยไม่ต้องไล่อ่านแชท (ตามต้นแบบ) */
  const kept: TaskFile[] = files.map((f) => ({ n: f.n, k: fileKind(f.n), sz: f.sz, at: stamp.slice(0, 10), by: who }));
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    if (!p0) return;
    await sbPostChat(p0.pj, { who, tx: text, files: files.length ? files : undefined });
    await sbAddAct(p0.pj, { kind: "chat", who, at: stamp, tx: act });
    await sbPatchProject(p0.pj, { updated: today() });
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      /* ส่งแชทแล้วขึ้นในกิจกรรมล่าสุดด้วย ตามต้นแบบ — คนที่ไล่ดูกิจกรรมจะรู้ว่ามีข้อความใหม่ */
      isRef(p, pj)
        ? {
            ...p,
            chat: [...p.chat, message],
            files: kept.length ? [...kept, ...(p.files ?? [])] : p.files,
            acts: [...p.acts, { kind: "chat" as const, who, at: stamp, tx: act }],
            updated: today(),
          }
        : p,
    ),
  }));
}

// ─── ข้อความของงานย่อย ─────────────────────────────────────────────

/** สายข้อความของงานหนึ่งใบ เรียงเก่าไปใหม่ */
export function taskTalks(s: PmState, pj: string, taskName: string): TaskTalk[] {
  return s.talks[talkKey(pj, taskName)] ?? [];
}

/**
 * ส่งข้อความเรื่องงานใบหนึ่ง — เก็บเข้าสายของงานนั้น และส่งเข้าแชทโปรเจคด้วย
 *
 * ที่ต้องเข้าแชทโปรเจคด้วย เพราะ PM อ่านความเคลื่อนไหวของโปรเจคจากที่นั่น
 * ถ้าเก็บแยกอย่างเดียว PM จะไม่รู้ว่าทีมตอบกลับมาแล้ว ก็กลับไปตามกันในไลน์เหมือนเดิม
 */
export async function postTaskTalk(
  pj: string,
  taskName: string,
  who: string,
  tx: string,
  stamp: string,
  nudge = false,
) {
  const note: TaskTalk = { who, at: stamp, tx, ...(nudge ? { nudge: true } : {}) };
  const key = talkKey(pj, taskName);
  const act = nudge ? `ทวงงาน ${taskName}` : `ส่งข้อความเรื่อง ${taskName}`;
  if (live) {
    const p0 = mergedState().projects.find((x) => isRef(x, pj));
    if (!p0) return;
    await sbPostTaskTalk(p0.pj, taskName, { who, tx, nudge });
    /* ติดชื่องานไว้หน้าข้อความ คนอ่านแชทโปรเจคจะได้รู้ว่าพูดถึงงานใบไหน */
    await sbPostChat(p0.pj, { who, tx: `[${taskName}] ${tx}` });
    await sbAddAct(p0.pj, { kind: "chat", who, at: stamp, tx: act });
    await sbPatchProject(p0.pj, { updated: today() });
    refreshPm();
    return;
  }
  store.update((s) => ({
    ...s,
    talks: { ...s.talks, [key]: [...(s.talks[key] ?? []), note] },
    projects: s.projects.map((p) =>
      isRef(p, pj)
        ? {
            ...p,
            /* ติดชื่องานไว้หน้าข้อความ คนอ่านแชทโปรเจคจะได้รู้ว่าพูดถึงงานใบไหน */
            chat: [...p.chat, { who, at: stamp, tx: `[${taskName}] ${tx}` }],
            acts: [...p.acts, { kind: "chat" as const, who, at: stamp, tx: act }],
            updated: today(),
          }
        : p,
    ),
  }));
}

/**
 * PM ทวงงานที่ค้าง — ผลคือผู้รับงานเห็นข้อความนี้ในหน้างานที่ได้รับของตัวเอง
 * (กระดิ่งของทีมงานอ่านจาก talks ตัวเดียวกัน ดูหมายเหตุใน notifications)
 */
export function nudgeTask(pj: string, taskName: string, tx: string, stamp: string) {
  postTaskTalk(pj, taskName, "PM", tx, stamp, true);
}

/** ทวงล่าสุดของงานใบนี้ — ยังไม่มีใครตอบหลังจากนั้นถึงจะนับว่ายังค้าง */
export function openNudge(s: PmState, pj: string, taskName: string) {
  const list = taskTalks(s, pj, taskName);
  const last = list[list.length - 1];
  return last?.nudge ? last : undefined;
}
