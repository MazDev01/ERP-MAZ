"use client";

/*
 * โปรเจคใหม่ — ต้นแบบ dose-erp-maz/project-new.html
 *
 * สามส่วนในหน้าเดียว: แผนงาน (เฟส/งานย่อย) · ไฟล์และรูป · ข้อมูลโปรเจคกับบันทึก
 * ไม่มีปุ่มบันทึก แก้อะไรก็บันทึกร่างทันที (กติกาเดียวกับหน้าวางแผนงาน)
 * มือถือสลับดูทีละส่วนด้วยแถบ 3 ปุ่ม เพราะวางเรียงกันทั้งหมดจะเลื่อนยาวเกินไป
 */

import Link from "next/link";
import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useHydrated } from "@/lib/pwa";
import { thaiDate } from "@/lib/format";
import {
  addFiles,
  extOf,
  fileSize,
  isImage,
  listFiles,
  removeFile,
  type ProjectFile,
} from "@/lib/project-files";
import {
  addPhase,
  addTask,
  patchTask,
  planCount,
  removePhase,
  removeTask,
  renamePhase,
  setField,
  useNewProject,
  type NewPhase,
} from "@/lib/project-new-store";
import {
  CameraIcon,
  CheckIcon,
  ChevronLeftIcon,
  CloseIcon,
  DownloadIcon,
  PlusIcon,
  TasksIcon,
  TrashIcon,
  UploadIcon,
} from "./icons";
import { Field } from "./lead-dialogs";

type Pane = "plan" | "files" | "info";
/** ไฟล์หนึ่งรายการบนจอ — ตัวไฟล์กับที่อยู่ชั่วคราวที่ใช้แสดงและดาวน์โหลด */
type Shown = { f: ProjectFile; url: string };
type Filter = "all" | "img" | "doc";

export function ProjectNewPage() {
  /* ร่างอยู่ใน localStorage — รอ hydrate ก่อน ไม่งั้นฝั่งเซิร์ฟเวอร์เห็นร่างเปล่าแล้วค้าง */
  return useHydrated() ? <Body /> : null;
}

function Body() {
  const project = useNewProject();
  const count = planCount(project);
  const [pane, setPane] = useState<Pane>("plan");
  /* บอกว่าบันทึกร่างแล้ว — ไม่มีปุ่มบันทึก ผู้ใช้จึงต้องเห็นว่าของที่พิมพ์ไม่หาย */
  const [saved, setSaved] = useState("");
  const savedTimer = useRef<number | undefined>(undefined);

  function touch() {
    setSaved("บันทึกแล้ว");
    window.clearTimeout(savedTimer.current);
    savedTimer.current = window.setTimeout(() => setSaved(""), 1600);
  }
  useEffect(() => () => window.clearTimeout(savedTimer.current), []);

  const card = "panel glass rounded-2xl px-4 py-5 sm:px-6";
  const paneClass = (p: Pane) => (pane === p ? "" : "max-md:hidden!");

  return (
    <div className="space-y-4">
      <div className="bar">
        <div className="min-w-0 flex-1">
          <Link href="/pm/projects" className="btn glass-thin btn-mini mb-1.5">
            <ChevronLeftIcon className="size-3.5" strokeWidth={2.4} />
            โปรเจค
          </Link>
          {/* ชื่อโปรเจคเป็นหัวเรื่องที่พิมพ์ทับได้เลย ตามต้นแบบ */}
          <div className="flex flex-wrap items-center gap-2.5">
            <input
              value={project.name}
              onChange={(e) => {
                setField("name", e.target.value);
                touch();
              }}
              placeholder="ตั้งชื่อโปรเจค"
              aria-label="ชื่อโปรเจค"
              maxLength={120}
              className="min-w-0 flex-1 border-b-2 border-transparent bg-transparent py-1 text-[23px] font-bold outline-none placeholder:text-muted-foreground focus:border-primary sm:text-[26px]"
            />
            <span className="tag t-miss shrink-0">ร่าง</span>
          </div>
          <p className="mt-1">
            วางแผนงานเป็นเฟส และเก็บรูปหรือไฟล์ของโปรเจคไว้ที่เดียว
            {saved && <b className="ml-2 font-semibold text-[var(--success)]">· {saved}</b>}
          </p>
        </div>
      </div>

      {/* มือถือ: สลับดูทีละส่วน */}
      <div className="grid grid-cols-3 gap-1 rounded-2xl bg-muted p-1 md:hidden">
        {(
          [
            ["plan", "แผนงาน"],
            ["files", "ไฟล์และรูป"],
            ["info", "ข้อมูล"],
          ] as [Pane, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setPane(key)}
            aria-pressed={pane === key}
            className={`h-10 rounded-xl text-[14px] font-semibold ${
              pane === key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="space-y-4">
          <section className={`${card} ${paneClass("plan")}`}>
            <div className="mb-3.5 flex items-center gap-2.5">
              <h2 className="text-base font-bold">แผนงาน</h2>
              {count.phases > 0 && (
                <span className="ml-auto text-[12.5px] text-muted-foreground">
                  {count.phases} เฟส {count.tasks} งาน
                </span>
              )}
            </div>

            {count.tasks > 0 && (
              <div className="mb-3.5 flex items-center gap-2.5">
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                  <i className="block h-full rounded-full bg-primary" style={{ width: `${count.pct}%` }} />
                </span>
                <b className="num min-w-10 text-right text-[13px]">{count.pct}%</b>
              </div>
            )}

            {project.phases.map((phase, i) => (
              <PhaseCard key={phase.id} phase={phase} index={i} onChange={touch} />
            ))}

            {project.phases.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 px-3 py-6 text-center">
                <TasksIcon className="size-11 text-muted-foreground/50" strokeWidth={1.6} />
                <b className="text-[15px] font-bold">ยังไม่มีแผนงาน</b>
                <p className="max-w-[34ch] text-[13px] text-muted-foreground">
                  เริ่มจากเพิ่มเฟสแรก เช่น เก็บความต้องการ ออกแบบ หรือติดตั้ง แล้วใส่งานย่อยในแต่ละเฟส
                </p>
                <button
                  type="button"
                  className="btn solid btn-solid mt-2"
                  onClick={() => {
                    addPhase();
                    touch();
                  }}
                >
                  เพิ่มเฟสแรก
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="h-11 w-full rounded-[14px] border-[1.5px] border-dashed border-border font-bold text-muted-foreground hover:border-primary hover:text-primary"
                onClick={() => {
                  addPhase();
                  touch();
                }}
              >
                + เพิ่มเฟส
              </button>
            )}
          </section>

          <section className={`${card} ${paneClass("info")}`}>
            <h2 className="mb-3.5 text-base font-bold">บันทึก</h2>
            <textarea
              className="field-control h-auto min-h-24 py-2.5 leading-relaxed"
              value={project.note}
              onChange={(e) => {
                setField("note", e.target.value);
                touch();
              }}
              rows={5}
              aria-label="บันทึกของโปรเจค"
              placeholder="จดสิ่งที่ตกลงกับลูกค้า ข้อจำกัด หรือเรื่องที่ทีมต้องรู้"
            />
          </section>
        </div>

        <div className="space-y-4">
          <FilesCard className={`${card} ${paneClass("files")}`} />

          <section className={`${card} ${paneClass("info")}`}>
            <h2 className="mb-3.5 text-base font-bold">ข้อมูลโปรเจค</h2>
            <div className="grid gap-3.5 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Field label="ลูกค้า">
                  <input
                    className="field-control"
                    value={project.cus}
                    onChange={(e) => {
                      setField("cus", e.target.value);
                      touch();
                    }}
                    placeholder="ชื่อลูกค้าหรือบริษัท"
                    autoComplete="off"
                  />
                </Field>
              </div>
              <Field label="วันเริ่ม">
                <input
                  className="field-control"
                  type="date"
                  value={project.start}
                  onChange={(e) => {
                    setField("start", e.target.value);
                    touch();
                  }}
                />
              </Field>
              <Field label="กำหนดส่งมอบ" hint={project.due ? thaiDate(project.due) : undefined}>
                <input
                  className="field-control"
                  type="date"
                  value={project.due}
                  onChange={(e) => {
                    setField("due", e.target.value);
                    touch();
                  }}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label="ขอบเขตงาน">
                  <textarea
                    className="field-control h-auto min-h-20 py-2.5 leading-relaxed"
                    value={project.desc}
                    onChange={(e) => {
                      setField("desc", e.target.value);
                      touch();
                    }}
                    rows={3}
                    placeholder="สรุปสิ่งที่จะส่งมอบให้ลูกค้า"
                  />
                </Field>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/** เฟสหนึ่งเฟสพร้อมงานย่อย — ชื่อเฟสและชื่องานพิมพ์ทับได้เลย */
function PhaseCard({ phase, index, onChange }: { phase: NewPhase; index: number; onChange: () => void }) {
  const [adding, setAdding] = useState("");
  const done = phase.tasks.filter((t) => t.done).length;

  return (
    <div className="mb-3 overflow-hidden rounded-[14px] border border-border">
      <div className="flex items-center gap-2 bg-muted/60 py-2 pr-2 pl-3.5">
        <span className="num flex size-[26px] shrink-0 items-center justify-center rounded-full bg-primary text-[12.5px] font-bold text-primary-foreground">
          {index + 1}
        </span>
        <input
          value={phase.name}
          onChange={(e) => {
            renamePhase(phase.id, e.target.value);
            onChange();
          }}
          placeholder="ชื่อเฟส"
          aria-label={`ชื่อเฟสที่ ${index + 1}`}
          className="min-w-0 flex-1 border-b-[1.5px] border-transparent bg-transparent px-0.5 py-1 text-[15px] font-bold outline-none focus:border-primary"
        />
        <span className="num shrink-0 text-xs whitespace-nowrap text-muted-foreground">
          {done}/{phase.tasks.length}
        </span>
        <button
          type="button"
          className="iconbtn glass-thin shrink-0"
          aria-label={`ลบเฟส ${phase.name || index + 1}`}
          onClick={() => {
            /* ลบเฟสแล้วงานย่อยหายด้วย — มีงานอยู่ต้องถามก่อน */
            if (phase.tasks.length && !window.confirm(`ลบเฟส "${phase.name || `เฟส ${index + 1}`}" และงานในเฟสนี้ทั้งหมด?`))
              return;
            removePhase(phase.id);
            onChange();
          }}
        >
          <TrashIcon className="size-3.5" strokeWidth={2} />
        </button>
      </div>

      <ul className="divide-y divide-border px-2.5">
        {phase.tasks.map((task) => (
          <li
            key={task.id}
            className="grid grid-cols-[28px_minmax(0,1fr)_34px] items-center gap-1.5 py-1.5 sm:grid-cols-[28px_minmax(0,1fr)_auto_34px]"
          >
            <button
              type="button"
              aria-pressed={task.done}
              aria-label={`ทำเสร็จแล้ว ${task.name}`}
              onClick={() => {
                patchTask(phase.id, task.id, { done: !task.done });
                onChange();
              }}
              className={`flex size-[22px] items-center justify-center rounded-[7px] border-[1.8px] ${
                task.done ? "border-[var(--success)] bg-[var(--success)]" : "border-border bg-card"
              }`}
            >
              <CheckIcon
                className={`size-3.5 text-white ${task.done ? "" : "opacity-0"}`}
                strokeWidth={3}
              />
            </button>
            <input
              value={task.name}
              onChange={(e) => {
                patchTask(phase.id, task.id, { name: e.target.value });
                onChange();
              }}
              aria-label="ชื่องาน"
              className={`min-w-0 bg-transparent px-0.5 py-1.5 outline-none ${
                task.done ? "text-muted-foreground line-through" : ""
              }`}
            />
            <input
              type="date"
              value={task.due}
              onChange={(e) => {
                patchTask(phase.id, task.id, { due: e.target.value });
                onChange();
              }}
              aria-label="กำหนดเสร็จ"
              className="col-start-2 h-9 max-w-[150px] rounded-[9px] border border-transparent bg-transparent px-1.5 text-[12.5px] text-muted-foreground hover:border-border focus:border-border focus:outline-none sm:col-start-3"
            />
            <button
              type="button"
              className="iconbtn glass-thin col-start-3 row-start-1 sm:col-start-4"
              aria-label={`ลบงาน ${task.name}`}
              onClick={() => {
                removeTask(phase.id, task.id);
                onChange();
              }}
            >
              <TrashIcon className="size-3.5" strokeWidth={2} />
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex gap-2 px-2.5 pt-1.5 pb-3"
        onSubmit={(e) => {
          e.preventDefault();
          const name = adding.trim();
          if (!name) return;
          addTask(phase.id, name);
          setAdding("");
          onChange();
        }}
      >
        <input
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          placeholder="+ เพิ่มงาน แล้วกด Enter"
          aria-label={`เพิ่มงานในเฟส ${phase.name || index + 1}`}
          autoComplete="off"
          className="h-10 min-w-0 flex-1 rounded-[10px] border-[1.5px] border-dashed border-border bg-card px-3 text-sm outline-none focus:border-solid focus:border-primary"
        />
        <button type="submit" className="btn glass-thin shrink-0">
          เพิ่ม
        </button>
      </form>
    </div>
  );
}

/**
 * ไฟล์และรูปของโปรเจค — ลากวาง เลือกไฟล์ หรือถ่ายรูป แล้วกดดูรูปเต็มจอได้
 * ที่อยู่ชั่วคราวของไฟล์ (object URL) สร้างตอนโหลดหรือตอนเพิ่ม แล้วเก็บคู่กับตัวไฟล์
 * ไม่สร้างตอนวาดหน้าจอ เพราะจะได้ที่อยู่ใหม่ทุกครั้งที่รีเรนเดอร์และรั่วหน่วยความจำ
 */
function FilesCard({ className }: { className: string }) {
  const [items, setItems] = useState<Shown[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [over, setOver] = useState(false);
  /* เปิด IndexedDB ไม่ได้ (โหมดส่วนตัว / ปิดที่เก็บข้อมูล) — ไฟล์อยู่แค่ในหน้านี้ ต้องบอกผู้ใช้ */
  const [temporary, setTemporary] = useState(false);
  const [view, setView] = useState<Shown | null>(null);
  const pick = useRef<HTMLInputElement>(null);
  const cam = useRef<HTMLInputElement>(null);
  /* สำเนาไว้คืนที่อยู่ให้เบราว์เซอร์ตอนออกจากหน้า — เขียน ref ใน effect ได้ ไม่ใช่ตอนวาด */
  const live = useRef<Shown[]>([]);

  useEffect(() => {
    live.current = items;
  }, [items]);
  useEffect(() => {
    let alive = true;
    void listFiles().then(({ files, ok }) => {
      if (!alive) {
        return;
      }
      setItems(files.map((f) => ({ f, url: URL.createObjectURL(f.blob) })));
      setTemporary(!ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(
    () => () => {
      for (const it of live.current) URL.revokeObjectURL(it.url);
    },
    [],
  );

  async function take(list: FileList | File[] | null) {
    if (!list || !list.length) return;
    const { added, ok } = await addFiles(list);
    setItems((prev) => [...added.map((f) => ({ f, url: URL.createObjectURL(f.blob) })), ...prev]);
    if (!ok) setTemporary(true);
  }

  function drop(it: Shown) {
    if (!window.confirm(`ลบไฟล์ "${it.f.name}"?`)) return;
    void removeFile(it.f.id);
    URL.revokeObjectURL(it.url);
    setItems((prev) => prev.filter((x) => x.f.id !== it.f.id));
    setView((v) => (v && v.f.id === it.f.id ? null : v));
  }

  const shown = items.filter((it) =>
    filter === "all" ? true : filter === "img" ? isImage(it.f) : !isImage(it.f),
  );

  return (
    <section className={className}>
      <div className="mb-3.5 flex items-center gap-2.5">
        <h2 className="text-base font-bold">ไฟล์และรูป</h2>
        {items.length > 0 && (
          <span className="ml-auto text-[12.5px] text-muted-foreground">{items.length} ไฟล์</span>
        )}
      </div>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void take(e.dataTransfer?.files ?? null);
        }}
        className={`flex flex-col items-center gap-1.5 rounded-[14px] border-[1.8px] border-dashed px-3.5 py-5 text-center ${
          over ? "border-primary bg-accent" : "border-border bg-muted/40"
        }`}
      >
        <UploadIcon className="size-7 text-muted-foreground" strokeWidth={2} />
        <b className="text-[14.5px] max-sm:hidden">ลากไฟล์มาวางที่นี่</b>
        <b className="text-[14.5px] sm:hidden">เพิ่มรูปหรือไฟล์</b>
        <small className="text-[12.5px] text-muted-foreground">
          รูปภาพ PDF เอกสาร หรือไฟล์งานออกแบบ เลือกได้ทีละหลายไฟล์
        </small>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          {/* ถ่ายรูปมีเฉพาะบนมือถือ กล้องของเครื่องจะเปิดขึ้นมาเลย */}
          <button type="button" className="btn glass-thin sm:hidden" onClick={() => cam.current?.click()}>
            <CameraIcon className="size-[18px]" strokeWidth={2} />
            ถ่ายรูป
          </button>
          <button type="button" className="btn solid btn-solid" onClick={() => pick.current?.click()}>
            เลือกไฟล์
          </button>
        </div>
        <input
          ref={pick}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            void take(e.target.files);
            e.target.value = "";
          }}
        />
        <input
          ref={cam}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void take(e.target.files);
            e.target.value = "";
          }}
        />
      </div>

      {temporary && items.length > 0 && (
        <p className="mt-2.5 rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-[12.5px] text-[var(--warning)]">
          เบราว์เซอร์นี้เก็บไฟล์ถาวรไม่ได้ ไฟล์จะหายเมื่อปิดหน้า
        </p>
      )}

      {items.length > 0 && (
        <div className="mt-3.5 flex flex-wrap gap-1.5">
          {(
            [
              ["all", "ทั้งหมด"],
              ["img", "รูปภาพ"],
              ["doc", "ไฟล์"],
            ] as [Filter, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFilter(key)}
              aria-pressed={filter === key}
              className={`h-8 rounded-full px-3 text-[12.5px] font-semibold ${
                filter === key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2.5 grid grid-cols-3 gap-2 sm:grid-cols-[repeat(auto-fill,minmax(120px,1fr))] sm:gap-2.5">
        {shown.map((it) => (
          <div
            key={it.f.id}
            className="relative flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-muted/40"
          >
            {isImage(it.f) ? (
              <button
                type="button"
                className="flex aspect-square w-full items-center justify-center bg-muted"
                aria-label={`เปิด ${it.f.name}`}
                onClick={() => setView(it)}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={it.url} alt="" className="size-full object-cover" />
              </button>
            ) : (
              /* ไม่ใช่รูป — โหลดไปเปิดด้วยโปรแกรมของเครื่อง */
              <a
                href={it.url}
                download={it.f.name}
                aria-label={`ดาวน์โหลด ${it.f.name}`}
                className="flex aspect-square w-full items-center justify-center bg-muted"
              >
                <span className="num rounded-lg border border-border bg-card px-2.5 py-1.5 text-[13px] font-bold text-muted-foreground">
                  {extOf(it.f.name)}
                </span>
              </a>
            )}
            <span className="truncate px-2 pt-1.5 text-[12.5px] font-semibold">{it.f.name}</span>
            <span className="num px-2 pb-2 text-[11.5px] text-muted-foreground">{fileSize(it.f.size)}</span>
            <button
              type="button"
              className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-foreground/60 text-white"
              aria-label={`ลบ ${it.f.name}`}
              onClick={() => drop(it)}
            >
              <CloseIcon className="size-3.5" strokeWidth={2.6} />
            </button>
          </div>
        ))}
      </div>

      {/* ดูรูปเต็มจอ — ยิงออกไปที่ body เพราะการ์ดที่มี backdrop-filter เป็นกรอบอ้างอิงของ position: fixed */}
      {view &&
        createPortal(
          <div
            className="fixed inset-0 z-90 flex flex-col bg-black/85"
            role="dialog"
            aria-modal="true"
            aria-label="ดูรูป"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setView(null);
            }}
          >
            <div className="flex items-center gap-2.5 px-3.5 py-3 text-white">
              <button
                type="button"
                className="flex size-10 items-center justify-center rounded-full bg-white/15"
                aria-label="ปิด"
                onClick={() => setView(null)}
              >
                <CloseIcon className="size-[18px]" strokeWidth={2.4} />
              </button>
              <b className="min-w-0 flex-1 truncate text-[14.5px]">{view.f.name}</b>
              <a
                href={view.url}
                download={view.f.name}
                aria-label="ดาวน์โหลด"
                className="flex size-10 items-center justify-center rounded-full bg-white/15"
              >
                <DownloadIcon className="size-[18px]" strokeWidth={2.2} />
              </a>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center p-3.5 pb-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={view.url} alt={view.f.name} className="max-h-full max-w-full rounded-[10px]" />
            </div>
          </div>,
          document.body,
        )}
    </section>
  );
}

/** ปุ่มเปิดหน้าโปรเจคใหม่ — วางในหน้ารายการโปรเจค */
export function NewProjectButton() {
  return (
    <Link href="/pm/projects/new" className="btn solid btn-solid shrink-0">
      <PlusIcon className="size-[15px]" strokeWidth={2.2} />
      <span className="lbl">โปรเจคใหม่</span>
    </Link>
  );
}
