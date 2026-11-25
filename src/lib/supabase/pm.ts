"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import type {
  Activity,
  ChatMessage,
  InboxJob,
  Project,
  ProjectDoc,
  ProjectPhase,
  ProjectTask,
  ProjectTransfer,
  TaskFile,
  TaskStatus,
} from "../pm-data";

/*
 * งานฝ่ายโครงการจากฐานข้อมูล (รอบที่ 102–103 · SRS 1.5 M4)
 *
 * แปลงไปเป็นรูปเดียวกับที่หน้าจอใช้อยู่เดิมทุกช่อง หน้าจอจึงไม่ต้องแก้
 * ของที่ต้องระวังคือ "ลำดับงานย่อย" — หน้าจออ้างงานด้วยดัชนีในอาเรย์
 * ฐานข้อมูลจึงเก็บ idx ไว้ด้วย และเรียงตาม idx เสมอตอนอ่าน ไม่งั้นงานสลับใบกัน
 */

const n = (v: number | string | null | undefined) => Number(v ?? 0);

/** "YYYY-MM-DD HH:mm" ตามเวลาไทย — รูปเดียวกับที่ทุกหน้าใช้ */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

const dayOf = (v: string | null) => (v ? v.slice(0, 10) : "");

type ProjectRow = {
  id: string;
  pj: string;
  deal_id: string | null;
  service: string;
  name: string;
  cus: string;
  quo: string;
  net: number | string;
  scope: string;
  pm: string;
  start_on: string | null;
  due: string | null;
  status: string;
  cancel_at: string | null;
  cancel_by: string;
  cancel_why: string;
  tone: string;
  phases: unknown;
  source: unknown;
  updated: string | null;
  deals: { no: string } | null;
  invoices: { no: string } | null;
};

type TaskRow = {
  id: string;
  project_id: string;
  idx: number;
  name: string;
  phase: number;
  whos: string[];
  start_on: string | null;
  due: string | null;
  status: string;
  pct: number;
  brief: string;
  files: unknown;
  subs: unknown;
  back: unknown;
  assigned_at: string | null;
  done_at: string | null;
  last_change: unknown;
};

type InboxRow = {
  id: string;
  pj: string;
  service: string;
  cus: string;
  quo: string;
  quo_date: string | null;
  net: number | string;
  seqs: number;
  paid_at: string | null;
  sent_at: string | null;
  scope: string;
  items: unknown;
  due: string | null;
  stage: string;
  plan_start: string | null;
  plan_end: string | null;
  duration_days: number;
  phases: unknown;
  proposal: unknown;
  assign_whos: string[];
  assign_due: string | null;
  seen: boolean;
  project_start: string | null;
  contact: string;
  phone: string;
  tax_id: string;
  address: string;
  terms: string;
  valid_days: number;
  taken_by: string;
  taken_at: string | null;
  name: string;
  docs: unknown;
  deals: { no: string } | null;
  invoices: { no: string } | null;
};

export type TaskTalkRow = { who: string; at: string; tx: string; nudge?: boolean };

export type PmData = {
  inbox: InboxJob[];
  projects: Project[];
  talks: Record<string, TaskTalkRow[]>;
  drafts: Record<string, { phases: unknown[]; plan: unknown[][]; at: string; by: string }>;
  /** เลขที่โปรเจค → id ของฐานข้อมูล · เลขที่โปรเจค+ลำดับงาน → id ของงาน */
  projIdByPj: Record<string, string>;
  taskIdByKey: Record<string, string>;
};

export const EMPTY_PM: PmData = {
  inbox: [],
  projects: [],
  talks: {},
  drafts: {},
  projIdByPj: {},
  taskIdByKey: {},
};

const PROJECT_COLS =
  "id, pj, deal_id, service, name, cus, quo, net, scope, pm, start_on, due, status," +
  " cancel_at, cancel_by, cancel_why, tone, phases, source, updated," +
  " deals(no), invoices(no)";

const INBOX_COLS =
  "id, pj, service, cus, quo, quo_date, net, seqs, paid_at, sent_at, scope, items, due," +
  " stage, plan_start, plan_end, duration_days, phases, proposal, assign_whos, assign_due," +
  " seen, project_start, contact, phone, tax_id, address, terms, valid_days," +
  " taken_by, taken_at, name, docs, deals(no), invoices(no)";

export async function fetchPm(): Promise<PmData> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return EMPTY_PM;

  const [pr, ib] = await Promise.all([
    sb.from("projects").select(PROJECT_COLS).order("pj", { ascending: false }),
    sb.from("project_inbox").select(INBOX_COLS).order("pj", { ascending: false }),
  ]);
  if (pr.error) return EMPTY_PM;
  const projRows = (pr.data ?? []) as unknown as ProjectRow[];
  const projIdByPj: Record<string, string> = {};
  const pjById: Record<string, string> = {};
  for (const r of projRows) {
    projIdByPj[r.pj] = r.id;
    pjById[r.id] = r.pj;
  }

  const [tk, ch, ac, dc, tr, tl, df] = await Promise.all([
    sb
      .from("project_tasks")
      .select(
        "id, project_id, idx, name, phase, whos, start_on, due, status, pct, brief," +
          " files, subs, back, assigned_at, done_at, last_change",
      )
      .order("idx"),
    sb.from("project_chat").select("project_id, who, at, tx, files").order("at"),
    sb.from("project_acts").select("project_id, kind, who, at, tx").order("at", { ascending: false }),
    sb.from("project_docs").select("project_id, name, size_text, by_name, at, url, file_id").order("at"),
    sb.from("project_transfers").select("project_id, at, from_name, to_name, by_name, why").order("at"),
    sb.from("task_talks").select("pj, task_name, who, at, tx, nudge").order("at"),
    sb.from("project_drafts").select("pj, phases, plan, at, by_name"),
  ]);

  const taskIdByKey: Record<string, string> = {};
  const tasksByProj: Record<string, ProjectTask[]> = {};
  for (const r of (tk.data ?? []) as unknown as TaskRow[]) {
    const pj = pjById[r.project_id];
    if (!pj) continue;
    taskIdByKey[pj + "::" + r.idx] = r.id;
    const task: ProjectTask = {
      name: r.name,
      phase: r.phase,
      whos: r.whos ?? [],
      start: dayOf(r.start_on),
      due: dayOf(r.due),
      status: r.status as TaskStatus,
      pct: r.pct,
      files: (r.files as TaskFile[]) ?? [],
      brief: r.brief || undefined,
      subs: (r.subs as ProjectTask["subs"]) ?? undefined,
      back: (r.back as ProjectTask["back"]) ?? undefined,
      assignedAt: r.assigned_at ? stampOf(r.assigned_at) : undefined,
      doneAt: r.done_at ? stampOf(r.done_at) : undefined,
      lastChange: (r.last_change as ProjectTask["lastChange"]) ?? undefined,
    };
    (tasksByProj[r.project_id] ??= []).push(task);
  }

  const chatByProj: Record<string, ChatMessage[]> = {};
  for (const r of (ch.data ?? []) as { project_id: string; who: string; at: string; tx: string; files: unknown }[]) {
    (chatByProj[r.project_id] ??= []).push({
      who: r.who,
      at: stampOf(r.at),
      tx: r.tx,
      files: (r.files as ChatMessage["files"]) ?? undefined,
    });
  }

  const actsByProj: Record<string, Activity[]> = {};
  for (const r of (ac.data ?? []) as { project_id: string; kind: string; who: string; at: string; tx: string }[]) {
    (actsByProj[r.project_id] ??= []).push({
      kind: r.kind as Activity["kind"],
      who: r.who,
      at: stampOf(r.at),
      tx: r.tx,
    });
  }

  const docsByProj: Record<string, ProjectDoc[]> = {};
  for (const r of (dc.data ?? []) as {
    project_id: string; name: string; size_text: string; by_name: string; at: string; url: string; file_id: string;
  }[]) {
    (docsByProj[r.project_id] ??= []).push({
      n: r.name,
      sz: r.size_text,
      by: r.by_name,
      at: stampOf(r.at),
      url: r.url || undefined,
      fileId: r.file_id || undefined,
    });
  }

  const trByProj: Record<string, ProjectTransfer[]> = {};
  for (const r of (tr.data ?? []) as {
    project_id: string; at: string; from_name: string; to_name: string; by_name: string; why: string;
  }[]) {
    (trByProj[r.project_id] ??= []).push({
      at: stampOf(r.at),
      from: r.from_name,
      to: r.to_name,
      by: r.by_name,
      why: r.why,
    });
  }

  const talks: Record<string, TaskTalkRow[]> = {};
  for (const r of (tl.data ?? []) as { pj: string; task_name: string; who: string; at: string; tx: string; nudge: boolean }[]) {
    (talks[r.pj + "::" + r.task_name] ??= []).push({
      who: r.who,
      at: stampOf(r.at),
      tx: r.tx,
      nudge: r.nudge || undefined,
    });
  }

  const drafts: PmData["drafts"] = {};
  for (const r of (df.data ?? []) as { pj: string; phases: unknown; plan: unknown; at: string; by_name: string }[]) {
    drafts[r.pj] = {
      phases: (r.phases as unknown[]) ?? [],
      plan: (r.plan as unknown[][]) ?? [],
      at: stampOf(r.at),
      by: r.by_name,
    };
  }

  const projects = projRows.map<Project>((r) => ({
    pj: r.pj,
    bill: r.invoices?.no ?? "",
    deal: r.deals?.no ?? undefined,
    service: r.service,
    name: r.name || undefined,
    cus: r.cus,
    quo: r.quo,
    net: n(r.net),
    scope: r.scope,
    pm: r.pm,
    start: dayOf(r.start_on),
    due: dayOf(r.due),
    status: r.status as Project["status"],
    updated: dayOf(r.updated),
    cancelled: r.cancel_at ? { at: dayOf(r.cancel_at), by: r.cancel_by, why: r.cancel_why } : undefined,
    tone: r.tone as Project["tone"],
    phases: (r.phases as ProjectPhase[]) ?? [],
    tasks: tasksByProj[r.id] ?? [],
    source: (r.source as InboxJob) ?? undefined,
    chat: chatByProj[r.id] ?? [],
    acts: actsByProj[r.id] ?? [],
    docs: docsByProj[r.id] ?? undefined,
    transfers: trByProj[r.id] ?? undefined,
  }));

  const inbox = ((ib.data ?? []) as unknown as InboxRow[]).map<InboxJob>((r) => ({
    pj: r.pj,
    bill: r.invoices?.no ?? "",
    deal: r.deals?.no ?? undefined,
    service: r.service,
    cus: r.cus,
    quo: r.quo,
    quoDate: dayOf(r.quo_date),
    net: n(r.net),
    seqs: r.seqs,
    paidAt: dayOf(r.paid_at),
    sentAt: dayOf(r.sent_at),
    scope: r.scope,
    items: (r.items as string[]) ?? [],
    due: dayOf(r.due),
    stage: r.stage as InboxJob["stage"],
    planStart: dayOf(r.plan_start),
    planEnd: dayOf(r.plan_end),
    durationDays: r.duration_days,
    phases: (r.phases as InboxJob["phases"]) ?? [],
    proposal: (r.proposal as InboxJob["proposal"]) ?? undefined,
    assignWhos: r.assign_whos?.length ? r.assign_whos : undefined,
    assignDue: dayOf(r.assign_due) || undefined,
    seen: r.seen,
    projectStart: dayOf(r.project_start) || undefined,
    contact: r.contact,
    phone: r.phone,
    taxId: r.tax_id,
    address: r.address,
    terms: r.terms,
    validDays: r.valid_days,
    takenBy: r.taken_by || undefined,
    takenAt: dayOf(r.taken_at) || undefined,
    name: r.name || undefined,
    docs: (r.docs as InboxJob["docs"]) ?? undefined,
  }));

  return { inbox, projects, talks, drafts, projIdByPj, taskIdByKey };
}

/* ─── เขียน ─────────────────────────────────────────────────────── */

export type PmWrite = { ok: true; pj?: string } | { ok: false; reason: string };

const NO_BACKEND: PmWrite = { ok: false, reason: "no_backend" };

export const PM_REASON: Record<string, string> = {
  no_backend: "ยังไม่ได้ต่อฐานข้อมูล",
  denied: "ไม่มีสิทธิ์แก้งานโครงการ",
  not_found: "ไม่พบรายการนี้แล้ว",
  need_sendback_reason: "ตีกลับงานต้องบอกเหตุผล",
  need_cancel_reason: "ยกเลิกโปรเจคต้องบอกเหตุผล",
};

function why(message: string): string {
  if (/row-level security/i.test(message)) return "denied";
  const hit = /need_sendback_reason|need_cancel_reason|project_no_locked/.exec(message);
  return hit ? hit[0] : message.split("\n")[0].slice(0, 80);
}

async function projIdOf(pj: string): Promise<string | null> {
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("projects").select("id").eq("pj", pj).maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

async function taskIdOf(pj: string, idx: number): Promise<string | null> {
  const id = await projIdOf(pj);
  const sb = supabase();
  if (!sb || !id) return null;
  const got = await sb.from("project_tasks").select("id").eq("project_id", id).eq("idx", idx).maybeSingle();
  return (got.data as { id?: string } | null)?.id ?? null;
}

/** ผู้จัดการโครงการเปิดดูงานเข้าใหม่แล้ว — จุดแดงหน้าแถวหายไป */
export async function sbMarkInboxSeen(pj: string): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("project_inbox").update({ seen: true }).eq("pj", pj);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

/** เก็บร่างแผนไว้ที่ฐานข้อมูล — เปิดจากอีกเครื่องมาทำต่อได้ */
export async function sbSaveDraft(
  pj: string,
  draft: { phases: unknown[]; plan: unknown[][]; by: string },
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("project_drafts").upsert(
    {
      pj,
      phases: draft.phases,
      plan: draft.plan,
      at: new Date().toISOString(),
      by_name: draft.by,
      by_id: myId(),
    },
    { onConflict: "pj" },
  );
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbClearDraft(pj: string): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("project_drafts").delete().eq("pj", pj);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

/** อัปเดตสถานะหรือความคืบหน้าของงานย่อยใบเดียว — แตะเฉพาะแถวของงานนั้น */
export async function sbPatchTask(
  pj: string,
  idx: number,
  patch: Record<string, unknown>,
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await taskIdOf(pj, idx);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("project_tasks").update(patch).eq("id", id);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbPatchProject(pj: string, patch: Record<string, unknown>): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("projects").update(patch).eq("pj", pj);
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbPostChat(
  pj: string,
  msg: { who: string; tx: string; files?: { n: string; sz: string }[] },
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await projIdOf(pj);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("project_chat").insert({
    project_id: id,
    who: msg.who,
    tx: msg.tx,
    files: msg.files ?? null,
  });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbAddAct(pj: string, act: Activity): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await projIdOf(pj);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("project_acts").insert({
    project_id: id,
    kind: act.kind,
    who: act.who,
    tx: act.tx,
  });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbPostTaskTalk(
  pj: string,
  taskName: string,
  msg: { who: string; tx: string; nudge?: boolean },
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const got = await sb.from("task_talks").insert({
    pj,
    task_name: taskName,
    who: msg.who,
    tx: msg.tx,
    nudge: Boolean(msg.nudge),
  });
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

export async function sbTransferProject(
  pj: string,
  t: { from: string; to: string; by: string; why: string },
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await projIdOf(pj);
  if (!id) return { ok: false, reason: "not_found" };
  const add = await sb.from("project_transfers").insert({
    project_id: id,
    from_name: t.from,
    to_name: t.to,
    by_name: t.by,
    why: t.why,
  });
  if (add.error) return { ok: false, reason: why(add.error.message) };
  const up = await sb.from("projects").update({ pm: t.to }).eq("id", id);
  if (up.error) return { ok: false, reason: why(up.error.message) };
  return { ok: true };
}

export async function sbAddDocs(pj: string, docs: ProjectDoc[]): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await projIdOf(pj);
  if (!id) return { ok: false, reason: "not_found" };
  const got = await sb.from("project_docs").insert(
    docs.map((d) => ({
      project_id: id,
      name: d.n,
      size_text: d.sz,
      by_name: d.by,
      url: d.url ?? "",
      file_id: d.fileId ?? "",
    })),
  );
  if (got.error) return { ok: false, reason: why(got.error.message) };
  return { ok: true };
}

/**
 * รับงานเข้าใหม่ → เปิดโปรเจคจริง
 * งานเข้าใหม่ยังอยู่ในกล่อง (stage = plan) เพราะหน้าวางแผนยังต้องอ่านข้อเสนอกับเฟสจากตรงนั้น
 */
export async function sbAcceptInbox(input: {
  pj: string;
  name: string;
  start: string;
  job: InboxJob;
  tone: "a" | "b" | "c";
}): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const { job } = input;

  const inv = job.bill
    ? await sb.from("invoices").select("id").eq("no", job.bill).maybeSingle()
    : { data: null };
  const deal = job.deal
    ? await sb.from("deals").select("id, customer_id").eq("no", job.deal).maybeSingle()
    : { data: null };

  const got = await sb
    .from("projects")
    .insert({
      pj: input.pj,
      invoice_id: (inv.data as { id?: string } | null)?.id ?? null,
      deal_id: (deal.data as { id?: string } | null)?.id ?? null,
      customer_id: (deal.data as { customer_id?: string } | null)?.customer_id ?? null,
      service: job.service,
      name: input.name,
      cus: job.cus,
      quo: job.quo,
      net: job.net,
      scope: job.scope,
      pm: "",
      pm_id: myId(),
      start_on: input.start || null,
      due: job.due || null,
      status: "running",
      tone: input.tone,
      phases: [],
      source: job,
      updated: new Date().toISOString().slice(0, 10),
      created_by: myId(),
    })
    .select("pj")
    .single();
  if (got.error) return { ok: false, reason: why(got.error.message) };

  const up = await sb
    .from("project_inbox")
    .update({ stage: "plan", seen: true, project_start: input.start || null })
    .eq("pj", input.pj);
  if (up.error) return { ok: false, reason: why(up.error.message) };
  return { ok: true, pj: (got.data as { pj: string }).pj };
}

/**
 * ยืนยันแผน — เขียนเฟสลงโปรเจค แล้ววางงานย่อยทั้งชุดใหม่
 * งานที่ยังไม่มีในฐานข้อมูลเพิ่มเข้าไป งานเดิมที่ลำดับเดียวกันเขียนทับ ส่วนที่เกินลบทิ้ง
 */
export async function sbConfirmPlan(
  pj: string,
  phases: ProjectPhase[],
  tasks: ProjectTask[],
): Promise<PmWrite> {
  const sb = supabase();
  if (!sb || !(await signedIn())) return NO_BACKEND;
  const id = await projIdOf(pj);
  if (!id) return { ok: false, reason: "not_found" };

  const up = await sb
    .from("projects")
    .update({ phases, updated: new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (up.error) return { ok: false, reason: why(up.error.message) };

  const rows = tasks.map((t, i) => ({
    project_id: id,
    idx: i,
    name: t.name,
    phase: t.phase,
    whos: t.whos ?? [],
    start_on: t.start || null,
    due: t.due || null,
    status: t.status,
    pct: t.pct,
    brief: t.brief ?? "",
    files: t.files ?? [],
    subs: t.subs ?? [],
    back: t.back ?? null,
    assigned_at: t.assignedAt ? new Date(t.assignedAt.replace(" ", "T") + ":00+07:00").toISOString() : null,
    done_at: t.doneAt ? new Date(t.doneAt.replace(" ", "T") + ":00+07:00").toISOString() : null,
    last_change: t.lastChange ?? null,
  }));
  if (rows.length) {
    const add = await sb.from("project_tasks").upsert(rows, { onConflict: "project_id,idx" });
    if (add.error) return { ok: false, reason: why(add.error.message) };
  }
  const drop = await sb.from("project_tasks").delete().eq("project_id", id).gte("idx", rows.length);
  if (drop.error) return { ok: false, reason: why(drop.error.message) };
  return { ok: true };
}
