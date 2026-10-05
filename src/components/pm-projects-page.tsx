"use client";

/*
 * รายการโปรเจค — โปรเจคที่ยืนยันแผนงานแล้วทั้งหมด แสดงเป็นโฟลเดอร์
 *
 * เป็นโฟลเดอร์ไม่ใช่ตาราง เพราะหน้านี้มีหน้าที่เดียวคือ "หาโปรเจคแล้วเปิด"
 * รายละเอียดทุกอย่างอยู่ในหน้าโปรเจคแล้ว ตรงนี้จึงเหลือแค่ชื่อลูกค้า สถานะ และความคืบหน้า
 * พอให้เลือกถูกใบ โดยไม่ต้องอ่านทั้งแถว
 *
 * ตัวกรองเป็นปุ่มพร้อมจำนวน ไม่ใช่ดรอปดาวน์ เพราะมีแค่สี่แบบ
 * และจำนวนบนปุ่มตอบได้ทันทีว่ามีโปรเจคเลยกำหนดกี่ใบ โดยไม่ต้องกดเข้าไปดู
 */

import Link from "next/link";
import { useState } from "react";
import { daysBetween, thaiStamp, todayIso } from "@/lib/format";
import { projName, projectProgress, type InboxJob, type Project } from "@/lib/pm-data";
import { usePm, type PlanDraft } from "@/lib/pm-store";
import { ReadOnlyNote } from "./pm-readonly";
import { useRole } from "@/lib/role";
import { USERS } from "@/lib/mock-data";
import { SearchIcon } from "./icons";
import { NewProjectButton } from "./project-new-page";

type FolderKey = "all" | "plan" | "run" | "late" | "done" | "cancelled";

/*
 * โปรเจคในหน้านี้มาจากสองที่ (ตามต้นแบบ pm-projects.html)
 *   1) pm.projects — วางแผนเสร็จแล้ว มีเฟสและงานย่อยครบ
 *   2) pm.inbox ที่ stage = plan — รับงานแล้วแต่ยังไม่ยืนยันแผน ต้องเห็นตรงนี้ด้วย
 *      ไม่งั้นรับงานแล้วงานจะหายไปจากสายตา กดแล้วพาไปหน้าวางแผน
 */
type Item = { kind: "project"; p: Project } | { kind: "plan"; j: InboxJob };

/* สีโฟลเดอร์ตามโทนของโปรเจค — แยกใบที่อยู่ติดกันออกจากกันด้วยสายตา ไม่ได้บอกสถานะ
   สถานะบอกด้วยจุดสีใต้ชื่อแทน จะได้ไม่มีสองความหมายซ้อนอยู่ในสีเดียวกัน */
const FOLDER_TONE: Record<Project["tone"] | "d", { back: string; front: string }> = {
  /* งานรอวางแผนเป็นโฟลเดอร์สีเทา แยกจากโปรเจคที่เดินงานแล้ว */
  d: { back: "#D9DCE1", front: "#B4BAC3" },
  a: { back: "#C7D4F2", front: "#8FA6E8" },
  b: { back: "#F6C9D9", front: "#E98BB0" },
  c: { back: "#BFE6D2", front: "#7FCFA7" },
};

export function PmProjectsPage() {
  const pm = usePm();
  const today = todayIso();
  /*
   * SA เปิดหน้านี้ได้เฉพาะโปรเจคที่รับโอนมาเป็นเจ้าของ (Proposal · PM — Transfer Project)
   * โปรเจคของคนอื่นไม่ใช่เรื่องของ SA จึงกรองตั้งแต่ต้นทาง ไม่ใช่ซ่อนแค่บนหน้าจอ
   */
  const role = useRole();
  const mine = role === "ps" ? USERS.ps.name : "";
  const [folder, setFolder] = useState<FolderKey>("all");
  const [query, setQuery] = useState("");

  /* เลยกำหนด = ยังไม่ส่งมอบ และวันนี้เลยวันกำหนดส่งไปแล้ว (งานรอวางแผนไม่นับ)
     ตัวเลขบนปุ่มทุกปุ่มในหน้านี้นับเป็น "โปรเจค" ไม่ใช่ใบงานย่อย — ชื่อปุ่มจึงบอกหน่วยไว้ด้วย
     เพราะแดชบอร์ด PM มีการ์ด "งานย่อยล่าช้า" ที่นับใบงาน ไม่ใช่โปรเจค */
  const late = (x: Item) =>
    x.kind === "project" && x.p.status === "running" && daysBetween(x.p.due, today) > 0;

  /* ส่งมอบแล้วแต่ยังมีงานย่อยค้าง — งานที่ยังไม่เสร็จก็ยังเป็นงานของใครสักคน ต้องเห็นจากหน้ารายการ */
  const openLeft = (p: Project) => p.tasks.filter((t) => t.status !== "done").length;

  const items: Item[] = [
    ...pm.projects.filter((p) => !mine || p.pm === mine).map((p) => ({ kind: "project" as const, p })),
    /* งานที่ยังรอวางแผนเป็นของ PM ที่รับงานเข้ามา ยังไม่มีเจ้าของโปรเจค จึงไม่ใช่ของ SA */
    ...(mine
      ? []
      : pm.inbox
          .filter((j) => j.stage === "plan" && !pm.projects.some((p) => p.deal === j.deal))
          .map((j) => ({ kind: "plan" as const, j }))),
  ];

  const folders: { key: FolderKey; name: string; test: (x: Item) => boolean }[] = [
    { key: "all", name: "ทุกโปรเจค", test: () => true },
    { key: "plan", name: "รอวางแผน", test: (x) => x.kind === "plan" },
    { key: "run", name: "กำลังดำเนินการ", test: (x) => x.kind === "project" && x.p.status === "running" && !late(x) },
    { key: "late", name: "โปรเจคเลยกำหนด", test: late },
    { key: "done", name: "ส่งมอบแล้ว", test: (x) => x.kind === "project" && x.p.status === "done" },
    /* ดีลถูกยกเลิกหลังปิดการขาย — เก็บไว้ดูย้อนหลัง งานหยุดแล้ว */
    { key: "cancelled", name: "ยกเลิก", test: (x) => x.kind === "project" && x.p.status === "cancelled" },
  ];
  const active = folders.find((f) => f.key === folder) ?? folders[0];

  const q = query.trim().toLowerCase();
  const rows = items.filter((x) => {
    if (!active.test(x)) return false;
    const r = x.kind === "project" ? x.p : x.j;
    return !q || `${projName(r)} ${r.cus} ${r.deal} ${r.scope} ${r.quo}`.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-4">
      <div className="bar">
        <div className="max-sm:hidden">
          <p>
            {mine
              ? "โปรเจคที่ PM โอนมาให้ดูแล ดูแผนงาน ความคืบหน้า และพูดคุยกันในทีม"
              : "โปรเจคที่วางแผนแล้ว ดูแผนงาน ความคืบหน้า และพูดคุยกันในทีม"}
          </p>
        </div>
        <div className="tools w-full sm:w-auto">
          <span className="search glass-thin w-full sm:w-[300px]">
            <SearchIcon className="size-[15px] shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ค้นหาลูกค้า เลขที่ดีล หรือขอบเขตงาน"
              aria-label="ค้นหาโปรเจค"
              autoComplete="off"
            />
          </span>
          {/* โปรเจคที่ไม่ได้มาจากดีล เช่นงานภายใน ตั้งเองได้จากที่นี่ (ต้นแบบ project-new.html) */}
          {!mine && <NewProjectButton />}
        </div>
      </div>
      <ReadOnlyNote />

      {/* ตัวกรองสถานะขึ้นบรรทัดใหม่เมื่อไม่พอ — ไม่ปัดข้าง (เจ้าของสั่ง 25 ก.ย. 2569)
          ตัวกรองที่อยู่นอกจอเท่ากับไม่มี เพราะไม่มีอะไรบอกว่าเลื่อนต่อได้ */}
      <div
        /* มือถือ: ชิปแถวเดียวเลื่อนข้าง (ต้นแบบ pm-projects.html บล็อก pj-mobile 1 ต.ค. 2569) */
        className="chip-scroll flex gap-2 max-sm:-mx-4 max-sm:flex-nowrap max-sm:overflow-x-auto max-sm:px-4 sm:flex-wrap"
        role="group"
        aria-label="กรองตามสถานะโปรเจค"
      >
        {folders.map((f) => {
          const on = f.key === folder;
          return (
            <button
              key={f.key}
              type="button"
              aria-pressed={on}
              onClick={() => setFolder(f.key)}
              className={`inline-flex h-[34px] items-center gap-2 rounded-[20px] border px-[15px] text-[13px] font-semibold max-sm:h-[38px] max-sm:flex-none max-sm:border-0! max-sm:whitespace-nowrap ${
                on
                  ? "border-primary bg-accent text-primary max-sm:bg-primary! max-sm:text-primary-foreground!"
                  : "border-border bg-card text-muted-foreground hover:border-primary hover:text-primary max-sm:bg-[#EDE8EA]! max-sm:text-[#6E6164]!"
              }`}
            >
              {f.name}
              <b className={`num text-[11px] font-bold ${on ? "text-primary" : "text-muted-foreground"}`}>
                {items.filter(f.test).length}
              </b>
            </button>
          );
        })}
      </div>

      <section>
        <p className="mb-3 flex items-center gap-2.5 text-[15px] font-bold max-sm:hidden">
          โปรเจค (นับเป็นโปรเจค ไม่ใช่ใบงานย่อย)
          <b className="num rounded-[20px] bg-muted px-2.5 py-0.5 text-[11px] font-bold text-muted-foreground">
            {rows.length}
          </b>
        </p>
        {rows.length === 0 ? (
          <p className="p-10 text-center text-[13px] text-muted-foreground">ไม่พบโปรเจคที่ตรงกับเงื่อนไข</p>
        ) : (
          <div className="grid gap-2.5 max-sm:grid-cols-1! [grid-template-columns:repeat(auto-fill,minmax(168px,1fr))]">
            {rows.map((x) =>
              x.kind === "project" ? (
                <Folder key={x.p.deal} project={x.p} today={today} late={late(x)} left={openLeft(x.p)} />
              ) : (
                <PlanFolder key={x.j.deal} job={x.j} draft={pm.drafts[x.j.deal]} />
              ),
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function Folder({
  project: p,
  today,
  late,
  left,
}: {
  project: Project;
  today: string;
  late: boolean;
  /** งานย่อยที่ยังไม่เสร็จ — ใช้เตือนโปรเจคที่ปิดว่าส่งมอบแล้วแต่ยังมีงานค้าง */
  left: number;
}) {
  const pr = projectProgress(p);
  const tone = FOLDER_TONE[p.tone] ?? FOLDER_TONE.a;
  const status =
    p.status === "cancelled"
      ? { text: "ยกเลิก", dot: "var(--muted-foreground)" }
      : p.status === "done"
      ? { text: left ? `ส่งมอบแล้ว · ค้าง ${left} งาน` : "ส่งมอบแล้ว", dot: left ? "var(--destructive)" : "var(--success)" }
      : late
        ? { text: `เลยกำหนด ${daysBetween(p.due, today)} วัน`, dot: "var(--destructive)" }
        : { text: "กำลังดำเนินการ", dot: "var(--info)" };

  return (
    <Link
      href={`/pm/projects?deal=${encodeURIComponent(p.deal)}`}
      title={`${projName(p)} · ${p.cus}`}
      className="flex flex-col items-center gap-0.5 rounded-[14px] px-2.5 pt-[18px] pb-4 text-center transition-colors hover:bg-black/[.045] max-sm:block max-sm:rounded-[20px] max-sm:bg-card max-sm:p-3.5 max-sm:text-left max-sm:shadow-[0_1px_2px_rgb(40_20_25/0.04)] max-sm:active:bg-muted"
    >
      <PhoneRow
        name={projName(p)}
        cus={p.cus}
        status={status}
        foot={
          p.status === "cancelled" ? (
            <em className="text-[12.5px] text-muted-foreground not-italic">{p.cancelled?.why || "ยกเลิกแล้ว"}</em>
          ) : (
            <>
              <span className="block h-2 w-full overflow-hidden rounded-full bg-muted">
                <i className="block h-full rounded-full bg-primary" style={{ width: `${pr.pct}%` }} />
              </span>
              <em className="num flex justify-between text-[12.5px] text-muted-foreground not-italic">
                <span>{pr.pct}%</span>
                <span>
                  {pr.done} จาก {pr.all} งาน
                </span>
              </em>
            </>
          )
        }
      />

      <span className="contents max-sm:hidden">
      <FolderIcon tone={tone} />
      {/* ชื่อโปรเจคเป็นหัว ลูกค้าเป็นบรรทัดรอง (PM-BR-03) */}
      <b className="mt-[9px] line-clamp-2 max-w-full text-[13.5px] leading-snug font-bold">{projName(p)}</b>
      <em className="max-w-full truncate text-[11px] text-muted-foreground not-italic">{p.cus}</em>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <i className="inline-block size-1.5 flex-none rounded-full" style={{ background: status.dot }} />
        {status.text}
      </span>
      {p.status === "cancelled" ? (
        /* ยกเลิกแล้วไม่มีความคืบหน้าให้ดู — บอกเหตุผลที่ยกเลิกแทน (ตามต้นแบบ) */
        <em className="mt-[7px] line-clamp-2 max-w-full text-[10.5px] text-muted-foreground not-italic">
          {p.cancelled?.why || "ยกเลิกแล้ว"}
        </em>
      ) : (
        <span className="mt-[7px] flex w-full max-w-[118px] flex-col items-center gap-1">
          <span className="block h-1 w-full overflow-hidden rounded bg-muted">
            <i className="block h-full rounded bg-primary" style={{ width: `${pr.pct}%` }} />
          </span>
          <em className="num text-[10.5px] text-muted-foreground not-italic">
            {pr.pct}% · {pr.done} จาก {pr.all} งาน
          </em>
        </span>
      )}
      </span>
    </Link>
  );
}

/*
 * การ์ดบนมือถือ — ไอคอนกลม ชื่อโปรเจค ลูกค้า ป้ายสถานะขวา เส้นประคั่น แล้วแถบความคืบหน้าเต็มกว้าง
 * (ต้นแบบ pm-projects.html บล็อก pj-mobile 1 ต.ค. 2569)
 */
function PhoneRow({
  name,
  cus,
  status,
  foot,
}: {
  name: string;
  cus: string;
  status: { text: string; dot: string };
  foot: React.ReactNode;
}) {
  return (
    <span className="block sm:hidden">
      <span className="flex items-start gap-3">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-[#E8F0FC] text-[#1A5DB5]">
          <FolderGlyph />
        </span>
        <span className="min-w-0 flex-1">
          <b className="block text-[15px] leading-snug font-bold">{name}</b>
          <em className="block truncate text-[12.5px] text-muted-foreground not-italic">{cus}</em>
        </span>
        <span className="flex flex-none items-center gap-1.5 rounded-full bg-[#F3EEF0] px-2.5 py-[3px] text-[11.5px] font-bold whitespace-nowrap text-[#6E6164]">
          <i className="inline-block size-1.5 flex-none rounded-full" style={{ background: status.dot }} />
          {status.text}
        </span>
      </span>
      <span className="my-3 block border-t border-dashed border-[#ECE3E5]" />
      <span className="flex flex-col gap-1.5">{foot}</span>
    </span>
  );
}

function FolderGlyph() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  );
}

/** งานที่รับแล้วแต่ยังไม่ยืนยันแผน — ยังไม่มีอะไรให้ดูในหน้ารายละเอียด จึงพาไปวางแผนเลย */
function PlanFolder({ job: j, draft }: { job: InboxJob; draft?: PlanDraft }) {
  return (
    <Link
      href={`/pm/plan?deal=${encodeURIComponent(j.deal)}`}
      title={`${projName(j)} · ${j.cus}`}
      className="flex flex-col items-center gap-0.5 rounded-[14px] px-2.5 pt-[18px] pb-4 text-center transition-colors hover:bg-black/[.045] max-sm:block max-sm:rounded-[20px] max-sm:bg-card max-sm:p-3.5 max-sm:text-left max-sm:shadow-[0_1px_2px_rgb(40_20_25/0.04)] max-sm:active:bg-muted"
    >
      <PhoneRow
        name={projName(j)}
        cus={j.cus}
        status={{ text: j.phases.length ? "ยังไม่ยืนยันแผน" : "ยังไม่มีแผนงาน", dot: "var(--warning)" }}
        foot={
          <em className="text-[12.5px] font-semibold text-primary not-italic">
            {draft ? `มีร่างแผน · แก้ล่าสุด ${thaiStamp(draft.at)}` : "กดเพื่อไปวางแผนงาน"}
          </em>
        }
      />

      <span className="contents max-sm:hidden">
      <FolderIcon tone={FOLDER_TONE.d} />
      <b className="mt-[9px] line-clamp-2 max-w-full text-[13.5px] leading-snug font-bold">{projName(j)}</b>
      <em className="max-w-full truncate text-[11px] text-muted-foreground not-italic">{j.cus}</em>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <i className="inline-block size-1.5 flex-none rounded-full bg-[var(--warning)]" />
        {j.phases.length ? "ยังไม่ยืนยันแผน" : "ยังไม่มีแผนงาน"}
      </span>
      {/* ร่างที่ PM กรอกค้างไว้ — คนอื่นต้องเห็นว่ามีร่างอยู่ ไม่ใช่เห็นแค่ว่ายังไม่ยืนยัน */}
      {draft ? (
        <em className="mt-[7px] text-[10.5px] font-semibold text-[var(--warning)] not-italic">
          มีร่างแผน · แก้ล่าสุด {thaiStamp(draft.at)}
        </em>
      ) : (
        <em className="mt-[7px] text-[10.5px] font-semibold text-primary not-italic">กดเพื่อไปวางแผนงาน</em>
      )}
      </span>
    </Link>
  );
}

function FolderIcon({ tone }: { tone: { back: string; front: string } }) {
  return (
    <svg viewBox="0 0 64 52" width="76" height="62" aria-hidden="true" className="block">
      <path
        fill={tone.back}
        d="M2 8a6 6 0 0 1 6-6h16l6 7h26a6 6 0 0 1 6 6v31a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6Z"
      />
      <path fill={tone.front} d="M2 17h60v25a6 6 0 0 1-6 6H8a6 6 0 0 1-6-6Z" />
    </svg>
  );
}
