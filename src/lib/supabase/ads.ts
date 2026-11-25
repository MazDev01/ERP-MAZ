"use client";

import { signedIn, supabase } from "./client";
import { myId } from "./people";
import type { AdContent, AdMetric, AdRun } from "../ads-data";
import type { AdsState } from "../ads-store";

/*
 * งานโฆษณา (รอบที่ 114) — ใบสั่งรันและผลของชิ้นงาน
 *
 * ฐานข้อมูลผูกกับ projects.id แต่หน้าจออ้างเลขที่โปรเจค (PJ-…)
 * ชั้นนี้จึงแปลงให้ และจำคู่ไว้จากรอบที่อ่านมา
 *
 * ใบสั่งรันไม่มีรหัสของตัวเองในหน้าจอ อ้างด้วย โปรเจค + รอบ + ช่องทาง + เครื่องมือ
 * ชิ้นงานอ้างด้วย โปรเจค + รอบ + ชื่อชิ้นงาน — ตารางมีคีย์ไม่ซ้ำตามนั้น
 */

/** "yyyy-mm-dd HH:mm" ตามเวลาไทย */
function stampOf(at: string | null): string {
  if (!at) return "";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at.slice(0, 16).replace("T", " ");
  const th = new Date(d.getTime() + (420 + d.getTimezoneOffset()) * 60_000);
  return th.toISOString().slice(0, 16).replace("T", " ");
}

type RunRow = {
  id: string;
  project_id: string;
  round: string;
  media: string;
  ae: string;
  ordered_at: string | null;
  channel: string;
  tool: string;
  start_on: string | null;
  end_on: string | null;
  budget: string | number;
  ran: boolean;
  note: string;
  ordered_by: string;
  ran_by: string;
  ran_at: string | null;
  projects: { pj: string } | null;
};

type ContentRow = {
  id: string;
  project_id: string;
  round: string;
  name: string;
  kind: string;
  m: AdMetric | null;
  by_name: string;
  at: string | null;
  projects: { pj: string } | null;
};

/** เลขที่โปรเจค → id · เติมตอนอ่าน และตอนถามเพิ่มรายที่ยังไม่รู้จัก */
const idByPj = new Map<string, string>();
/** รหัสแถวของใบสั่งรัน — ใช้ตอนกดยืนยันว่ารันแล้ว (หน้าจอไม่มีรหัสนี้) */
const runIdByKey = new Map<string, string>();

const runKey = (pj: string, round: string, channel: string, tool: string) =>
  [pj, round, channel, tool].join("|");

async function projectIdOf(pj: string): Promise<string | null> {
  const known = idByPj.get(pj);
  if (known) return known;
  const sb = supabase();
  if (!sb) return null;
  const got = await sb.from("projects").select("id").eq("pj", pj).maybeSingle();
  const id = (got.data as { id?: string } | null)?.id ?? null;
  if (id) idByPj.set(pj, id);
  return id;
}

const KINDS: AdContent["type"][] = ["Single", "Album", "VDO"];

export async function fetchAds(): Promise<AdsState> {
  const empty: AdsState = { runs: [], contents: [] };
  const sb = supabase();
  if (!sb || !(await signedIn())) return empty;

  const [rn, ct] = await Promise.all([
    sb
      .from("ad_runs")
      .select(
        "id, project_id, round, media, ae, ordered_at, channel, tool, start_on, end_on," +
          " budget, ran, note, ordered_by, ran_by, ran_at, projects(pj)",
      )
      .order("round"),
    sb
      .from("ad_contents")
      .select("id, project_id, round, name, kind, m, by_name, at, projects(pj)")
      .order("round"),
  ]);
  if (rn.error || ct.error) return empty;

  const runs: AdRun[] = [];
  for (const r of (rn.data ?? []) as unknown as RunRow[]) {
    const pj = r.projects?.pj;
    if (!pj) continue;
    idByPj.set(pj, r.project_id);
    runIdByKey.set(runKey(pj, r.round, r.channel, r.tool), r.id);
    runs.push({
      pj,
      round: r.round,
      media: r.media,
      ae: r.ae,
      orderedAt: r.ordered_at ?? "",
      channel: r.channel,
      tool: r.tool,
      start: r.start_on ?? "",
      end: r.end_on ?? "",
      budget: Number(r.budget),
      ran: r.ran,
      note: r.note,
      orderedBy: r.ordered_by || undefined,
      ranBy: r.ran_by || undefined,
      ranAt: r.ran_at ? stampOf(r.ran_at) : undefined,
    });
  }

  const contents: AdContent[] = [];
  for (const c of (ct.data ?? []) as unknown as ContentRow[]) {
    const pj = c.projects?.pj;
    if (!pj) continue;
    idByPj.set(pj, c.project_id);
    contents.push({
      pj,
      round: c.round,
      name: c.name,
      type: (KINDS.includes(c.kind as AdContent["type"]) ? c.kind : "Single") as AdContent["type"],
      m: c.m ?? null,
      by: c.by_name || undefined,
      at: c.at ? stampOf(c.at) : undefined,
    });
  }
  return { runs, contents };
}

export async function sbAddRun(run: Omit<AdRun, "ran">) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  const id = await projectIdOf(run.pj);
  if (!id) return;
  await sb.from("ad_runs").insert({
    project_id: id,
    round: run.round,
    media: run.media,
    ae: run.ae,
    ordered_at: run.orderedAt || null,
    channel: run.channel,
    tool: run.tool,
    start_on: run.start || null,
    end_on: run.end || null,
    budget: run.budget,
    note: run.note,
    ordered_by: run.orderedBy ?? "",
    created_by: myId(),
  });
}

/** ยืนยันว่ารันจริงแล้ว — กดได้ครั้งเดียว ฐานข้อมูลกันการทับของเดิมให้ */
export async function sbMarkRun(pj: string, round: string, channel: string, tool: string, by: string) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  let id = runIdByKey.get(runKey(pj, round, channel, tool));
  if (!id) {
    const projectId = await projectIdOf(pj);
    if (!projectId) return;
    const got = await sb
      .from("ad_runs")
      .select("id")
      .eq("project_id", projectId)
      .eq("round", round)
      .eq("channel", channel)
      .eq("tool", tool)
      .maybeSingle();
    id = (got.data as { id?: string } | null)?.id;
    if (!id) return;
    runIdByKey.set(runKey(pj, round, channel, tool), id);
  }
  await sb.rpc("ad_run_mark", { p_run: id, p_by: by });
}

/**
 * บันทึกผลของชิ้นงาน — ชิ้นงานที่ยังไม่มีแถวในตารางก็สร้างให้เลย
 * (ชุดชิ้นงานตั้งต้นมาจากข้อมูลในโค้ด ยังไม่เคยลงฐานข้อมูล)
 */
export async function sbSaveMetric(
  pj: string,
  round: string,
  name: string,
  m: AdMetric,
  by: string,
  kind: AdContent["type"] = "Single",
) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  const id = await projectIdOf(pj);
  if (!id) return;
  await sb.from("ad_contents").upsert(
    {
      project_id: id,
      round,
      name,
      kind,
      m,
      by_name: by,
      at: new Date().toISOString(),
      created_by: myId(),
    },
    { onConflict: "project_id,round,name" },
  );
}

/** เพิ่มชิ้นงานของรอบนั้น — ผลยังว่าง รอกรอกทีหลัง */
export async function sbAddContent(pj: string, round: string, name: string, kind: AdContent["type"]) {
  const sb = supabase();
  if (!sb || !(await signedIn())) return;
  const id = await projectIdOf(pj);
  if (!id) return;
  await sb.from("ad_contents").insert({ project_id: id, round, name, kind, created_by: myId() });
}
