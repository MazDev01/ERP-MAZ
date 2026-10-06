"use client";

/*
 * งาน PM ทั้งสายอยู่ในสโตร์เดียว เพราะแต่ละขั้นส่งงานต่อกัน:
 * งานเข้าใหม่ → ส่งไปวางแผน → ยืนยันแผน → กลายเป็นโปรเจค
 * ถ้าแยกสโตร์จะเกิดสถานะที่ขัดกันเอง เช่น งานยังอยู่ในกล่องเข้าทั้งที่เปิดโปรเจคแล้ว
 */

import { useSyncExternalStore } from "react";
import { addDays, bkkStamp, daysBetween, todayIso } from "./format";
import {
  PM_INBOX,
  PM_PROJECTS,
  PM_TEAM,
  fileKind,
  type Activity,
  type ChatMessage,
  type InboxJob,
  type Member,
  type Project,
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
 * แชทโปรเจคอยู่ในหน้าของ PM ซึ่งพนักงาน (บทบาท staff) เปิดไม่ได้ตามกติกาเมนูตามบทบาท
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

/** คีย์ของสายข้อความหนึ่งงาน — เลขที่ดีลกับชื่องาน (ชื่องานไม่ซ้ำกันในโปรเจคเดียว) */
export function talkKey(deal: string, taskName: string) {
  return `${deal}|${taskName}`;
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
   * ร่างแผนที่ยังไม่ยืนยัน แยกตามเลขที่ดีล — กติกาเดียวกับใบเสนอราคา
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
function migratePm(input: PmState): PmState {
  const v = input;
  const seedOf = new Map(PM_PROJECTS.map((p) => [p.deal, p]));

  const projects = v.projects.map((p) => {
    const seed = seedOf.get(p.deal);
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
  const known = new Set(v.projects.map((p) => p.deal));
  const added = PM_PROJECTS.filter((p) => !known.has(p.deal));

  /* ตัวอย่างดีลที่ถูกยกเลิก (ครัวคุณจิ) เพิ่มเข้าชุดตั้งต้น 21 ก.ย. 2569 — เครื่องที่เก็บข้อมูลไว้ก่อนให้เห็นด้วย
     ใช้เฉพาะรายการตั้งต้นที่มีการยกเลิก และของในเครื่องยังเดินอยู่ ไม่ทับของที่ผู้ใช้ยกเลิกเอง */
  const cancelled = [...projects, ...added].map((p) => {
    const seed = seedOf.get(p.deal);
    return seed?.cancelled && p.status === "running" && !p.cancelled
      ? { ...p, status: "cancelled" as const, cancelled: seed.cancelled, updated: seed.updated }
      : p;
  });

  /* ร่างแผนเพิ่มเข้ามา 23 ก.ย. · สายข้อความของงานย่อยเพิ่ม 24 ก.ย. —
     ข้อมูลที่ยังไม่มีช่องพวกนี้ถือว่ายังว่าง เติมให้ ไม่เปลี่ยนคีย์ จะได้ไม่ทิ้งงานที่ทำไว้แล้ว */
  return { ...v, projects: cancelled, drafts: v.drafts ?? {}, talks: v.talks ?? {} };
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
    const draft = s.drafts[deal];
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

/* React เรียก getServer ตอน hydrate และ get หลังจากนั้น — จำไว้ว่ารอบวาดนี้ใช้ชุดไหน */
const readClient = () => {
  rendering = "client";
  return store.get();
};
const readServer = () => {
  rendering = "server";
  return store.getServer();
};

export function usePm() {
  return useSyncExternalStore(store.subscribe, readClient, readServer);
}

export function resetPm() {
  store.reset();
}

/** อ่านค่าปัจจุบันนอกคอมโพเนนต์ — ใช้ตอนส่งงานข้ามฝ่าย (ดู flow.ts) */
export function pmSnapshot() {
  return store.get();
}

/*
 * ค้นทีมจากรหัสพนักงาน — อ่านจากสโตร์ ไม่ใช่จากชุดข้อมูลตั้งต้น
 * ไม่งั้นชื่อที่ PM เพิ่งแก้จะไม่เปลี่ยนตามในการ์ดงานและหน้าแผนงาน
 */
/*
 * พนักงาน = ทะเบียนพนักงานชุดเดียวกับฝ่ายบุคคล (ERD HR-BR-19)
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

/** พนักงานสำหรับหน้าจอ — ซิงก์จากทะเบียนฝ่ายบุคคลแล้ว */
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
 * บัญชีรับเงินงวดแรกแล้ว งานจึงเข้ากล่องงานใหม่ของ PM
 * กันซ้ำด้วยเลขที่ดีล เผื่อบัญชีแก้แล้วบันทึกเงินเข้าซ้ำ
 */
export function addInboxJob(job: InboxJob) {
  store.update((s) =>
    s.inbox.some((j) => j.deal === job.deal) || s.projects.some((p) => p.deal === job.deal)
      ? s
      : { ...s, inbox: [job, ...s.inbox] },
  );
}

function today() {
  return todayIso();
}

/** เปิดดูเอกสารของงานแล้ว — จุดแดงหน้าแถวในกล่องงานเข้าใหม่หายไป */
export function markInboxSeen(deal: string) {
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (j.deal === deal && !j.seen ? { ...j, seen: true } : j)),
  }));
}

/**
 * รับงาน (ตามต้นแบบ pm-inbox.html) — งานออกจากกล่องงานเข้าใหม่ไปรอจัดคิวในหน้าวางแผน
 *
 * ข้อเสนอกำหนดเป็นช่วงสัปดาห์ ไม่ได้ระบุวันเริ่มตายตัว
 * เลือกวันเริ่มแล้วเลื่อนทุกเฟสไปทั้งชุด ระยะของแต่ละเฟสเท่าเดิมตามที่ตกลงกับลูกค้า
 * งานที่ไม่มีข้อเสนอไม่มีเฟส — แค่จำวันเริ่มไว้ แล้ว PM สร้างเฟสเองในหน้าวางแผน
 */
export function acceptInboxJob(deal: string, start: string, name = "") {
  if (!start) return;
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => {
      if (j.deal !== deal || j.stage !== "new") return j;
      /* ชื่อโปรเจค (PM-BR-03) — ว่างใช้ "ลูกค้า – ขอบเขตงาน" ตามต้นแบบ */
      const nm = name.trim() || `${j.cus} – ${j.scope}`;
      if (!j.phases.length || !j.planStart) {
        return { ...j, stage: "plan" as const, seen: true, projectStart: start, planStart: start, name: nm };
      }
      const d = daysBetween(j.planStart, start);
      return {
        ...j,
        stage: "plan" as const,
        seen: true,
        name: nm,
        projectStart: start,
        planStart: addDays(j.planStart, d),
        planEnd: j.planEnd ? addDays(j.planEnd, d) : j.planEnd,
        phases: j.phases.map((ph) => ({ ...ph, start: addDays(ph.start, d), end: addDays(ph.end, d) })),
      };
    }),
  }));
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
export function savePlanDraft(deal: string, draft: Omit<PlanDraft, "at" | "by">, by: string) {
  store.update((s) => ({
    ...s,
    drafts: { ...s.drafts, [deal]: { ...draft, at: bkkStamp(), by } },
  }));
}

/** ทิ้งร่างของดีลนี้ — ยืนยันแผนแล้วร่างหมดหน้าที่ */
export function clearPlanDraft(deal: string) {
  store.update((s) => {
    if (!s.drafts[deal]) return s;
    const next = { ...s.drafts };
    delete next[deal];
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
export function confirmPlan(
  deal: string,
  tasks: PlannedTask[],
  pmName: string,
  /** เฟสหลัง PM แก้หรือเพิ่มเองในหน้าวางแผน */
  phases: ProjectPhase[],
) {
  const at = bkkStamp();
  store.update((s) => {
    const job = s.inbox.find((j) => j.deal === deal);
    if (!job) return s;
    /* งานที่ไม่มีข้อเสนอไม่มีวันจบจากใบเสนอราคา ใช้วันจบของเฟสสุดท้ายที่ PM วางไว้แทน */
    const lastEnd = phases.reduce((m, ph) => (ph.end > m ? ph.end : m), "");
    const tones = ["a", "b", "c"] as const;
    const project: Project = {
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
    delete drafts[deal];
    return {
      ...s,
      inbox: s.inbox.filter((j) => j.deal !== deal),
      projects: [project, ...s.projects],
      drafts,
    };
  });
}

/**
 * เปิดโปรเจคที่ PM ตั้งเองจากหน้า "โปรเจคใหม่" (ไม่ได้มาจากดีลของฝ่ายขาย)
 * ใช้กับงานภายในหรืองานที่ยังไม่มีใบเสนอราคา — ยอดเงินและเลขใบเสนอราคาจึงว่าง
 * เลขโปรเจคออกเป็น PRJ-ปี-ลำดับ เพื่อไม่ชนกับเลขดีลของฝ่ายขาย
 */
export function createOwnProject(input: {
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
  let created = "";
  store.update((s) => {
    /* เลขปีพุทธศักราชเต็ม ให้รูปแบบเดียวกับเลขดีล (DL-2569-0018) */
    const year = Number(day.slice(0, 4)) + 543;
    const seq = s.projects.filter((p) => p.deal.startsWith("PRJ-")).length + 1;
    const deal = `PRJ-${year}-${String(seq).padStart(4, "0")}`;
    created = deal;
    const tones = ["a", "b", "c"] as const;
    const project: Project = {
      deal,
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
export function replanProject(deal: string, tasks: PlannedTask[], phases: ProjectPhase[]) {
  const at = bkkStamp();
  store.update((s) => {
    const drafts = { ...s.drafts };
    delete drafts[deal];
    return {
    ...s,
    drafts,
    projects: s.projects.map((p) => {
      if (p.deal !== deal) return p;
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
export function renameProject(deal: string, name: string) {
  const v = name.trim();
  if (!v) return;
  store.update((s) => ({
    ...s,
    inbox: s.inbox.map((j) => (j.deal === deal ? { ...j, name: v } : j)),
    projects: s.projects.map((p) => (p.deal === deal ? { ...p, name: v, updated: today() } : p)),
  }));
}

/*
 * โอนโปรเจคให้เจ้าของคนใหม่ (Proposal · PM — Transfer Project)
 * โปรเจคมีเจ้าของได้คนเดียว โอนแล้วเจ้าของเดิมหมดสิทธิ์ทันที
 * โอนหลังตกลงกันแล้วเท่านั้น จึงบังคับให้ใส่เหตุผล และเก็บไว้เป็นประวัติทุกครั้ง
 * งานย่อยกับคนที่ถูกมอบหมายไม่เปลี่ยน — เปลี่ยนแค่คนที่ดูแลโปรเจค
 */
export function transferProject(deal: string, to: string, why: string, by: string) {
  const name = to.trim();
  const reason = why.trim();
  if (!name || !reason) return false;
  let done = false;
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (p.deal !== deal) return p;
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
export function setTaskStatus(deal: string, taskIndex: number, status: TaskStatus) {
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (p.deal !== deal) return p;
      const tasks = p.tasks.map((t, i) =>
        i === taskIndex
          ? { ...t, status, pct: status === "done" ? 100 : status === "todo" ? 0 : t.pct }
          : t,
      );
      /* งานครบทุกใบแล้วถือว่าโปรเจคส่งมอบเสร็จ ไม่ต้องมากดปิดซ้ำอีกที */
      const allDone = tasks.every((t) => t.status === "done");
      return {
        ...p,
        tasks,
        status: allDone ? ("done" as const) : ("running" as const),
        updated: today(),
      };
    }),
  }));
}

/**
 * ปรับความคืบหน้าของงานที่กำลังทำอยู่
 *
 * สถานะกับเปอร์เซ็นต์ต้องไม่ขัดกัน — 0 คือยังไม่เริ่ม 100 คือเสร็จ
 * จึงเลื่อนสถานะให้ตามค่าที่กรอกด้วย ไม่ให้เกิดงาน "เสร็จแล้ว 40%"
 */
export function setTaskProgress(deal: string, taskIndex: number, pct: number) {
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => {
      if (p.deal !== deal) return p;
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
      const allDone = tasks.every((t) => t.status === "done");
      return {
        ...p,
        tasks,
        status: allDone ? ("done" as const) : ("running" as const),
        updated: today(),
      };
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
export function attachFile(deal: string, taskIndex: number, file: TaskFile) {
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      p.deal === deal
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

export function removeFile(deal: string, taskIndex: number, name: string) {
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      p.deal === deal
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
  deal: string,
  taskName: string,
  fn: (t: ProjectTask) => ProjectTask,
  /* ความเคลื่อนไหวที่จะขึ้นในกิจกรรมล่าสุดของโปรเจค — งานขยับแล้วต้องมีร่องรอยเสมอ
     ไม่งั้น PM เปิดหน้าโปรเจคแล้วเห็นสถานะเปลี่ยนโดยไม่รู้ว่าใครทำเมื่อไหร่ */
  act: Activity,
): PmState {
  return {
    ...s,
    projects: s.projects.map((p) => {
      if (p.deal !== deal) return p;
      const tasks = p.tasks.map((t) => (t.name === taskName ? fn(t) : t));
      const allDone = tasks.every((t) => t.status === "done");
      return {
        ...p,
        tasks,
        status: allDone ? ("done" as const) : ("running" as const),
        acts: [act, ...p.acts],
        updated: today(),
      };
    }),
  };
}

/**
 * ทีมส่งผลงานให้ PM ตรวจ — ใช้ได้ทั้งรอบแรกและรอบที่ส่งแก้
 *
 * เก็บทุกรอบไว้ต่อกัน ไม่ทับของเดิม เพราะตอน PM ตรวจต้องเทียบได้ว่ารอบก่อนตีกลับเพราะอะไร
 * แล้วรอบนี้แก้ตรงนั้นหรือยัง · ส่งใหม่แล้วเหตุผลที่ตีกลับถือว่าจบไป จึงล้าง back ทิ้ง
 */
export function submitWork(
  deal: string,
  taskName: string,
  input: { by: string; files: string[]; note: string; at: string },
) {
  const sub: Submission = {
    at: input.at,
    by: input.by,
    files: input.files,
    note: input.note,
  };
  store.update((s) =>
    patchTask(
      s,
      deal,
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
export function approveWork(deal: string, taskName: string, stamp: string) {
  store.update((s) =>
    patchTask(
      s,
      deal,
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

/** PM ตีกลับให้แก้ — เหตุผลบังคับ ฝั่งที่เรียกต้องกันไว้ก่อนแล้ว */
export function sendBackWork(deal: string, taskName: string, why: string, stamp: string) {
  store.update((s) =>
    patchTask(
      s,
      deal,
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
 * (ยกมาจากระบบต้นฉบับ ERP_Test 5 ต.ค. 2569 — ปรับให้อ้างโปรเจคด้วยเลขที่ดีลตามโครงสร้างของเรา)
 */
export function sendToClientWork(deal: string, taskName: string, round: number, stamp: string) {
  store.update((s) =>
    patchTask(
      s,
      deal,
      taskName,
      (t) => ({ ...t, status: "wait" as const, back: undefined }),
      { kind: "status", who: "PM", at: stamp, tx: `ส่ง ${taskName} ให้ลูกค้าตรวจ รอบที่ ${round}` },
    ),
  );
}

/** ลงกิจกรรมของโปรเจคจากนอกสโตร์ — ใช้กับลูกค้าที่ส่งความเห็นผ่านลิงก์ตรวจงาน */
export function addProjectAct(deal: string, act: Activity) {
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) => (p.deal === deal ? { ...p, acts: [act, ...p.acts], updated: today() } : p)),
  }));
}

export function postChat(
  deal: string,
  text: string,
  stamp: string,
  files: { n: string; sz: string }[] = [],
  /** ผู้ส่ง — "PM" หรือรหัสพนักงานของทีมงานที่ส่งจากหน้างานที่ได้รับ (ยกจากระบบต้นฉบับ 6 ต.ค. 2569) */
  who = "PM",
) {
  const message: ChatMessage = { who, at: stamp, tx: text, files: files.length ? files : undefined };
  const act = files.length ? `ส่งไฟล์ในแชทโปรเจค ${files.length} ไฟล์` : "ส่งข้อความในแชทโปรเจค";
  /* ไฟล์ที่ส่งในแชทเก็บเข้าไฟล์ของโปรเจคด้วย จะได้หาเจอโดยไม่ต้องไล่อ่านแชท (ตามต้นแบบ) */
  const kept: TaskFile[] = files.map((f) => ({ n: f.n, k: fileKind(f.n), sz: f.sz, at: stamp.slice(0, 10), by: "PM" }));
  store.update((s) => ({
    ...s,
    projects: s.projects.map((p) =>
      /* ส่งแชทแล้วขึ้นในกิจกรรมล่าสุดด้วย ตามต้นแบบ — คนที่ไล่ดูกิจกรรมจะรู้ว่ามีข้อความใหม่ */
      p.deal === deal
        ? {
            ...p,
            chat: [...p.chat, message],
            files: kept.length ? [...kept, ...(p.files ?? [])] : p.files,
            acts: [...p.acts, { kind: "chat" as const, who: "PM", at: stamp, tx: act }],
            updated: today(),
          }
        : p,
    ),
  }));
}

// ─── ข้อความของงานย่อย ─────────────────────────────────────────────

/** สายข้อความของงานหนึ่งใบ เรียงเก่าไปใหม่ */
export function taskTalks(s: PmState, deal: string, taskName: string): TaskTalk[] {
  return s.talks[talkKey(deal, taskName)] ?? [];
}

/**
 * ส่งข้อความเรื่องงานใบหนึ่ง — เก็บเข้าสายของงานนั้น และส่งเข้าแชทโปรเจคด้วย
 *
 * ที่ต้องเข้าแชทโปรเจคด้วย เพราะ PM อ่านความเคลื่อนไหวของโปรเจคจากที่นั่น
 * ถ้าเก็บแยกอย่างเดียว PM จะไม่รู้ว่าทีมตอบกลับมาแล้ว ก็กลับไปตามกันในไลน์เหมือนเดิม
 */
export function postTaskTalk(
  deal: string,
  taskName: string,
  who: string,
  tx: string,
  stamp: string,
  nudge = false,
) {
  const note: TaskTalk = { who, at: stamp, tx, ...(nudge ? { nudge: true } : {}) };
  const key = talkKey(deal, taskName);
  const act = nudge ? `ทวงงาน ${taskName}` : `ส่งข้อความเรื่อง ${taskName}`;
  store.update((s) => ({
    ...s,
    talks: { ...s.talks, [key]: [...(s.talks[key] ?? []), note] },
    projects: s.projects.map((p) =>
      p.deal === deal
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
 * (กระดิ่งของพนักงานอ่านจาก talks ตัวเดียวกัน ดูหมายเหตุใน notifications)
 */
export function nudgeTask(deal: string, taskName: string, tx: string, stamp: string) {
  postTaskTalk(deal, taskName, "PM", tx, stamp, true);
}

/** ทวงล่าสุดของงานใบนี้ — ยังไม่มีใครตอบหลังจากนั้นถึงจะนับว่ายังค้าง */
export function openNudge(s: PmState, deal: string, taskName: string) {
  const list = taskTalks(s, deal, taskName);
  const last = list[list.length - 1];
  return last?.nudge ? last : undefined;
}
