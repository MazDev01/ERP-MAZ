"use client";

/*
 * จัดคิวงาน (ตามต้นแบบ pm-plan.html) — PM วางแผนงานที่รับเข้ามาแล้วก่อนเปิดเป็นโปรเจค
 *
 * งานที่มีข้อเสนอได้เฟสและงานย่อยมาเป็นโครงตั้งต้น งานที่ไม่มีเริ่มจากกระดานว่างแล้วสร้างเฟสเอง
 * PM ทำได้ — เพิ่ม/แก้เฟส · เพิ่มงานในเฟส · ลากจัดลำดับในเฟส · เลือกคนและวัน · มอบหมายหลายงานพร้อมกัน
 * แก้เฟสที่มาจากข้อเสนอ ระบบจำค่าเดิมไว้แล้วบอกส่วนต่าง จะได้ตอบลูกค้าได้ว่าต่างจากที่เสนอไปเท่าไหร่
 *
 * แผนที่ยังไม่ยืนยันเก็บเป็นร่างในสโตร์ตั้งแต่ตอนแก้ (กติกาเดียวกับใบเสนอราคา)
 * ไม่มีปุ่มบันทึก · รีโหลดหรือออกจากหน้าไปแล้วกลับมา สิ่งที่กรอกไว้ยังอยู่
 * "ยืนยันแผน" เปลี่ยนแค่สถานะ — ร่างกลายเป็นโปรเจค แล้วกลับหน้ารายการโปรเจค
 */

import { ROLE_EMPLOYEE, useHrTime } from "@/lib/hr-link";
import { useEmpRequests } from "@/lib/emp-requests";
import { HR_LEAVE_LABEL } from "@/lib/hr-data";
import { useAllLeave } from "@/lib/leave-store";
import type { Role } from "@/lib/role";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { addDays, daysBetween, initials, thaiDate, thaiStamp, todayIso } from "@/lib/format";
import { useProfile } from "@/lib/profile-data";
import {
  fileKind,
  fileKindLabel,
  teamRoles,
  roleLabel,
  isRef,
  projectHref,
  type InboxJob,
  type Member,
  type Project,
  type ProjectDoc,
  type TaskFile,
  type TeamRole,
} from "@/lib/pm-data";
import {
  confirmPlan,
  memberOf,
  replanProject,
  savePlanDraft,
  type DraftPhase,
  type DraftTask,
  type PlannedTask,
  usePm,
  useTeam,
} from "@/lib/pm-store";
import {
  CalendarIcon,
  CheckIcon,
  FileIcon,
  ChevronDownIcon,
  CloseIcon,
  LockIcon,
  PencilIcon,
  PlusIcon,
  QuotationIcon,
  TrashIcon,
  UserIcon,
} from "./icons";
import { fileSize } from "./file-drop";
import { openStoredFile, putFile, removeStoredFile } from "@/lib/file-store";
import { Field, Sheet } from "./lead-dialogs";
import { ProposalPreview, QuotationPreview } from "./pm-docs";
import { ThaiDatePicker } from "./thai-date-picker";
import { AddDocButton, AddDocsDialog, DocChips, RenameButton, RenameDialog } from "./pm-project-tools";
import { Select } from "./ui";
import { useAddOption } from "./add-option";
import { ReadOnlyNote, usePmReadOnly } from "./pm-readonly";

/*
 * งานย่อยและเฟสระหว่างวางแผน — รูปเดียวกับร่างในสโตร์ (pm-store: DraftTask/DraftPhase)
 * ประกาศไว้ที่สโตร์เพราะร่างถูกบันทึกจริง ไม่ใช่ของชั่วคราวในหน้านี้แล้ว
 */
type Draft = DraftTask;
type PlanPhase = DraftPhase;

type Board = { phases: PlanPhase[]; plan: Draft[][] };

/**
 * งานที่กำลังวางแผน — งานที่รับเข้ามาแล้วรอวางแผน หรือโปรเจคที่ยืนยันแล้วกลับมาแก้แผน
 * docs = ข้อมูลสำหรับเปิดใบเสนอราคา/ข้อเสนอ (โปรเจคตั้งต้นไม่มี)
 */
type Target = {
  /** เลขที่โปรเจค (PJ-) — ลิงก์เก่าส่งเลขที่ดีลมาก็ยังหาเจอด้วย isRef */
  pj: string;
  cus: string;
  /** ชื่อโปรเจค — ว่าง = ยังไม่ได้ตั้ง ขึ้นชื่อลูกค้าแทน (ยกมาจากระบบต้นฉบับ) */
  name?: string;
  scope: string;
  /** เอกสารที่ PM/GM แนบเพิ่ม (ยกมาจากระบบต้นฉบับ) */
  extra: ProjectDoc[];
  docs?: InboxJob;
  /** ช่วงตามใบเสนอราคา — ว่าง = คิดจากเฟสที่วางเอง */
  planStart: string;
  planEnd: string;
  firstDay: string;
  project?: Project;
  initial: () => Board;
};

function targetOfJob(j: InboxJob): Target {
  return {
    pj: j.pj,
    cus: j.cus,
    name: j.name,
    scope: j.scope,
    extra: j.docs ?? [],
    docs: j,
    planStart: j.planStart,
    planEnd: j.planEnd,
    firstDay: j.projectStart || j.planStart || todayIso(),
    initial: () => blankBoard(j),
  };
}

function targetOfProject(p: Project): Target {
  return {
    pj: p.pj,
    cus: p.cus,
    name: p.name,
    scope: p.scope,
    extra: p.docs ?? [],
    docs: p.source,
    planStart: "",
    planEnd: "",
    firstDay: p.start,
    project: p,
    initial: () => ({
      phases: p.phases.map((ph) => ({ name: ph.name, role: ph.role, start: ph.start, end: ph.end })),
      plan: p.phases.map((ph, pi) =>
        p.tasks
          .map((t, i) => ({ t, i }))
          .filter(({ t }) => t.phase === pi)
          .map(({ t, i }) => ({
            name: t.name,
            role: ph.role,
            whos: [...t.whos],
            start: t.start,
            due: t.due,
            /* โจทย์และไฟล์ของงานเดิมติดมาด้วย จะได้แก้ต่อได้โดยไม่ต้องพิมพ์ใหม่ */
            brief: t.brief,
            files: t.files.map((f) => ({ ...f })),
            from: i,
          })),
      ),
    }),
  };
}

/** ตำแหน่งของงานย่อยในกระดาน: เฟสที่เท่าไร ใบที่เท่าไร */
type Spot = { phase: number; index: number };

/* เฟสหนึ่งมีงานได้หลายตำแหน่ง สีจึงไม่ผูกกับตำแหน่ง ใช้สีตามลำดับเฟสแทน (ตามต้นแบบ) */
const PH_TONE = ["#D0021B", "#2F55B8", "#1F7A4D", "#B26414", "#6B3FBF", "#0B7C84", "#B02A72", "#4A5568"];
const phaseColor = (i: number) => PH_TONE[i % PH_TONE.length];

export function PmPlanPage() {
  const pm = usePm();
  const me = useProfile();
  const router = useRouter();
  /* GM เปิดดูแผนได้ แต่ PM เป็นคนวางแผน (ต้นแบบ pm-plan.html?as=gm) */
  const ro = usePmReadOnly();
  const params = useSearchParams();

  /* ทุกงานที่รับแล้วรอวางแผน — รวมงานที่ไม่มีข้อเสนอ ซึ่งต้องสร้างเฟสเอง
     ปุ่ม "วางแผนงาน" ในหน้าโปรเจคส่ง ?pj= ของโปรเจคที่ยืนยันแล้วมา — เปิดมาแก้แผนได้ด้วย
     ลิงก์เก่าที่ส่ง ?deal= มายังเปิดได้ (isRef หาเจอทั้งเลขโปรเจคและเลขดีล) */
  const fromRef = params.get("pj") ?? params.get("deal") ?? "";
  /* ลิงก์เก่าส่งเลขที่ดีลมา — แปลงเป็นเลขที่โปรเจคก่อน แล้วที่เหลือในหน้านี้ใช้เลข PJ อย่างเดียว */
  const fromParam = [...pm.projects, ...pm.inbox].find((x) => isRef(x, fromRef))?.pj ?? fromRef;
  /* โปรเจคที่ถูกยกเลิกแล้ววางแผนต่อไม่ได้ — ไม่เอาเข้ารายการให้เลือก */
  const linked = pm.projects.find((p) => isRef(p, fromParam) && p.status !== "cancelled");
  const targets: Target[] = [
    ...(linked ? [targetOfProject(linked)] : []),
    ...pm.inbox.filter((j) => j.stage === "plan").map(targetOfJob),
  ];
  const [pjNo, setPjNo] = useState(() => linked?.pj ?? fromParam);
  const job = targets.find((t) => t.pj === pjNo) ?? targets[0];
  /*
   * ลิงก์ชี้มาที่ดีลที่ไม่มีให้วางแผนแล้ว (ถูกยกเลิก หรือยืนยันแผนไปแล้ว)
   * ต้องบอกให้รู้ ไม่ใช่สลับไปงานอื่นเงียบ ๆ แล้วปล่อยให้แก้ผิดใบ (ผู้ใช้ทักท้วง 24 ก.ย. 2569)
   */
  const gone = Boolean(fromParam) && !targets.some((t) => t.pj === fromParam);
  const cancelled = pm.projects.find((p) => isRef(p, fromParam) && p.status === "cancelled");

  /* ร่างเก็บในสโตร์ คีย์ด้วยเลขที่ดีล — สลับงานไปมาหรือรีโหลดแล้วสิ่งที่กรอกไว้ไม่หาย */
  const draft = job ? pm.drafts[job.pj] : undefined;
  const board: Board = job ? (draft ?? job.initial()) : { phases: [], plan: [] };
  const { phases, plan } = board;

  const [picked, setPicked] = useState<Record<string, boolean>>({});
  /* ทีมจากทะเบียนเดียวกับฝ่ายบุคคล — คนที่พ้นสภาพแล้วมอบหมายงานใหม่ไม่ได้ */
  const team = useTeam().filter((m) => !m.left);
  const [bulkWho, setBulkWho] = useState(team[0]?.id ?? "");
  const [open, setOpen] = useState<Spot | null>(null);
  const [doc, setDoc] = useState<"quo" | "prop" | null>(null);
  /* แก้ชื่อโปรเจคและแนบเอกสารเพิ่มได้จากหน้านี้ (ยกมาจากระบบต้นฉบับ) */
  const [renaming, setRenaming] = useState(false);
  const [addingDoc, setAddingDoc] = useState(false);
  /** เฟสที่กำลังแก้ — -1 = เพิ่มเฟสใหม่ */
  const [phaseEdit, setPhaseEdit] = useState<number | null>(null);
  const [adding, setAdding] = useState<number | null>(null);
  /* เฟสที่กำลังดูอยู่บนมือถือ — จอกว้างเห็นทุกเฟสพร้อมกันอยู่แล้ว ค่านี้จึงไม่มีผล */
  /* ลากการ์ดเพื่อสลับลำดับ — ลากได้เฉพาะในเฟสเดียวกัน เพราะงานย่อยผูกกับเฟสของมัน */
  const [drag, setDrag] = useState<string | null>(null);
  const [over, setOver] = useState<number | null>(null);

  /* แก้อะไรก็บันทึกร่างทันที ไม่มีปุ่มบันทึก (กติกาเดียวกับใบเสนอราคา) */
  function edit(fn: (b: Board) => void) {
    if (!job) return;
    const next = cloneBoard(board);
    fn(next);
    savePlanDraft(job.pj, next, `${me.name} (PM)`);
  }

  function dropOn(phase: number, index: number) {
    if (!drag) return;
    const [fp, fi] = drag.split(":").map(Number);
    setDrag(null);
    setOver(null);
    if (fp !== phase || fi === index) return;
    edit((b) => {
      const [item] = b.plan[phase].splice(fi, 1);
      b.plan[phase].splice(index, 0, item);
    });
    /* ลำดับเปลี่ยน คีย์ของใบที่ติ๊กไว้จึงชี้ผิดใบ ล้างทิ้งดีกว่ามอบหมายผิดคน */
    setPicked({});
  }

  const flat = plan.flat();
  const noWho = flat.filter((t) => !t.whos.length).length;
  const noDate = flat.filter((t) => !t.start || !t.due).length;
  const left = Math.max(noWho, noDate);
  const outOfPhase = phases.filter((ph, pi) =>
    (plan[pi] ?? []).some((t) => t.start && t.due && (t.start < ph.start || t.due > ph.end)),
  );
  const problems = [
    /* ตามต้นแบบ แผนใหม่ยืนยันได้แม้ยังไม่มีงาน — กันเฉพาะตอนแก้แผนโปรเจคที่เดินอยู่ จะได้ไม่ล้างงานเดิมทิ้งหมด */
    job?.project && flat.length === 0 ? "ยังไม่มีงานในแผน" : "",
    noDate > 0 ? `ยังไม่ได้กำหนดวัน ${noDate} งาน` : "",
    noWho > 0 ? `ยังไม่ได้เลือกผู้รับผิดชอบ ${noWho} งาน` : "",
    /* โปรเจคที่เดินงานอยู่อาจมีงานเก่าที่วันเลยกรอบเฟสมาก่อนแล้ว — แสดงเตือนที่การ์ด แต่ไม่ห้ามบันทึก */
    ...(job?.project ? [] : outOfPhase.map((ph) => `มีงานหลุดกรอบเฟส "${ph.name}"`)),
  ].filter(Boolean);

  const pickedKeys = Object.keys(picked).filter((k) => picked[k]);
  /* ปุ่มถอดออกกดได้เฉพาะตอนคนที่เลือกเป็นผู้รับผิดชอบอยู่จริงในงานที่ติ๊กไว้ */
  const removable = pickedKeys.filter((k) => at(plan, k)?.whos.includes(bulkWho)).length;

  if (gone || !job) {
    return (
      <div className="space-y-4">
        <PageBar />
        <section className="glass rounded-[15px] px-5 py-12 text-center">
          {gone ? (
            <>
              <b className="block text-[15px] font-bold">ไม่พบงานของโปรเจคนี้ในหน้าวางแผน</b>
              <p className="mx-auto mt-2 max-w-[520px] text-[13px] leading-relaxed text-muted-foreground">
                <span className="num">{fromParam}</span>{" "}
                {cancelled
                  ? `ถูกยกเลิกเมื่อ ${cancelled.cancelled ? thaiDate(cancelled.cancelled.at.slice(0, 10)) : "แล้ว"} โดย ${cancelled.cancelled?.by ?? "ฝ่ายที่เกี่ยวข้อง"} · แผนที่วางไว้เปิดดูย้อนหลังได้ที่หน้าโปรเจค`
                  : "อาจยืนยันแผนไปแล้ว หรือถูกยกเลิก · ถ้ายืนยันแล้วให้แก้แผนจากหน้าโปรเจคของงานนั้น"}
              </p>
              <div className="mt-4 flex flex-wrap justify-center gap-2.5">
                <Link
                  href={fromParam ? projectHref(fromParam) : "/pm/projects"}
                  className="btn glass-thin"
                >
                  เปิดหน้าโปรเจค
                </Link>
                {targets.length > 0 && (
                  <Link href="/pm/plan" className="btn solid btn-solid">
                    ไปงานที่รอวางแผน ({targets.length})
                  </Link>
                )}
              </div>
            </>
          ) : (
            <span className="text-muted-foreground">ไม่มีงานรอวางแผน</span>
          )}
        </section>
      </div>
    );
  }

  /* ช่วงเวลาบนแถบล็อก — มีข้อเสนอใช้ระยะตามใบเสนอราคา ไม่มีคิดจากเฟสที่ PM วางเอง */
  const own = !job.planEnd;
  const docs = job.docs;
  const span = own
    ? phases.reduce(
        (r, ph) => ({ s: !r.s || ph.start < r.s ? ph.start : r.s, e: ph.end > r.e ? ph.end : r.e }),
        { s: "", e: "" },
      )
    : { s: job.planStart, e: job.planEnd };

  function confirm() {
    if (!job || problems.length) return;
    const tasks: PlannedTask[] = [];
    plan.forEach((list, pi) =>
      list.forEach((t) =>
        tasks.push({
          from: t.from,
          name: t.name,
          phase: pi,
          whos: t.whos,
          start: t.start,
          due: t.due,
          brief: t.brief,
          files: t.files,
        }),
      ),
    );
    const outPhases = phases.map((ph, pi) => ({
      name: ph.name,
      /* โปรเจคต้องมีตำแหน่งของเฟส — เฟสที่สร้างเองใช้ตำแหน่งของงานแรกในเฟส */
      role: ph.role ?? plan[pi]?.find((t) => t.role)?.role ?? teamRoles()[0].key,
      start: ph.start,
      end: ph.end,
    }));
    if (job.project) {
      /* โปรเจคที่เดินงานอยู่ — บันทึกแผนใหม่แล้วกลับไปหน้าโปรเจคนั้น (ร่างถูกล้างในสโตร์แล้ว) */
      replanProject(job.pj, tasks, outPhases);
      router.push(projectHref(job.pj));
      return;
    }
    confirmPlan(job.pj, tasks, `${me.name} (PM)`, outPhases);
    /* ยืนยันแล้วกลับไปหน้ารายการโปรเจคตามต้นแบบ — โฟลเดอร์ของงานนี้โผล่ในรายการทันที */
    router.push("/pm/projects");
  }

  return (
    <div className="space-y-3.5">
      <div className="bar">
        <div className="min-w-0">
          {/* หัวเป็นชื่อโปรเจค แก้ชื่อได้ตรงนี้ (ยกมาจากระบบต้นฉบับ) · เลขดีลบรรทัดล่าง */}
          <h1 className="flex flex-wrap items-center gap-x-2">
            {job.name?.trim() || job.cus}
            {!ro && <RenameButton onClick={() => setRenaming(true)} />}
          </h1>
          <p className="num mt-1 text-[13px] font-semibold text-muted-foreground">
            {job.pj}
            {job.project ? " · แก้แผน" : ""}
          </p>
        </div>
        <div className="tools w-full flex-wrap items-center sm:w-auto sm:flex-nowrap">
          <Select
            value={job.pj}
            onChange={(e) => {
              setPjNo(e.target.value);
              setPicked({});
              setOpen(null);
            }}
            aria-label="เลือกงานที่จะวางแผน"
            className="h-9 w-full font-semibold max-sm:h-[46px] max-sm:rounded-full! sm:w-[300px]"
          >
            {targets.map((t) => (
              <option key={t.pj} value={t.pj}>
                {t.cus} ({t.pj}){t.project ? " · แก้แผน" : ""}
              </option>
            ))}
          </Select>
          {!ro && <button
            type="button"
            disabled={problems.length > 0}
            title={problems.length ? problems.join("\n") : "ส่งแผนงานให้ทีม"}
            onClick={confirm}
            /* มือถือ: ปุ่มหลักของหน้าลอยเต็มความกว้างเหนือแถบล่าง กดได้ทุกเมื่อไม่ต้องเลื่อนกลับขึ้นไปหา */
            /* มือถือ: ปุ่มนี้ซ่อน แล้วไปโผล่เต็มความกว้างท้ายหน้าแทน PM จะได้ไล่ดูทุกเฟสก่อนกด (ต้นแบบ pm-plan.html) */
            className="btn solid btn-solid shrink-0 whitespace-nowrap max-sm:hidden! disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-card disabled:bg-none disabled:text-muted-foreground disabled:shadow-none"
          >
            <span>{job.project ? "บันทึกแผนงาน" : "ยืนยันแผนงาน"}</span>
            {problems.length > 0 && left > 0 && (
              <span className="text-[11px] font-medium">เหลืออีก {left} งาน</span>
            )}
          </button>}
        </div>
      </div>
      <ReadOnlyNote />

      {/* ร่างแผนบันทึกเองตั้งแต่ตอนแก้ — บอกให้เห็นว่ามีร่างค้างอยู่และแก้ล่าสุดเมื่อไร */}
      {draft && (
        <p className="rounded-[10px] bg-[var(--warning-soft)] px-3.5 py-[9px] text-[12.5px] font-semibold text-[var(--warning)]">
          ร่างแผนยังไม่ยืนยัน · บันทึกอัตโนมัติแล้ว แก้ล่าสุด {thaiStamp(draft.at)} น. โดย {draft.by}
        </p>
      )}

      {/* ── เอกสารอ้างอิงและกรอบเวลา — วางบนพื้นหน้า ไม่มีกล่องครอบ (ตามต้นแบบ) ── */}
      <section className="flex flex-wrap items-start gap-3.5">
        <span className="flex gap-2 max-sm:w-full">
          <button
            type="button"
            className="btn glass-thin disabled:opacity-45 max-sm:h-9 max-sm:flex-1 max-sm:justify-center max-sm:rounded-full!"
            disabled={!docs}
            title={docs ? undefined : "โปรเจคนี้ไม่มีเอกสารแนบในระบบ"}
            onClick={() => setDoc("quo")}
          >
            <QuotationIcon className="size-[15px]" strokeWidth={2} />
            ใบเสนอราคา
          </button>
          <button
            type="button"
            className="btn glass-thin disabled:opacity-45 max-sm:h-9 max-sm:flex-1 max-sm:justify-center max-sm:rounded-full!"
            disabled={!docs?.proposal}
            title={docs?.proposal ? undefined : "งานนี้ไม่มีข้อเสนอ"}
            onClick={() => setDoc("prop")}
          >
            <QuotationIcon className="size-[15px]" strokeWidth={2} />
            Proposal
          </button>
          {/* เอกสารอื่นที่แนบให้ทีมเห็น + ปุ่มแนบเพิ่ม (ยกมาจากระบบต้นฉบับ) */}
          <DocChips pj={job.pj} docs={job.extra} canEdit={!ro} />
          {!ro && <AddDocButton onClick={() => setAddingDoc(true)} />}
        </span>
        {/* มือถือ: กรอบเวลาเป็นแคปซูลชมพูบรรทัดเดียว (ต้นแบบ pm-plan.html) */}
        <span className="ml-auto flex items-center gap-2 rounded-full bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-primary sm:hidden">
          <span className="num">
            {phases.length === 0 ? thaiDate(job.firstDay) : `${thaiDate(span.s)} – ${thaiDate(span.e)}`}
          </span>
          <span className="num">{phases.length === 0 ? "ยังไม่มีเฟส" : `${phases.length} เฟส`}</span>
        </span>
        <span className="ml-auto flex items-start gap-[22px] text-[12.5px] max-sm:hidden">
          <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-muted-foreground">
            <LockIcon className="size-3.5" />
          </span>
          {phases.length === 0 ? (
            <>
              <LockLine label="เริ่มโครงการ" value={thaiDate(job.firstDay)} />
              <LockLine label="เฟส" value="ยังไม่มี" />
            </>
          ) : (
            <>
              <LockLine
                label={own ? "แผนที่วางไว้" : "ระยะเวลาตามใบเสนอราคา"}
                value={`${thaiDate(span.s)} – ${thaiDate(span.e)}`}
              />
              <LockLine label="เฟส" value={String(phases.length)} />
            </>
          )}
        </span>
      </section>

      {/* ── เลือกหลายใบแล้วมอบหมายพร้อมกัน — โผล่เมื่อมีงานถูกติ๊กไว้ ── */}
      {!ro && pickedKeys.length > 0 && (
        <section
          className="panel glass relative z-40 flex flex-wrap items-center gap-3.5 px-[18px] py-3"
          aria-label="งานที่ถูกติ๊กไว้เพื่อมอบหมายพร้อมกัน"
        >
          <span className="rounded-[20px] bg-accent px-3.5 py-[5px] text-[13px] font-bold text-primary">
            เลือก {pickedKeys.length} งาน
          </span>
          <span className="flex min-w-[240px] flex-1 items-center gap-2.5 max-sm:min-w-0 max-sm:basis-full">
            <span className="flex-none text-[12.5px] font-semibold text-muted-foreground">มอบหมายให้</span>
            <WhoPicker team={team} value={bulkWho} onChange={setBulkWho} />
          </span>
          <span className="flex flex-wrap gap-2 max-sm:w-full max-sm:[&>button]:flex-1 max-sm:[&>button]:justify-center">
            <button type="button" className="btn glass-thin" onClick={() => setPicked({})}>
              ล้างการเลือก
            </button>
            <button
              type="button"
              className="btn glass-thin disabled:opacity-45"
              disabled={removable === 0}
              title={removable ? `ถอดออกจาก ${removable} งาน` : "คนนี้ยังไม่ได้เป็นผู้รับผิดชอบในงานที่เลือกไว้"}
              onClick={() =>
                edit((b) => {
                  for (const k of pickedKeys) {
                    const t = at(b.plan, k);
                    if (t) t.whos = t.whos.filter((id) => id !== bulkWho);
                  }
                })
              }
            >
              เอาคนนี้ออก
            </button>
            <button
              type="button"
              className="btn solid btn-solid"
              onClick={() =>
                edit((b) => {
                  for (const k of pickedKeys) {
                    const t = at(b.plan, k);
                    if (t && !t.whos.includes(bulkWho)) t.whos.push(bulkWho);
                  }
                })
              }
            >
              มอบหมาย {pickedKeys.length} งาน
            </button>
          </span>
        </section>
      )}

      {/* ── กระดานงานย่อยแยกตามเฟส ── */}
      {phases.length === 0 ? (
        /* โปรเจคที่ไม่มีข้อเสนอยังไม่มีเฟส ถือว่าปกติ บอกให้ชัดว่าเริ่มจากสร้างเฟสเอง */
        <section className="glass rounded-[15px] px-5 py-14 text-center">
          <p className="text-[15px] font-bold">ยังไม่มีแผนงาน</p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            งานนี้ไม่มีข้อเสนอมาเป็นโครงตั้งต้น เริ่มจากสร้างเฟสแรกได้เลย
          </p>
          {!ro && (
            <button type="button" className="btn solid btn-solid mt-5 inline-flex" onClick={() => setPhaseEdit(-1)}>
              <PlusIcon className="size-[15px]" strokeWidth={2.2} />
              เพิ่มเฟส
            </button>
          )}
        </section>
      ) : (
        <>
        {/* จอกว้างเรียงทุกเฟสเป็นกระดานปัดข้าง · มือถือเรียงทุกเฟสลงมาเป็นการ์ด (ต้นแบบ pm-plan.html 1 ต.ค. 2569)
            เลิกใช้ชิปเลือกทีละเฟสแล้ว เพราะต้นแบบใหม่ให้ไล่ดูทุกเฟสรวดเดียวก่อนยืนยันแผน */}
        <div className="flex items-stretch gap-3 overflow-x-auto pb-2 max-sm:flex-col max-sm:overflow-x-visible">
          {phases.map((ph, pi) => {
            const list = plan[pi] ?? [];
            const color = phaseColor(pi);
            const base = baseLines(ph);
            return (
              <section
                key={`${pi}-${ph.name}`}
                id={`plan-ph-${pi}`}
                className="flex max-h-[560px] w-[276px] flex-none flex-col overflow-hidden rounded-[14px] border border-border bg-card max-sm:max-h-none max-sm:w-full max-sm:rounded-[20px] max-sm:border-0 max-sm:shadow-[0_1px_2px_rgb(40_20_25/0.04)]"
              >
                <header
                  className="flex items-center gap-[9px] px-3.5 py-3 text-white"
                  style={{ background: color }}
                >
                  <span className="min-w-0 flex-1 truncate text-[13.5px] font-bold" title={ph.name}>
                    {ph.name}
                  </span>
                  <span className="num grid h-[22px] min-w-[22px] place-items-center rounded-full bg-white/28 px-1.5 text-[11.5px] font-bold">
                    {list.length}
                  </span>
                  {!ro && <>
                  <button
                    type="button"
                    aria-label={`เพิ่มงานในเฟส ${ph.name}`}
                    title="เพิ่มงาน"
                    onClick={() => setAdding(pi)}
                    className="grid size-[26px] place-items-center rounded-lg bg-white/18 hover:bg-white/35 max-sm:size-9"
                  >
                    <PlusIcon className="size-3.5" strokeWidth={2.4} />
                  </button>
                  <button
                    type="button"
                    aria-label={`แก้เฟส ${ph.name}`}
                    title="แก้เฟส"
                    onClick={() => setPhaseEdit(pi)}
                    className="grid size-[26px] place-items-center rounded-lg bg-white/18 hover:bg-white/35 max-sm:size-9"
                  >
                    <PencilIcon className="size-3.5" strokeWidth={2} />
                  </button>
                  </>}
                </header>

                {base.length > 0 && (
                  <div className="px-3.5 pt-2.5">
                    {base.map((x) => (
                      <p
                        key={x}
                        className={`mt-[5px] text-[10.5px] leading-[1.5] first:mt-0 ${
                          ph.own ? "text-muted-foreground" : "font-semibold text-[var(--warning)]"
                        }`}
                      >
                        {x}
                      </p>
                    ))}
                  </div>
                )}

                <div
                  className={`scroll-stable flex min-h-0 flex-1 flex-col gap-[11px] overflow-y-auto px-3.5 pt-[11px] pb-3.5 max-sm:overflow-y-visible ${
                    over === pi ? "bg-primary/[.06]" : ""
                  }`}
                >
                  {list.map((t, ti) => (
                    <TaskCard
                      key={`${pi}-${ti}-${t.name}`}
                      task={t}
                      outside={Boolean(t.start && t.due && (t.start < ph.start || t.due > ph.end))}
                      order={ti + 1}
                      checked={Boolean(picked[key(pi, ti)])}
                      dragging={drag === key(pi, ti)}
                      onCheck={() => setPicked({ ...picked, [key(pi, ti)]: !picked[key(pi, ti)] })}
                      readOnly={ro}
                      onOpen={() => setOpen({ phase: pi, index: ti })}
                      onDragStart={() => setDrag(key(pi, ti))}
                      onDragOver={(e) => {
                        if (drag && Number(drag.split(":")[0]) === pi) {
                          e.preventDefault();
                          setOver(pi);
                        }
                      }}
                      onDrop={() => dropOn(pi, ti)}
                      onDragEnd={() => {
                        setDrag(null);
                        setOver(null);
                      }}
                    />
                  ))}
                  {!ro && <button
                    type="button"
                    onClick={() => setAdding(pi)}
                    className="mt-2 w-full flex-none rounded-[11px] border-[1.5px] border-dashed border-border p-[9px] text-[12px] font-semibold text-muted-foreground hover:border-primary hover:text-primary max-sm:min-h-11"
                  >
                    + เพิ่มงาน
                  </button>}
                </div>
              </section>
            );
          })}
          {!ro && <button
            type="button"
            onClick={() => setPhaseEdit(-1)}
            className="min-h-[120px] w-[236px] flex-none self-stretch rounded-[16px] border-[1.5px] border-dashed border-border py-4 text-[13.5px] font-semibold text-muted-foreground hover:border-primary hover:text-primary max-sm:min-h-0 max-sm:w-full"
          >
            + เพิ่มเฟส
          </button>}
        </div>
        {!ro && (
          <button
            type="button"
            disabled={problems.length > 0}
            onClick={confirm}
            className="btn solid btn-solid mt-4 h-[50px] w-full justify-center rounded-[14px]! text-[15px] sm:hidden disabled:cursor-not-allowed disabled:border disabled:border-border disabled:bg-card disabled:bg-none disabled:text-muted-foreground disabled:shadow-none"
          >
            <span>{job.project ? "บันทึกแผนงาน" : "ยืนยันแผนงาน"}</span>
            {problems.length > 0 && left > 0 && (
              <span className="text-[11px] font-medium">เหลืออีก {left} งาน</span>
            )}
          </button>
        )}
        </>
      )}

      {doc && docs && (
        <Sheet
          title={
            doc === "quo"
              ? `ใบเสนอราคา ${docs.quo}`
              : `Proposal ${docs.proposal?.no ?? ""} รอบ ${docs.proposal?.round ?? ""}`
          }
          wide
          onClose={() => setDoc(null)}
          footer={
            <>
              <button
                type="button"
                className="btn glass-thin flex-1 justify-center sm:mr-auto sm:flex-none"
                onClick={() => setDoc(null)}
              >
                ปิด
              </button>
              {doc === "prop" && docs.proposal && <ProposalAction job={docs} />}
            </>
          }
        >
          {doc === "quo" ? <QuotationPreview job={docs} /> : <ProposalPreview job={docs} />}
        </Sheet>
      )}

      {renaming && (
        <RenameDialog
          project={{ pj: job.pj, name: job.name, cus: job.cus, scope: job.scope }}
          onClose={() => setRenaming(false)}
        />
      )}
      {addingDoc && <AddDocsDialog pj={job.pj} onClose={() => setAddingDoc(false)} />}

      {phaseEdit !== null && (
        <PhaseDialog
          firstDay={job.firstDay}
          phases={phases}
          index={phaseEdit}
          taskCount={phaseEdit >= 0 ? (plan[phaseEdit]?.length ?? 0) : 0}
          onClose={() => setPhaseEdit(null)}
          onDelete={() => {
            edit((b) => {
              b.phases.splice(phaseEdit, 1);
              b.plan.splice(phaseEdit, 1);
            });
            /* ลำดับเฟสขยับ คีย์ที่ติ๊กไว้จึงชี้ผิดใบ ล้างทิ้งเหมือนตอนลากสลับลำดับ */
            setPicked({});
            setPhaseEdit(null);
          }}
          onSave={(v) => {
            edit((b) => {
              if (phaseEdit < 0) {
                b.phases.push({ ...v, own: true });
                b.plan.push([]);
                return;
              }
              const ph = b.phases[phaseEdit];
              /* เก็บค่าตามข้อเสนอไว้ครั้งแรกที่แก้ ของเดิมจะได้ไม่หาย */
              if (!ph.own && ph.baseStart === undefined) {
                ph.baseName = ph.name;
                ph.baseStart = ph.start;
                ph.baseEnd = ph.end;
              }
              ph.name = v.name;
              ph.start = v.start;
              ph.end = v.end;
            });
            setPhaseEdit(null);
          }}
        />
      )}

      {adding !== null && phases[adding] && (
        <AddTaskDialog
          phase={phases[adding]}
          onClose={() => setAdding(null)}
          onSave={(t) => {
            edit((b) => {
              b.plan[adding].push(t);
            });
            setAdding(null);
          }}
        />
      )}

      {open && plan[open.phase]?.[open.index] && (
        <TaskDialog
          phase={phases[open.phase]}
          color={phaseColor(open.phase)}
          spot={open}
          task={plan[open.phase][open.index]}
          count={plan[open.phase].length}
          onClose={() => setOpen(null)}
          onEdit={(fn) =>
            edit((b) => {
              fn(b.plan[open.phase][open.index]);
            })
          }
          onDelete={() => {
            edit((b) => {
              b.plan[open.phase].splice(open.index, 1);
            });
            setPicked({});
            setOpen(null);
          }}
        />
      )}
    </div>
  );
}

function PageBar() {
  return (
    <div className="bar">
      <div>
      </div>
      <div className="tools">
        <Link href="/pm/projects" className="btn glass-thin">
          ไปหน้าโปรเจค
        </Link>
      </div>
    </div>
  );
}

/**
 * บรรทัดบอกส่วนต่างจากข้อเสนอใต้หัวเฟส
 * เฟสที่ PM สร้างเองไม่มีค่าเทียบ บอกแค่ว่าเพิ่มเอง
 */
function baseLines(ph: PlanPhase): string[] {
  if (ph.own) return ["เฟสที่เพิ่มเอง ไม่ได้อยู่ในข้อเสนอ"];
  if (ph.baseStart === undefined || ph.baseEnd === undefined) return [];
  const d1 = daysBetween(ph.baseStart, ph.start);
  const d2 = daysBetween(ph.baseEnd, ph.end);
  const renamed = ph.baseName !== undefined && ph.baseName !== ph.name;
  const out: string[] = [];
  if (renamed) out.push(`เดิมชื่อ ${ph.baseName}`);
  if (d1 || d2) out.push(`ตามข้อเสนอ ${thaiDate(ph.baseStart)} – ${thaiDate(ph.baseEnd)}`);
  if (d2) out.push(d2 > 0 ? `เลื่อนออก ${d2} วัน` : `ร่นเข้า ${Math.abs(d2)} วัน`);
  return out;
}

// ─── เพิ่ม / แก้เฟส ──────────────────────────────────────────────

function PhaseDialog({
  firstDay,
  phases,
  index,
  taskCount,
  onClose,
  onSave,
  onDelete,
}: {
  firstDay: string;
  phases: PlanPhase[];
  index: number;
  /** จำนวนงานในเฟสนี้ — ลบเฟสแล้วงานข้างในหายไปด้วย ต้องบอกก่อน */
  taskCount: number;
  onClose: () => void;
  onSave: (v: { name: string; start: string; end: string }) => void;
  onDelete: () => void;
}) {
  const isNew = index < 0;
  const ph = isNew ? undefined : phases[index];
  const last = phases[phases.length - 1];
  const first = firstDay;
  const [name, setName] = useState(ph?.name ?? "");
  const [start, setStart] = useState(ph?.start ?? (last ? addDays(last.end, 1) : first));
  const [end, setEnd] = useState(ph?.end ?? (last ? addDays(last.end, 7) : addDays(first, 6)));
  const [pick, setPick] = useState<"s" | "e" | null>(null);
  const [warn, setWarn] = useState(false);
  const [delAsk, setDelAsk] = useState(false);

  const ok = Boolean(name.trim() && start && end && end >= start);
  /* ยังไม่เคยแก้ก็ยังไม่มี baseEnd — ค่าบนเฟสตอนนี้คือค่าตามข้อเสนอ */
  const ref = ph && !ph.own ? (ph.baseEnd ?? ph.end) : "";
  const shift = ref && end ? daysBetween(ref, end) : 0;

  return (
    <Sheet
      title={isNew ? "เพิ่มเฟส" : "แก้เฟส"}
      onClose={onClose}
      footer={
        <>
          {!isNew && (
            <button
              type="button"
              className={`btn glass-thin mr-auto ${delAsk ? "!border-destructive !text-destructive" : ""}`}
              title={taskCount ? `ลบเฟสนี้พร้อมงาน ${taskCount} ใบข้างใน` : "ลบเฟสนี้"}
              onClick={() => (delAsk ? onDelete() : setDelAsk(true))}
            >
              <TrashIcon className="size-[14px]" strokeWidth={2.2} />
              {delAsk
                ? taskCount
                  ? `กดอีกครั้ง ลบพร้อมงาน ${taskCount} ใบ`
                  : "กดอีกครั้งเพื่อลบ"
                : "ลบเฟสนี้"}
            </button>
          )}
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid"
            onClick={() => (ok ? onSave({ name: name.trim(), start, end }) : setWarn(true))}
          >
            บันทึก
          </button>
        </>
      }
    >
      <Field label="ชื่อเฟส" required>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น พัฒนาระบบหลังบ้าน"
          className="field-control"
        />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="วันเริ่ม" required>
          <ThaiDatePicker
            value={start}
            open={pick === "s"}
            label="วันเริ่มเฟส"
            onToggle={() => setPick((p) => (p === "s" ? null : "s"))}
            onPick={(iso) => {
              setStart(iso);
              if (end && end < iso) setEnd(iso);
              setPick(null);
            }}
          />
        </Field>
        <Field label="วันสิ้นสุด" required>
          <ThaiDatePicker
            value={end}
            min={start || undefined}
            open={pick === "e"}
            label="วันสิ้นสุดเฟส"
            onToggle={() => setPick((p) => (p === "e" ? null : "e"))}
            onPick={(iso) => {
              setEnd(iso);
              setPick(null);
            }}
          />
        </Field>
      </div>
      {warn && !ok && (
        <p className="mb-3 rounded-[11px] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          กรอกชื่อเฟสและวันให้ครบ วันเริ่มต้องไม่หลังวันสิ้นสุด
        </p>
      )}
      <p className="rounded-[11px] bg-muted px-3.5 py-2.5 text-[12px] leading-[1.6] text-muted-foreground">
        {start && end && end >= start ? (
          <>
            ระยะ {daysBetween(start, end) + 1} วัน
            {ref && (
              <>
                {" "}
                ตามข้อเสนอจบ {thaiDate(ref)}
                {shift !== 0 && (shift > 0 ? ` เลื่อนออก ${shift} วัน` : ` ร่นเข้า ${Math.abs(shift)} วัน`)}
              </>
            )}
          </>
        ) : (
          "เลือกวันเริ่มและวันสิ้นสุด"
        )}
      </p>
    </Sheet>
  );
}

// ─── เพิ่มงานในเฟส ───────────────────────────────────────────────

function AddTaskDialog({
  phase,
  onClose,
  onSave,
}: {
  phase: PlanPhase;
  onClose: () => void;
  onSave: (t: Draft) => void;
}) {
  const team = useTeam().filter((m) => !m.left);
  const [name, setName] = useState("");
  const [role, setRole] = useState<TeamRole | "">(phase.role ?? "");
  const [who, setWho] = useState("");
  const addRole = useAddOption({ catalog: "teamRoles" }, (v) => {
    setRole(v);
    setWho("");
  });
  const [start, setStart] = useState(phase.start);
  const [due, setDue] = useState(phase.end);
  const [brief, setBrief] = useState("");
  const [pick, setPick] = useState<"s" | "e" | null>(null);
  const [warn, setWarn] = useState(false);
  const people = team.filter((m) => !role || m.roles.includes(role));
  /* ลาของแต่ละคนที่ทับช่วงงาน — บอกท้ายชื่อในรายการ และเตือนใต้ช่องเมื่อเลือกคนนั้น (ตามต้นแบบ) */
  const clashOf = useLeaveClash();
  const whoClash = who ? clashOf(who, start, due) : [];
  const ok = Boolean(name.trim() && start && due && due >= start);

  return (
    <Sheet
      title="เพิ่มงาน"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin" onClick={onClose}>
            ยกเลิก
          </button>
          <button
            type="button"
            className="btn solid btn-solid"
            onClick={() =>
              ok
                ? onSave({
                    name: name.trim(),
                    role: role || undefined,
                    whos: who ? [who] : [],
                    start,
                    due,
                    brief: brief.trim() || undefined,
                  })
                : setWarn(true)
            }
          >
            เพิ่มงาน
          </button>
        </>
      }
    >
      <p className="mb-4 text-[12.5px] text-muted-foreground">
        เฟส {phase.name} · {thaiDate(phase.start)} – {thaiDate(phase.end)}
      </p>
      <Field label="ชื่องาน" required>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="เช่น ทำระบบรับเข้าสินค้า"
          className="field-control"
        />
      </Field>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="ตำแหน่งที่ควรทำ">
          <select
            value={role}
            onChange={(e) => {
              if (addRole.pick(e.target.value)) return;
              setRole(e.target.value as TeamRole | "");
              setWho("");
            }}
            className="field-control cursor-pointer"
          >
            <option value="">ยังไม่ระบุ</option>
            {teamRoles().map((r) => (
              <option key={r.key} value={r.key}>
                {r.label}
              </option>
            ))}
            {addRole.option}
          </select>
        </Field>
        {addRole.dialog}
        <Field label="ผู้รับผิดชอบ">
          <select value={who} onChange={(e) => setWho(e.target.value)} className="field-control cursor-pointer">
            <option value="">ยังไม่มอบหมาย</option>
            {people.map((m) => {
              const c = clashOf(m.id, start, due);
              return (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {c.length ? ` — ${leaveText(c[0])}` : ""}
                </option>
              );
            })}
          </select>
          {whoClash.length > 0 && (
            <p className="mt-1.5 text-[12.5px] font-semibold text-destructive">
              คนนี้{whoClash.map(leaveText).join(" และ ")} อยู่ในช่วงงานนี้
            </p>
          )}
        </Field>
      </div>
      <div className="grid gap-x-4 sm:grid-cols-2">
        <Field label="วันเริ่ม" required>
          <ThaiDatePicker
            value={start}
            min={phase.start}
            max={phase.end}
            open={pick === "s"}
            label="วันเริ่มงาน"
            onToggle={() => setPick((p) => (p === "s" ? null : "s"))}
            onPick={(iso) => {
              setStart(iso);
              if (due && due < iso) setDue(iso);
              setPick(null);
            }}
          />
        </Field>
        <Field label="กำหนดส่ง" required>
          <ThaiDatePicker
            value={due}
            min={start || phase.start}
            max={phase.end}
            open={pick === "e"}
            label="กำหนดส่งงาน"
            onToggle={() => setPick((p) => (p === "e" ? null : "e"))}
            onPick={(iso) => {
              setDue(iso);
              setPick(null);
            }}
          />
        </Field>
      </div>
      {/* โจทย์เขียนตั้งแต่ตอนเพิ่มงานได้เลย แนบไฟล์เพิ่มทีหลังในการ์ดงาน */}
      <Field label="รายละเอียดงาน (โจทย์)">
        <textarea
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          placeholder="บอกให้ชัดว่าต้องทำอะไร ส่งอะไร คนทำจะเห็นข้อความนี้ในหน้างานที่ได้รับ"
          className="field-control h-[86px] resize-y py-2.5 leading-relaxed"
        />
      </Field>
      {warn && !ok && (
        <p className="mb-3 rounded-[11px] bg-[var(--destructive-soft)] px-3.5 py-2.5 text-[12.5px] font-semibold text-destructive">
          กรอกชื่องานและวันให้ครบ วันเริ่มต้องไม่หลังกำหนดส่ง
        </p>
      )}
      <p className="rounded-[11px] bg-muted px-3.5 py-2.5 text-[12px] text-muted-foreground">
        ผู้รับผิดชอบเว้นว่างได้ มอบหมายทีหลังในกระดานก็ได้
      </p>
    </Sheet>
  );
}

/*
 * ปุ่มท้ายของเอกสาร Proposal — ข้อเสนอเป็นลิงก์ Canva ก็เปิดลิงก์ เป็น PDF ก็พิมพ์ออกมา
 * ข้อเสนอที่ไม่มีลิงก์แนบมา ปุ่มปิดไว้พร้อมบอกเหตุผล ไม่ใช่กดแล้วไม่เกิดอะไร
 */
function ProposalAction({ job }: { job: InboxJob }) {
  const pr = job.proposal;
  if (!pr) return null;
  if (pr.kind === "canva") {
    return pr.url ? (
      <a
        href={pr.url}
        target="_blank"
        rel="noreferrer"
        className="btn solid btn-solid flex-1 justify-center sm:flex-none"
      >
        เปิดใน Canva
      </a>
    ) : (
      <button
        type="button"
        disabled
        title="ข้อเสนอนี้ยังไม่มีลิงก์ Canva แนบมา"
        className="btn solid btn-solid flex-1 justify-center disabled:opacity-45 sm:flex-none"
      >
        เปิดใน Canva
      </button>
    );
  }
  return (
    <button
      type="button"
      className="btn solid btn-solid flex-1 justify-center sm:flex-none"
      onClick={printDoc}
      title="เปิดหน้าต่างพิมพ์ แล้วเลือกบันทึกเป็น PDF"
    >
      ดาวน์โหลด PDF
    </button>
  );
}

/* พิมพ์เฉพาะแผ่นเอกสารในกล่อง ไม่เอาหน้าเว็บด้านหลังติดไปด้วย (ดู .print-doc ใน globals.css) */
function printDoc() {
  document.body.classList.add("print-doc");
  window.print();
  window.setTimeout(() => document.body.classList.remove("print-doc"), 400);
}

// ─── ตัวเลือกผู้รับผิดชอบในแถบมอบหมายพร้อมกัน ────────────────────────

/*
 * ทำเองแทน <select> เพราะต้องเห็นทั้งชื่อและตำแหน่งงานสองบรรทัด
 * ช่องเลือกของเบราว์เซอร์แสดงได้บรรทัดเดียว ชื่อยาวกับตำแหน่งจึงถูกตัดจนอ่านไม่ออก
 */
function WhoPicker({
  team,
  value,
  onChange,
}: {
  team: Member[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const current = team.find((m) => m.id === value);

  /* กดนอกกล่องหรือกด Esc แล้วปิด — ลงทะเบียนเฉพาะตอนเปิดอยู่ */
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={box} className="relative block min-w-0 flex-1">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={`flex w-full min-w-0 items-center gap-2 rounded-[10px] border bg-card px-3 py-[7px] text-left ${
          open ? "border-primary ring-[3px] ring-primary/10" : "border-border hover:border-primary"
        }`}
      >
        <span className="min-w-0 flex-1">
          <b className="block truncate text-[13px] font-bold">{current?.name ?? "เลือกผู้รับผิดชอบ"}</b>
          <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">
            {current ? current.roles.map(roleLabel).join(" · ") : "ยังไม่ได้เลือก"}
          </span>
        </span>
        <ChevronDownIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={2.4} />
      </button>

      {open && (
        <span
          role="listbox"
          className="absolute top-[calc(100%+5px)] left-0 z-90 block max-h-[296px] w-full min-w-[320px] max-w-[420px] overflow-y-auto rounded-[13px] border border-border bg-card p-1.5 shadow-[0_22px_46px_-20px_rgba(40,25,60,.42)]"
        >
          {team.map((m) => {
            const on = m.id === value;
            return (
              <button
                key={m.id}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  onChange(m.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-[11px] rounded-[10px] px-2.5 py-2 text-left ${
                  on ? "bg-accent" : "hover:bg-muted"
                }`}
              >
                <span className="grid size-[34px] flex-none place-items-center rounded-[10px] bg-accent text-xs font-bold text-primary">
                  {initials(m.name)}
                </span>
                <span className="min-w-0 flex-1">
                  <b className={`block truncate text-[13.5px] font-bold ${on ? "text-primary" : ""}`}>
                    {m.name}
                  </b>
                  <span
                    className={`mt-0.5 block truncate text-[11.5px] ${on ? "text-primary" : "text-muted-foreground"}`}
                  >
                    {m.roles.map(roleLabel).join(" · ")}
                  </span>
                </span>
              </button>
            );
          })}
        </span>
      )}
    </span>
  );
}

// ─── การ์ดงานย่อยบนกระดาน ────────────────────────────────────────

/* วันบนการ์ดตัดปีออก เพราะอยู่ในกรอบเฟสเดียวกันอยู่แล้ว */
const short = (iso: string) => thaiDate(iso).replace(/\s\d{4}$/, "");

function TaskCard({
  task,
  outside,
  order,
  checked,
  dragging,
  onCheck,
  onOpen,
  readOnly = false,
  onDragStart,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  task: Draft;
  /** วันของงานเลยกรอบเฟส */
  outside: boolean;
  order: number;
  checked: boolean;
  dragging: boolean;
  onCheck: () => void;
  onOpen: () => void;
  readOnly?: boolean;
  onDragStart: () => void;
  onDragOver: (e: React.DragEvent) => void;
  onDrop: () => void;
  onDragEnd: () => void;
}) {
  const ready = task.whos.length > 0 && Boolean(task.start) && Boolean(task.due);
  const first = task.whos[0] ? (memberOf(task.whos[0])?.name ?? task.whos[0]) : "";
  /* มอบงานในช่วงที่ผู้รับผิดชอบลา (อนุมัติแล้วหรือรออนุมัติ) — เตือนบนการ์ดเลย ไม่ต้องเปิดดูทีละใบ */
  const clashOf = useLeaveClash();
  const clash = task.whos.flatMap((id) =>
    clashOf(id, task.start, task.due).map((l) => `${(memberOf(id)?.name ?? id).split(" ")[0]} ${leaveText(l)}`),
  );
  return (
    <article
      draggable={!readOnly}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.name);
        onDragStart();
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      className={`flex flex-none cursor-grab items-stretch overflow-hidden rounded-[11px] border bg-card shadow-[0_1px_2px_rgba(31,36,48,.06),0_3px_8px_-4px_rgba(31,36,48,.16)] transition-colors hover:border-primary active:cursor-grabbing ${
        checked ? "border-primary ring-2 ring-primary/16" : "border-[#D8DDE6]"
      } ${ready ? "border-l-4 border-l-[var(--success)]" : ""} ${dragging ? "opacity-45" : ""}`}
    >
      {/* ซ้ายคือแถบเลือกงาน ขวาคือพื้นที่เปิดรายละเอียด แยกกันชัดเจน */}
      {!readOnly && <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        aria-label={`เลือกงาน ${task.name}`}
        onClick={onCheck}
        className={`group grid w-11 flex-none place-items-center border-r border-border hover:bg-accent ${
          checked ? "bg-accent" : ""
        }`}
      >
        <span
          className={`grid size-5 place-items-center rounded-[6px] border-[1.6px] ${
            checked
              ? "border-primary bg-primary text-white"
              : "border-border bg-card text-transparent group-hover:border-primary"
          }`}
        >
          <CheckIcon className="size-3" strokeWidth={3.2} />
        </span>
      </button>}
      <div
        role="button"
        tabIndex={0}
        onClick={readOnly ? undefined : onOpen}
        onKeyDown={(e) => {
          if (!readOnly && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            onOpen();
          }
        }}
        className="min-w-0 flex-1 cursor-pointer p-[11px]"
      >
        <div className="flex items-start gap-2">
          <span className="num grid size-[19px] flex-none place-items-center rounded-[6px] bg-muted text-[10.5px] font-bold text-muted-foreground">
            {order}
          </span>
          <span className="block min-w-0 flex-1 truncate text-[12.5px] leading-[1.5] font-semibold max-sm:text-[13.5px] max-sm:whitespace-normal" title={task.name}>
            {task.name}
          </span>
        </div>
        <div className="mt-[9px] flex flex-col gap-1.5">
          <MetaRow icon={<UserIcon className="size-[13px]" />} none={!task.whos.length}>
            <span title={task.whos.map((id) => memberOf(id)?.name ?? id).join(", ")}>
              {task.whos.length
                ? `${first}${task.whos.length > 1 ? ` +${task.whos.length - 1}` : ""}`
                : "ยังไม่มอบหมาย"}
            </span>
          </MetaRow>
          <MetaRow
            icon={<CalendarIcon className="size-[13px]" />}
            none={!task.start || !task.due}
            bad={outside}
          >
            {task.start && task.due ? `${short(task.start)} – ${short(task.due)}` : "ยังไม่กำหนด"}
            {outside && " · นอกกรอบเฟส"}
          </MetaRow>
          {/* คนทำต้องได้โจทย์ ไม่ใช่แค่ชื่องาน — การ์ดจึงบอกตั้งแต่บนกระดานว่าใบไหนยังไม่มี */}
          <MetaRow icon={<FileIcon className="size-[13px]" />} none={!task.brief && !task.files?.length}>
            {task.brief
              ? `${task.brief}${task.files?.length ? ` · ${task.files.length} ไฟล์` : ""}`
              : task.files?.length
                ? `${task.files.length} ไฟล์แนบ`
                : "ยังไม่มีรายละเอียดงาน"}
          </MetaRow>
          {clash.length > 0 && (
            <span
              title="มอบงานในช่วงที่ผู้รับผิดชอบลา"
              className="block truncate text-[11.5px] leading-4 font-semibold text-destructive"
            >
              ⚠ {clash.join(" · ")}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

/** บรรทัดข้อมูลบนการ์ด — ทุกใบสูงเท่ากัน ไม่ว่าจะมอบหมายแล้วหรือยัง จะได้กวาดตาเทียบกันได้ */
function MetaRow({
  icon,
  none,
  bad,
  children,
}: {
  icon: React.ReactNode;
  none?: boolean;
  bad?: boolean;
  children: React.ReactNode;
}) {
  return (
    <span
      className={`flex min-h-4 items-center gap-[7px] truncate text-[11.5px] leading-4 ${
        bad ? "font-semibold text-destructive" : none ? "text-muted-foreground/70" : "text-muted-foreground"
      }`}
    >
      <span className="flex-none opacity-75">{icon}</span>
      <span className="truncate">{children}</span>
    </span>
  );
}

/** ป้ายบน ค่าล่าง — ข้อมูลกรอบเวลาบนแถบเอกสาร */
function LockLine({ label, value }: { label: string; value: string }) {
  return (
    <span className="flex flex-col gap-[3px] leading-[1.45]">
      <em className="text-[11px] whitespace-nowrap text-muted-foreground not-italic">{label}</em>
      <b className="num font-semibold whitespace-nowrap">{value}</b>
    </span>
  );
}

// ─── การ์ดรายละเอียดงานย่อย ──────────────────────────────────────

/*
 * สิ่งที่ต้องกรอกคือคนทำและวันเริ่ม-ส่ง ท้ายกล่องบอกสถานะพร้อมปุ่มเสร็จสิ้น (ตามต้นแบบ)
 * ตำแหน่งของงานใช้เตือนเวลาเลือกคนข้ามสาย — งานไม่มีตำแหน่งใช้ของเฟส ไม่มีทั้งคู่ก็ไม่เตือน
 */
function TaskDialog({
  phase,
  color,
  spot,
  task,
  count,
  onClose,
  onEdit,
  onDelete,
}: {
  phase: PlanPhase;
  color: string;
  spot: Spot;
  task: Draft;
  count: number;
  onClose: () => void;
  onEdit: (fn: (t: Draft) => void) => void;
  /** ลบงานนี้ออกจากแผน (เจ้าของสั่ง 29 ก.ย. 2569 — ของเดิมเพิ่มได้แต่เอาออกไม่ได้) */
  onDelete: () => void;
}) {
  const team = useTeam().filter((m) => !m.left);
  /* วันลาของทีม — อนุมัติแล้ว (ใบลาจริง + ทะเบียนฝ่ายบุคคล) และใบที่ยื่นไว้รออนุมัติ (ต้นแบบ PM_LEAVE_PENDING) */
  const clashOf = useLeaveClash();
  const leaveIn = (id: string) => clashOf(id, task.start, task.due).map(leaveText).join(" · ");
  /* รายชื่อปิดไว้เสมอตอนเปิดงาน กดปุ่มเองถึงจะเปิด (ตามต้นแบบ) */
  const [listOpen, setListOpen] = useState(false);
  const [pick, setPick] = useState<"s" | "e" | null>(null);
  /* ลบต้องกดสองครั้ง — ลบพลาดแล้วโจทย์กับไฟล์ที่แนบไว้หายไปด้วย */
  const [delAsk, setDelAsk] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const role = task.role ?? phase.role;
  const fits = (m: Member) => !role || m.roles.includes(role);
  const offFit = task.whos.filter((id) => {
    const m = memberOf(id);
    return m && !fits(m);
  }).length;
  const onLeave = task.whos.filter((id) => leaveIn(id)).length;

  function toggleWho(id: string) {
    onEdit((t) => {
      t.whos = t.whos.includes(id) ? t.whos.filter((x) => x !== id) : [...t.whos, id];
    });
  }

  /* เลือกจากรายชื่อ = แทนที่คนเดิม กดคนเดิมซ้ำ = เอาออก แล้วปิดรายการ (ต้นแบบ PLIST)
     มอบหมายหลายคนต่องานยังทำได้จากแถบมอบหมายพร้อมกันบนกระดาน */
  function pickWho(id: string) {
    onEdit((t) => {
      t.whos = t.whos.length === 1 && t.whos[0] === id ? [] : [id];
    });
    setListOpen(false);
  }

  const ready = task.whos.length > 0 && Boolean(task.start) && Boolean(task.due);

  return (
    <Sheet
      title={task.name}
      wide
      onClose={onClose}
      footer={
        <>
          <span
            className={`mr-auto self-center text-[12.5px] font-semibold ${
              ready ? "text-[var(--success)]" : "text-destructive"
            }`}
          >
            {ready ? "พร้อมมอบหมาย" : !task.whos.length ? "ยังไม่มีผู้รับผิดชอบ" : "ยังไม่ได้กำหนดวัน"}
          </span>
          <button
            type="button"
            className={`btn glass-thin ${delAsk ? "!border-destructive !text-destructive" : ""}`}
            title={
              task.from !== undefined
                ? "งานนี้อยู่ในโปรเจคจริงแล้ว ลบออกจากแผนแล้วงานและไฟล์ที่ส่งไว้จะหายไปด้วย"
                : "ลบงานนี้ออกจากแผน"
            }
            onClick={() => (delAsk ? onDelete() : setDelAsk(true))}
          >
            <TrashIcon className="size-[14px]" strokeWidth={2.2} />
            {delAsk ? "กดอีกครั้งเพื่อลบ" : "ลบงานนี้"}
          </button>
          <button type="button" className="btn solid btn-solid" onClick={onClose}>
            <CheckIcon className="size-[14px]" strokeWidth={2.3} />
            เสร็จสิ้น
          </button>
        </>
      }
    >
      <div onClick={() => setPick(null)}>
        <p className="text-[12px] text-muted-foreground" style={{ borderLeft: `3px solid ${color}`, paddingLeft: 8 }}>
          เฟส {phase.name} · ลำดับที่ {spot.index + 1} จาก {count}
        </p>

        <div className="mt-4 mb-[18px] flex flex-wrap gap-2">
          {role && (
            <span
              className="inline-flex items-center rounded-lg border px-[11px] py-[5px] text-xs font-semibold"
              style={{ background: `${color}1a`, color, borderColor: `${color}55` }}
            >
              {roleLabel(role)}
            </span>
          )}
          {task.whos.map((id) => {
            const name = memberOf(id)?.name ?? id;
            return (
              <span
                key={id}
                className="inline-flex items-center gap-[7px] rounded-lg border border-border bg-card px-[11px] py-[5px] text-xs font-semibold text-muted-foreground"
              >
                <span className="grid size-[17px] place-items-center rounded-[5px] bg-accent text-[8.5px] font-bold text-primary">
                  {initials(name)}
                </span>
                {name}
              </span>
            );
          })}
          {task.start && task.due && (
            <span className="num inline-flex items-center rounded-lg border border-border bg-card px-[11px] py-[5px] text-xs font-semibold text-muted-foreground">
              {thaiDate(task.start)} – {thaiDate(task.due)}
            </span>
          )}
        </div>

        {/* ── ผู้รับผิดชอบ ── */}
        <section>
          <h3 className="text-xs font-bold text-muted-foreground">ผู้รับผิดชอบ</h3>
          {offFit > 0 && (
            <p className="mt-1.5 text-[11.5px] font-semibold text-destructive">
              มี {offFit} คนที่ไม่ได้อยู่ตำแหน่ง “{role ? roleLabel(role) : ""}”
            </p>
          )}
          {onLeave > 0 && (
            /* ยังมอบหมายได้ แต่ให้รู้ก่อนว่างานจะช้าเพราะคนลา */
            <p className="mt-1.5 text-[11.5px] font-semibold text-[var(--warning)]">
              มี {onLeave} คนลาในช่วงวันของงานนี้
            </p>
          )}
          <div className="mt-2.5 flex flex-col gap-[7px]">
            {task.whos.map((id) => {
              const m = memberOf(id);
              if (!m) return null;
              return (
                <PersonRow key={id} member={m} fits={fits(m)} leave={leaveIn(id)}>
                  <button
                    type="button"
                    aria-label={`เอา ${m.name} ออก`}
                    onClick={() => toggleWho(id)}
                    className="grid size-6 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-[var(--destructive-soft)] hover:text-destructive"
                  >
                    <CloseIcon className="size-3.5" strokeWidth={2.4} />
                  </button>
                </PersonRow>
              );
            })}

            <button
              type="button"
              aria-expanded={listOpen}
              onClick={() => setListOpen((v) => !v)}
              className="flex h-[38px] w-full items-center justify-between rounded-[10px] border border-border bg-card px-3 text-[12.5px] font-semibold text-muted-foreground hover:border-primary hover:text-primary"
            >
              {task.whos.length ? "เปลี่ยนผู้รับผิดชอบ" : "เลือกผู้รับผิดชอบ"}
              <ChevronDownIcon className={`size-3.5 transition-transform ${listOpen ? "rotate-180" : ""}`} strokeWidth={2.4} />
            </button>

            {listOpen && (
              <div className="scroll-stable mt-1 flex max-h-[236px] flex-col gap-[7px] overflow-y-auto p-0.5">
                {team.map((m) => {
                  const on = task.whos.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => pickWho(m.id)}
                      aria-pressed={on}
                      className={`rounded-[14px] text-left ${on ? "ring-1 ring-primary" : ""}`}
                    >
                      <PersonRow member={m} fits={fits(m)} on={on} leave={leaveIn(m.id)}>
                        <span
                          className={`grid size-[22px] flex-none place-items-center rounded-full border-[1.6px] ${
                            on ? "border-primary bg-primary text-white" : "border-border text-transparent"
                          }`}
                        >
                          <CheckIcon className="size-3" strokeWidth={3} />
                        </span>
                      </PersonRow>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── วันเริ่มงานและกำหนดส่ง ── */}
        <section className="mt-5">
          <h3 className="text-xs font-bold text-muted-foreground">วันเริ่มงานและกำหนดส่ง</h3>
          <p className="mt-1.5 mb-2.5 text-[11.5px] text-muted-foreground">
            เลือกได้เฉพาะในกรอบเฟส{" "}
            <b className="num font-semibold text-foreground">
              {thaiDate(phase.start)} – {thaiDate(phase.end)}
            </b>
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">วันที่เริ่มต้น</p>
              <ThaiDatePicker
                variant="chip"
                value={task.start}
                min={phase.start}
                max={phase.end}
                open={pick === "s"}
                label="วันเริ่มงาน"
                placeholder="เลือกวันเริ่มงาน"
                onToggle={() => setPick((p) => (p === "s" ? null : "s"))}
                onPick={(iso) => {
                  onEdit((t) => {
                    t.start = iso;
                    if (t.due && t.due < iso) t.due = iso;
                  });
                  setPick(null);
                }}
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">วันที่สิ้นสุด</p>
              <ThaiDatePicker
                variant="chip"
                value={task.due}
                min={phase.start}
                max={phase.end}
                open={pick === "e"}
                label="วันส่งงาน"
                placeholder="เลือกวันส่งงาน"
                onToggle={() => setPick((p) => (p === "e" ? null : "e"))}
                onPick={(iso) => {
                  onEdit((t) => {
                    t.due = iso;
                    if (t.start && t.start > iso) t.start = iso;
                  });
                  setPick(null);
                }}
              />
            </div>
            <div>
              <p className="mb-1 text-[11px] text-muted-foreground">ระยะเวลา</p>
              <p className="num pt-1.5 text-[13px] font-semibold">
                {task.start && task.due ? `${daysBetween(task.start, task.due) + 1} วัน` : "—"}
              </p>
            </div>
          </div>
        </section>

        {/* ── โจทย์ที่ส่งให้คนทำ ──
            คนทำเห็นแค่ชื่องานกับกำหนดส่งไม่พอ ต้องได้โจทย์และไฟล์ประกอบไปด้วย
            ไม่งั้นต้องเดินมาถาม PM ทุกใบ (ผู้ใช้กำหนด 23 ก.ย. 2569) */}
        <section className="mt-5">
          <h3 className="text-xs font-bold text-muted-foreground">รายละเอียดงาน (โจทย์)</h3>
          <p className="mt-1.5 mb-2 text-[11.5px] text-muted-foreground">
            ข้อความนี้ขึ้นในหน้างานที่ได้รับของคนทำ · บันทึกเองทุกครั้งที่พิมพ์
          </p>
          <textarea
            value={task.brief ?? ""}
            onChange={(e) => {
              const v = e.target.value;
              onEdit((t) => {
                t.brief = v;
              });
            }}
            placeholder="บอกให้ชัดว่าต้องทำอะไร ส่งอะไร และมีอะไรที่ต้องระวัง"
            aria-label="รายละเอียดงาน"
            className="field-control h-[96px] resize-y py-2.5 leading-relaxed max-sm:h-[120px]"
          />

          <div className="mt-3.5 flex items-center justify-between gap-2.5">
            <h4 className="text-xs font-bold text-muted-foreground">ไฟล์ประกอบโจทย์</h4>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="btn glass-thin h-8 px-3 text-[12px] max-sm:h-10"
            >
              <PlusIcon className="size-3.5" strokeWidth={2.2} />
              แนบไฟล์
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            aria-label="เลือกไฟล์ประกอบโจทย์"
            onChange={(e) => {
              const added = pickedFiles(e.target.files);
              if (added.length) {
                onEdit((t) => {
                  t.files = [...(t.files ?? []), ...added];
                });
              }
              e.target.value = "";
            }}
          />
          {task.files?.length ? (
            <ul className="mt-2 flex flex-col gap-1.5">
              {task.files.map((f) => (
                <li
                  key={f.n}
                  className="flex items-center gap-2.5 rounded-[10px] border border-border bg-card px-3 py-2"
                >
                  <FileIcon className="size-3.5 flex-none text-muted-foreground" strokeWidth={2} />
                  <span className="min-w-0 flex-1">
                    <b className="block truncate text-[12.5px] font-semibold">{f.n}</b>
                    <em className="num block text-[11px] text-muted-foreground not-italic">
                      {fileKindLabel(f.n, f.k)} · {f.sz}
                    </em>
                  </span>
                  {f.fileId && (
                    <button
                      type="button"
                      className="btn glass-thin h-7 flex-none px-2.5 text-[11.5px] max-sm:h-9"
                      onClick={() => void openStoredFile(f.fileId!)}
                    >
                      เปิด
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label={`เอาไฟล์ ${f.n} ออก`}
                    onClick={() => {
                      if (f.fileId) void removeStoredFile(f.fileId);
                      onEdit((t) => {
                        t.files = (t.files ?? []).filter((x) => x.n !== f.n);
                      });
                    }}
                    className="grid size-7 flex-none place-items-center rounded-lg text-muted-foreground hover:bg-[var(--destructive-soft)] hover:text-destructive max-sm:size-9"
                  >
                    <CloseIcon className="size-3.5" strokeWidth={2.4} />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-[12px] text-muted-foreground">
              ยังไม่มีไฟล์แนบ — แนบแบบ ภาพตัวอย่าง หรือข้อมูลที่คนทำต้องใช้ได้
            </p>
          )}
          {/* ไฟล์เก็บอยู่ในเครื่องผู้ใช้ (IndexedDB) · ต่อ backend แล้วย้ายไปอัปโหลดขึ้น storage จริง */}
        </section>
      </div>
    </Sheet>
  );
}

/*
 * ไฟล์ที่เพิ่งเลือกจากเครื่อง → รายการไฟล์ของงาน
 * เก็บไบต์ไว้ในเครื่อง (file-store · IndexedDB) ด้วย คนทำงานจะได้กดเปิดไฟล์โจทย์ได้จริง ไม่ใช่เห็นแค่ชื่อ
 */
function pickedFiles(list: FileList | null): TaskFile[] {
  if (!list) return [];
  const at = todayIso();
  return Array.from(list).map((f) => {
    const fileId = `tf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    void putFile(fileId, f);
    return {
      n: f.name,
      k: fileKind(f.name),
      sz: fileSize(f.size),
      at,
      by: "PM",
      fileId,
    };
  });
}

/** แถวคนหนึ่งคน — ชื่อ ตำแหน่ง และงานที่ถืออยู่ ใช้ทั้งในรายการที่เลือกแล้วและรายชื่อทีม */
function PersonRow({
  member,
  fits,
  on,
  leave = "",
  children,
}: {
  member: Member;
  fits: boolean;
  on?: boolean;
  /** ลาที่ทับช่วงวันของงาน (อนุมัติแล้วหรือรออนุมัติ) เป็นข้อความพร้อมแสดง */
  leave?: string;
  children?: React.ReactNode;
}) {
  /* งานที่ถืออยู่ต้องนับจากโปรเจคจริง — ตัวเลข load ในทะเบียนเป็นค่าคงที่ คนที่เข้าทีมใหม่ติดอยู่ที่ 0 ตลอด */
  const projects = usePm().projects;
  return (
    <span
      className={`flex w-full items-center gap-[13px] rounded-[14px] border px-3.5 py-[11px] ${
        on ? "border-primary bg-accent" : "border-border bg-white hover:border-primary"
      }`}
    >
      <span className="grid size-11 flex-none place-items-center rounded-[13px] bg-accent text-sm font-bold text-primary">
        {initials(member.name)}
      </span>
      <span className="min-w-0 flex-1">
        <b className="block truncate text-[14.5px] font-bold">{member.name}</b>
        {/* คนที่ไม่ได้อยู่ตำแหน่งของเฟสนี้ขึ้นแดง ยังเลือกได้แต่ให้รู้ตัวว่ากำลังเลือกข้ามตำแหน่ง */}
        <span
          className={`mt-0.5 block truncate text-[11.5px] ${fits ? "text-muted-foreground" : "text-destructive"}`}
        >
          {member.roles.map(roleLabel).join(" | ")}
        </span>
      </span>
      {leave && (
        <span
          title={leave}
          className="num max-w-[190px] flex-none truncate rounded-[20px] bg-[var(--warning-soft)] px-[9px] py-[3px] text-[11px] font-semibold text-[var(--warning)]"
        >
          {leave}
        </span>
      )}
      <span className="num flex-none rounded-[20px] bg-muted px-[9px] py-[3px] text-[11px] font-semibold text-muted-foreground">
        {openTaskCount(projects, member.id)} งาน
      </span>
      {children}
    </span>
  );
}


// ─── ตัวช่วยของหน้านี้ ────────────────────────────────────────────

/** ช่วงลาหนึ่งช่วงของคนในทีม — pending = ใบที่ยื่นไว้แต่ยังไม่อนุมัติ */
type TeamLeave = { from: string; to: string; type: string; pending: boolean };

const TH_MON = ["ม.ค.", "ก.พ.", "มี.ค.", "เม.ย.", "พ.ค.", "มิ.ย.", "ก.ค.", "ส.ค.", "ก.ย.", "ต.ค.", "พ.ย.", "ธ.ค."];

/** "ลากิจ 11 ก.ย. (รออนุมัติ)" · หลายวัน "ลาพักร้อน 21–25 ก.ย." (ต้นแบบ leaveText) */
function leaveText(l: TeamLeave) {
  const [, m1, d1] = l.from.split("-").map(Number);
  const [, m2, d2] = l.to.split("-").map(Number);
  const rng =
    l.from === l.to
      ? `${d1} ${TH_MON[m1 - 1]}`
      : m1 === m2
        ? `${d1}–${d2} ${TH_MON[m1 - 1]}`
        : `${d1} ${TH_MON[m1 - 1]} – ${d2} ${TH_MON[m2 - 1]}`;
  return `${l.type} ${rng}${l.pending ? " (รออนุมัติ)" : ""}`;
}

/*
 * วันลาของทีม: ลาที่อนุมัติแล้วจากฝ่ายบุคคล และใบลาที่ยื่นไว้รออนุมัติ (ต้นแบบ PM_LEAVE_TIME + PM_LEAVE_PENDING)
 *   อนุมัติแล้ว — useHrTime (ทะเบียน + ใบลาจริงของบทบาทที่ล็อกอินได้) รวมวันติดกันเป็นช่วงเดียว
 *   รออนุมัติ — ใบของบทบาทใน leave-store และคำขอของพนักงานใน emp-requests
 *   คำขอของพนักงานที่อนุมัติแล้วยังไม่ไหลเข้าทะเบียน จึงนับจาก emp-requests ด้วย
 * คืนฟังก์ชันหาลาที่ทับช่วงงาน — งานที่ยังไม่กำหนดวันไม่เตือน
 */
function useLeaveClash() {
  const time = useHrTime();
  const extra = useEmpRequests();
  const byRole = useAllLeave();
  return useCallback(
    (id: string, start: string, due: string): TeamLeave[] => {
      if (!start || !due) return [];
      const out: TeamLeave[] = [];
      const days = [...(time[id]?.leave ?? [])].sort((a, b) => a.d.localeCompare(b.d));
      for (const l of days) {
        const type = HR_LEAVE_LABEL[l.type as keyof typeof HR_LEAVE_LABEL] ?? "ลา";
        const last = out[out.length - 1];
        if (last && last.type === type && addDays(last.to, 1) === l.d) last.to = l.d;
        else out.push({ from: l.d, to: l.d, type, pending: false });
      }
      for (const r of extra) {
        if (r.emp !== id || r.kind !== "leave" || r.status === "rejected" || !r.from) continue;
        out.push({ from: r.from, to: r.toDate || r.from, type: r.leaveType ?? "ลา", pending: r.status === "pending" });
      }
      for (const [role, emp] of Object.entries(ROLE_EMPLOYEE)) {
        if (emp !== id) continue;
        for (const v of byRole[role as Role] ?? []) {
          if (v.status === "รอการอนุมัติ") out.push({ from: v.date, to: v.toDate, type: v.type, pending: true });
        }
      }
      return out.filter((l) => l.from <= due && l.to >= start);
    },
    [time, extra, byRole],
  );
}

/** กระดานตั้งต้นจากข้อเสนอ — งานที่ไม่มีข้อเสนอเริ่มจากกระดานว่าง */
function blankBoard(job: InboxJob): Board {
  return {
    phases: job.phases.map((ph) => ({ name: ph.name, role: ph.role, start: ph.start, end: ph.end })),
    plan: job.phases.map((ph) =>
      ph.tasks.map((name) => ({ name, role: ph.role, whos: [], start: "", due: "" })),
    ),
  };
}

function cloneBoard(b: Board): Board {
  return {
    phases: b.phases.map((ph) => ({ ...ph })),
    plan: b.plan.map((list) => list.map((t) => ({ ...t, whos: [...t.whos], files: t.files?.map((f) => ({ ...f })) }))),
  };
}

function key(phase: number, index: number) {
  return `${phase}:${index}`;
}

function at(plan: Draft[][], k: string) {
  const [p, i] = k.split(":").map(Number);
  return plan[p]?.[i];
}

/** จำนวนงานที่ยังไม่ปิดของคนหนึ่งคน นับจากทุกโปรเจคที่ยังเดินอยู่ */
function openTaskCount(projects: Project[], id: string) {
  let n = 0;
  for (const p of projects) {
    if (p.status !== "running") continue;
    for (const t of p.tasks) if (t.status !== "done" && t.whos.includes(id)) n += 1;
  }
  return n;
}
