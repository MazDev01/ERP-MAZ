"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  PRESALES_STATUS,
  type PresalesRequest,
  type PresalesStatus,
  type ProposalPlanPhase,
} from "@/lib/crm-data";
import {
  acceptPresales,
  askPresalesInfo,
  savePresalesPlan,
  submitPresalesRound,
  useCrm,
} from "@/lib/crm-store";
import { roleLabel as teamRoleLabel, teamRoles } from "@/lib/pm-data";
import { useFindParam } from "@/lib/deep-link";
import { thaiDate, thaiStamp, todayIso } from "@/lib/format";
import { countTemplateUse, useTemplates } from "@/lib/presales-templates";
import {
  addPsAsk,
  PS_ME as ME,
  psBucket as bucket,
  psKindText,
  psMine as mine,
  psOwner,
  psThreadOf,
  usePsThreads,
  type PsNote,
  type PsTab as Tab,
} from "@/lib/presales-work";
import { FileDrop, type PickedFile } from "./file-drop";
import { Sheet } from "./lead-dialogs";
import { useAddOption } from "./add-option";
import { ReadOnlyNote, usePmReadOnly } from "./pm-readonly";
import { SearchBox } from "./sales-ui";

/*
 * งานก่อนการขายของ SA และ BD — ตามต้นแบบ presales-work.html (บทบาท ps)
 * กล่องเดียวรวมคำขอทั้ง SA และ BD (ผู้ใช้กำหนด 23 ก.ย. 2569) เพราะคำขอต้องมีคนเห็นเสมอ
 * ทุกแถวติดป้ายประเภทและบอกผู้รับผิดชอบไว้ ไม่ต้องเดาว่าเป็นงานของใคร
 *   รอรับงาน → รับงาน → กำลังทำ → ส่งงาน → ส่งแล้ว (ฝ่ายขายออกใบเสนอราคาต่อ)
 *                          ↘ ขอข้อมูลเพิ่ม → รอข้อมูลเพิ่ม (แท็บของตัวเอง ส่งงานต่อได้เลย)
 * ทีมก่อนการขายเป็นผู้รับคำขอฝ่ายเดียว (เมนู PM ไม่มีคำขอก่อนการขายตามต้นแบบ pm-*.html)
 * ตัวตนกับการแบ่งแท็บอยู่ที่ lib/presales-work.ts ใช้ร่วมกับแดชบอร์ดและตารางงาน
 */

const TABS: { key: Tab; label: string }[] = [
  { key: "todo", label: "รอรับงาน" },
  { key: "doing", label: "กำลังทำ" },
  { key: "wait", label: "รอข้อมูลเพิ่ม" },
  { key: "done", label: "ส่งแล้ว" },
];

/** สีป้ายความเร่งด่วนบนการ์ดมือถือ ตามต้นแบบ presales-work.html (psw-card) */
const URGENCY_PILL: Record<string, { box: string; dot: string }> = {
  ปกติ: { box: "bg-[#F1ECEE] text-[#6E6164]", dot: "bg-[#9AA3AE]" },
  ด่วน: { box: "bg-[#FDEDD6] text-[#94500A]", dot: "bg-[#E08A00]" },
  ด่วนมาก: { box: "bg-[#FCE3E7] text-[#B0101F]", dot: "bg-[#C8102E]" },
};

/** ป้ายสถานะแบบเดียวกับหน้าคำขอก่อนการขายของฝ่ายขาย */
function StatusTag({ status }: { status: PresalesStatus }) {
  return (
    <span className={`tag ${PRESALES_STATUS[status]}`}>
      <i />
      {status}
    </span>
  );
}

/**
 * ป้ายประเภทคำขอ — บอกว่างานนี้เป็นงานอะไร (SA = วิเคราะห์เทคนิค · BD = ข้อเสนอธุรกิจ)
 * ประเภทเป็นของตัวงาน ไม่ใช่ของคนที่รับไปทำ จึงอ่านจาก r.kind เท่านั้น ห้ามเดาจากผู้รับผิดชอบ
 * full = มีที่พอเขียนยาว · ช่องแคบเหลือแค่ตัวย่อ แต่ยังมี title ให้รู้ว่าย่อมาจากงานอะไร
 */
function KindTag({ kind, full }: { kind: PresalesRequest["kind"]; full?: boolean }) {
  return (
    <span className={`tag ${kind === "BD" ? "t-job" : "t-info"}`} title={psKindText(kind)}>
      {full ? psKindText(kind) : kind}
    </span>
  );
}

export function PresalesWorkPage() {
  const crm = useCrm();
  const today = todayIso();
  /* GM เปิดหน้านี้ได้แบบดูอย่างเดียว และเห็นคำขอทุกใบ ไม่ใช่เฉพาะของทีมก่อนการขาย */
  const ro = usePmReadOnly();
  const inScope = (r: PresalesRequest) => ro || mine(r);
  /* ลิงก์จากการแจ้งเตือนหรือแดชบอร์ดเจาะมาที่คำขอเดียวได้ด้วย ?find=<เลขที่>
     ตรงกับคำขอของเราพอดี → ไปแท็บของงานนั้นแล้วเปิดหน้าต่างงานเลย (ต้นแบบ ?no=) */
  const find = useFindParam();
  const linked = find ? crm.presales.find((r) => r.no === find && inScope(r)) : undefined;
  const [query, setQuery] = useState(find);
  const [tab, setTab] = useState<Tab>(() => (linked ? bucket(linked) : "todo"));
  const [open, setOpen] = useState<string | null>(() => linked?.no ?? null);
  /* กด "ส่งงาน" บนการ์ดมือถือ = เปิดงานนั้นแล้วขึ้นฟอร์มส่งงานเลย ไม่ต้องกดซ้ำในแผ่น */
  const [sendNow, setSendNow] = useState(false);
  /* คำขอที่เพิ่งสร้างอยู่ใน localStorage ตอนเรนเดอร์ครั้งแรกจึงยังหาไม่เจอ
     ค่าตั้งต้นด้านบนเลยเปิดให้ไม่ได้ ต้องรอสโตร์ hydrate แล้วค่อยเปิดให้ครั้งเดียว */
  const jumped = useRef(false);
  useEffect(() => {
    if (jumped.current || !linked) return;
    jumped.current = true;
    setTab(bucket(linked));
    setOpen(linked.no);
  }, [linked]);

  const nameOf = useMemo(() => new Map(crm.customers.map((c) => [c.code, c.name])), [crm.customers]);

  const listOf = (t: Tab) => {
    const q = query.trim().toLowerCase();
    return crm.presales
      .filter((r) => {
        if (!inScope(r) || bucket(r) !== t) return false;
        if (q && !`${r.no} ${nameOf.get(r.customerCode) ?? ""} ${r.problem}`.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) => a.due.localeCompare(b.due));
  };
  const rows = listOf(tab);
  const current = open ? crm.presales.find((r) => r.no === open) : undefined;

  return (
    <div className="space-y-4">
      <div className="bar">
        {/* ต้นแบบมือถือไม่มีบรรทัดนับรายการ เพราะจำนวนอยู่บนชิปแท็บแล้ว */}
        <div className="max-sm:hidden">
          <p>คำขอ SA และ BD ที่แสดงอยู่ {rows.length} รายการ</p>
        </div>
        <div className="tools w-full flex-wrap sm:w-auto">
          <SearchBox value={query} onChange={setQuery} placeholder="ค้นหาเลขที่ใบงาน ผู้สนใจ หรือโจทย์" />
        </div>
      </div>
      <ReadOnlyNote owner="ทีมก่อนการขาย" />

      <section className="panel glass flex flex-col max-sm:border-0! max-sm:bg-transparent! max-sm:shadow-none!">
        <div className="strip">
          <div className="tabs">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                className={tab === t.key ? "on" : ""}
                onClick={() => setTab(t.key)}
              >
                {t.label} <b>{listOf(t.key).length}</b>
              </button>
            ))}
          </div>
        </div>

        {/* มือถือ — การ์ดตามต้นแบบ presales-work.html (psw-card)
            ชื่อผู้สนใจเป็นหัวใหญ่ โจทย์อยู่ใต้ ป้ายความเร่งด่วนมุมขวาบน
            ไม่ต้องมีเลขที่ใบงานและป้ายสถานะ เพราะสถานะดูได้จากชิปด้านบนอยู่แล้ว */}
        <ul className="flex flex-col gap-2.5 pt-2.5 sm:hidden">
          {rows.length === 0 ? (
            <li className="rounded-[20px] bg-card px-5 py-10 text-center text-[13.5px] text-muted-foreground shadow-[0_1px_2px_rgb(40_20_25/0.04)]">
              ไม่มีงานในแท็บนี้
            </li>
          ) : (
            rows.map((r) => {
              const late = r.due < today && bucket(r) !== "done";
              const urg = URGENCY_PILL[r.urgency] ?? URGENCY_PILL["ปกติ"];
              /* ปุ่มบนการ์ด — รอรับงานกดรับได้ทันที กำลังทำกดแล้วขึ้นฟอร์มส่งงานเลย (ต้นแบบ psw-send) */
              const act = ro ? "" : r.status === "รอรับงาน" ? "take" : bucket(r) === "doing" ? "send" : "";
              return (
                <li
                  key={r.id}
                  className="relative rounded-[20px] bg-card p-3.5 shadow-[0_1px_2px_rgb(40_20_25/0.04)]"
                >
                  <span className={`absolute top-3.5 right-3.5 flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[12px] font-bold ${urg.box}`}>
                    <i className={`size-[7px] rounded-full ${urg.dot}`} />
                    {r.urgency}
                  </span>
                  <button type="button" onClick={() => setOpen(r.no)} className="block w-full text-left">
                    <b className="block pr-[92px] text-[18px] leading-[1.3] font-bold">
                      {nameOf.get(r.customerCode) ?? r.customerCode}
                    </b>
                    <span className="mt-1 block text-[13.5px] leading-[1.5] text-muted-foreground">{r.problem}</span>
                    {/* คำขอต้องมีคนเห็นเสมอ — บอกประเภทงานและผู้รับผิดชอบไว้ทุกใบ */}
                    <span className="mt-1.5 flex items-center gap-1.5 text-[12.5px] text-muted-foreground">
                      <KindTag kind={r.kind} />
                      ผู้รับผิดชอบ {psOwner(r)}
                    </span>
                    <span className="mt-3 flex items-center justify-between gap-2.5 border-t border-[#F2EAEC] pt-2.5 text-[14px]">
                      <span className="text-[13px] text-muted-foreground">วันส่งงาน</span>
                      <span className={`num ${late ? "font-semibold text-destructive" : ""}`}>{thaiDate(r.due)}</span>
                    </span>
                  </button>
                  {act && (
                    <div className="flex justify-end pt-2.5">
                      <button
                        type="button"
                        className="h-[38px] rounded-xl bg-primary px-[18px] text-[13.5px] font-bold text-white"
                        onClick={() => {
                          if (act === "take") {
                            acceptPresales(r.no, ME.name);
                            setTab("doing");
                            return;
                          }
                          setOpen(r.no);
                          setSendNow(true);
                        }}
                      >
                        {act === "take" ? "รับงาน" : "ส่งงาน"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })
          )}
        </ul>

        <div className="scroll-stable hidden min-h-0 flex-1 overflow-auto sm:block">
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 136 }}>เลขที่ใบงาน</th>
                <th className="max-[1000px]:hidden" style={{ width: 78 }}>
                  ประเภท
                </th>
                <th className="min-w-[220px]">ผู้สนใจและโจทย์</th>
                <th className="max-[1000px]:hidden" style={{ width: 110 }}>
                  ความเร่งด่วน
                </th>
                <th style={{ width: 130 }}>วันส่งงาน</th>
                <th className="max-[1000px]:hidden" style={{ width: 140 }}>
                  สถานะ
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-7 text-center text-muted-foreground">
                    ไม่มีงานในแท็บนี้
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const late = r.due < today && bucket(r) !== "done";
                  return (
                    <tr
                      key={r.id}
                      tabIndex={0}
                      style={{ cursor: "pointer" }}
                      onClick={() => setOpen(r.no)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpen(r.no);
                        }
                      }}
                    >
                      <td className="num">{r.no}</td>
                      <td className="max-[1000px]:hidden">
                        <KindTag kind={r.kind} />
                      </td>
                      <td className="min-w-[220px]">
                        <b className="font-semibold">{nameOf.get(r.customerCode) ?? r.customerCode}</b>
                        <span className="why">{r.problem}</span>
                        {/* คำขอต้องมีคนเห็นเสมอ — บอกไว้ทุกแถวว่าใครรับผิดชอบ ยังไม่มีก็ต้องบอก */}
                        <span className="mt-1 block text-[12px] text-muted-foreground">
                          ผู้รับผิดชอบ {psOwner(r)}
                        </span>
                        {/* จอแคบซ่อนคอลัมน์ความเร่งด่วนและสถานะ แล้วแสดงเป็นบรรทัดเล็กใต้ชื่อแทน ชื่อจะได้ไม่ถูกบีบ */}
                        <span className="mt-1.5 hidden items-center gap-1.5 text-[12px] font-semibold text-muted-foreground max-[1000px]:flex">
                          {r.urgency} <KindTag kind={r.kind} /> <StatusTag status={r.status} />
                        </span>
                      </td>
                      <td className="max-[1000px]:hidden">{r.urgency}</td>
                      <td className={`num ${late ? "font-semibold text-destructive" : ""}`}>{thaiDate(r.due)}</td>
                      <td className="max-[1000px]:hidden">
                        <StatusTag status={r.status} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>

      {current && (
        <WorkDialog
          key={current.no}
          request={current}
          customerName={nameOf.get(current.customerCode) ?? current.customerCode}
          initialForm={sendNow ? "send" : null}
          onClose={() => {
            setOpen(null);
            setSendNow(false);
          }}
          onMoved={(t, keepOpen) => {
            /* งานสำเร็จแล้วต้องไม่หายไปเฉย ๆ — สลับไปแท็บของขั้นใหม่เสมอ
               และถ้ายังมีงานให้ทำต่อ (เพิ่งรับงาน) ก็คาหน้าต่างเดิมไว้ตรงหน้าเลย */
            if (!keepOpen) setOpen(null);
            if (t) setTab(t);
          }}
        />
      )}
    </div>
  );
}

/**
 * หน้าต่างงาน — รายละเอียดคำขอ ข้อเสนอที่ส่งแล้ว และปุ่มตามขั้นของงาน
 * กดส่งงานหรือขอข้อมูลเพิ่มแล้วรายละเอียดหลบไป เหลือแค่ฟอร์ม (ต้นแบบ detail(false))
 * แต่ต้องกลับไปอ่านรายละเอียดได้ในหน้าต่างเดิม (ผู้ใช้กำหนด 23 ก.ย. 2569)
 * สิ่งที่พิมพ์ค้างไว้อยู่ในสเตตของหน้าต่างนี้ สลับไปมาจึงไม่ล้างของที่กรอกไว้
 */
function WorkDialog({
  request: r,
  customerName,
  initialForm,
  onClose,
  onMoved,
}: {
  request: PresalesRequest;
  customerName: string;
  /** เปิดแผ่นมาพร้อมฟอร์มนี้เลย — การ์ดมือถือกด "ส่งงาน" แล้วต้องได้ฟอร์มส่งงานทันที */
  initialForm?: "send" | "ask" | null;
  onClose: () => void;
  /** งานย้ายขั้นแล้ว — ส่งแท็บที่ต้องสลับไปมาด้วย (ไม่ส่ง = อยู่แท็บเดิม) · keepOpen = ไม่ปิดหน้าต่าง */
  onMoved: (tab?: Tab, keepOpen?: boolean) => void;
}) {
  const crm = useCrm();
  const templates = useTemplates();
  const rounds = crm.presalesRounds.filter((x) => x.requestNo === r.no).sort((a, b) => b.round - a.round);
  const [form, setForm] = useState<"send" | "ask" | null>(initialForm ?? null);
  const ro = usePmReadOnly();
  /* ถามตอบกับฝ่ายขายทั้งสายของคำขอใบนี้ */
  const thread = psThreadOf(usePsThreads(), r);
  /* ไฟล์และลิงก์ที่แนบในรอบนี้ — ต้องมีอย่างน้อยหนึ่งรายการ */
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [hours, setHours] = useState("");
  const [note, setNote] = useState("");
  const [ask, setAsk] = useState("");
  const [sendErr, setSendErr] = useState(false);
  /* ไฟล์ยังอัปโหลดไม่เสร็จแล้วกดส่ง = รอบนั้นได้ไฟล์ไม่ครบ ปุ่มส่งจึงต้องรอ */
  const [uploading, setUploading] = useState(false);
  const [askErr, setAskErr] = useState(false);
  /* เพิ่งกดรับงานในหน้าต่างนี้ — ต้องบอกว่าเกิดอะไรขึ้นและทำอะไรต่อ ไม่ใช่ให้แถวหายไปเฉย ๆ */
  const [took, setTook] = useState(false);
  const working = r.status === "กำลังทำ" || r.status === "รอข้อมูลเพิ่ม";

  function send() {
    if (form !== "send") {
      setForm("send");
      return;
    }
    if (!files.length) return setSendErr(true);
    if (uploading) return;
    const first = files[0];
    /* ชั่วโมงที่ใช้ไม่บังคับ (ต้นแบบไม่มีช่องนี้) แต่ยังเก็บไว้บวกเข้าชั่วโมงรวมของคำขอ */
    const h = parseFloat(hours);
    /* รายการที่มาจากคลังเทมเพลตมี id ขึ้นต้น tpl: — นับการใช้ให้เทมเพลตนั้น */
    countTemplateUse(files.filter((f) => f.id.startsWith("tpl:")).map((f) => f.id.split(":")[1]));
    submitPresalesRound(r.no, {
      by: ME.name,
      hours: h > 0 ? h : 0,
      note: note.trim() || "—",
      /* รายการแรกเป็นตัวแทนของรอบ — ลิงก์ใช้ชนิด canva เพราะหน้าอื่นเปิดเป็นลิงก์ได้ */
      kind: first.url ? "canva" : "pdf",
      file: first.name,
      url: first.url ?? "",
      files: files.map((f) => (f.url ? { name: f.name, url: f.url } : { name: f.name })),
    });
    onMoved("done");
  }

  function askMore() {
    if (form !== "ask") {
      setForm("ask");
      return;
    }
    const t = ask.trim();
    if (!t) return setAskErr(true);
    askPresalesInfo(r.no, t);
    /* เก็บคำถามต่อท้ายสายสนทนาด้วย — ฝ่ายขายต้องเห็นคำถามตอนกดตอบ ไม่ใช่เห็นแค่ข้อความล่าสุด */
    addPsAsk(r.no, t);
    onMoved("wait");
  }

  /* แถวป้าย-ค่าในแผงสีเทาบนมือถือ (ต้นแบบ psw-detail) */
  const kv =
    "max-sm:[&>dt]:border-b max-sm:[&>dt]:border-[#F0E6E8] max-sm:[&>dt]:py-[11px] max-sm:[&>dt]:pr-3 max-sm:[&>dt]:text-[14px] max-sm:[&>dt]:font-medium max-sm:[&>dt]:whitespace-nowrap max-sm:[&>dd]:border-b max-sm:[&>dd]:border-[#F0E6E8] max-sm:[&>dd]:py-[11px] max-sm:[&>dd]:text-right max-sm:[&>dd]:text-[14px] max-sm:[&>dd]:font-semibold max-sm:[&>dt:last-of-type]:border-b-0 max-sm:[&>dd:last-of-type]:border-b-0";
  /* หัวข้อของกล่องโจทย์ — เต็มแถว ตัวเล็ก ไม่มีเส้นใต้ */
  const kvHead =
    "max-sm:col-span-2 max-sm:border-b-0! max-sm:pt-3 max-sm:pb-0.5! max-sm:text-[12.5px]! max-sm:text-[#8A7E81]";
  const lb = "mb-1.5 block text-[12.5px] font-semibold text-muted-foreground";
  const dt = "text-[12.5px] font-semibold text-muted-foreground";

  return (
    <Sheet
      title={`${r.no} · ${customerName}`}
      onClose={onClose}
      footer={
        /* GM เปิดดูได้อย่างเดียว ปุ่มรับงาน/ขอข้อมูลเพิ่ม/ส่งงาน จึงไม่มี */
        ro ? (
          <button type="button" className="btn glass-thin flex-1 justify-center sm:flex-none" onClick={onClose}>
            ปิด
          </button>
        ) : r.status === "รอรับงาน" ? (
          <button
            type="button"
            className="btn solid btn-solid flex-1 justify-center sm:flex-none"
            onClick={() => {
              acceptPresales(r.no, ME.name);
              setTook(true);
              /* รับแล้วงานหายจากแท็บที่ยืนอยู่ — พาไปแท็บ "กำลังทำ" พร้อมคาใบเดิมไว้ตรงหน้า
                 หน้าต่างนี้จะกลายเป็นชุดปุ่มของขั้นถัดไป (ขอข้อมูลเพิ่ม / ส่งงาน) ทันที */
              onMoved("doing", true);
            }}
          >
            รับงาน
          </button>
        ) : working ? (
          <>
            {form ? (
              <>
                {/* กลับไปอ่านโจทย์ได้โดยไม่ล้างสิ่งที่กรอกไว้ */}
                <button
                  type="button"
                  className="btn glass-thin flex-1 justify-center sm:flex-none"
                  onClick={() => setForm(null)}
                >
                  กลับไปดูรายละเอียด
                </button>
                <button
                  type="button"
                  className="btn solid btn-solid flex-1 justify-center sm:flex-none"
                  disabled={form === "send" && uploading}
                  onClick={form === "send" ? send : askMore}
                >
                  {form === "send" ? (uploading ? "กำลังอัปโหลดไฟล์…" : "ยืนยันส่งงาน") : "ยืนยันขอข้อมูล"}
                </button>
              </>
            ) : (
              <>
                <button type="button" className="btn glass-thin flex-1 justify-center sm:flex-none" onClick={askMore}>
                  ขอข้อมูลเพิ่ม
                </button>
                <button type="button" className="btn solid btn-solid flex-1 justify-center sm:flex-none" onClick={send}>
                  ส่งงาน
                </button>
              </>
            )}
          </>
        ) : null
      }
    >
      {took && (
        <p
          role="status"
          className="mb-3.5 rounded-[11px] bg-[var(--success-soft)] px-3.5 py-3 text-[12.5px] leading-relaxed font-semibold text-[var(--success)]"
        >
          รับงาน {r.no} แล้ว · ย้ายไปแท็บ “กำลังทำ” และบันทึกผู้รับผิดชอบเป็น {ME.name} แล้ว
          <span className="mt-0.5 block font-normal">
            ทำต่อได้เลยจากหน้าต่างนี้ — กด “ส่งงาน” เมื่อมีข้อเสนอ หรือ “ขอข้อมูลเพิ่ม” ถ้าโจทย์ยังไม่พอ
          </span>
        </p>
      )}

      {form === null && (
        <>
          {/* มือถือ: โจทย์เป็นกล่องเด่นบนสุด ข้อมูลที่เหลือเป็นแถวในแผงสีเทา (ต้นแบบ psw-detail) */}
          <dl
            className={`grid grid-cols-[150px_minmax(0,1fr)] gap-x-3.5 gap-y-2 text-[13.5px] max-sm:grid-cols-[auto_minmax(0,1fr)] max-sm:gap-0 max-sm:rounded-[14px] max-sm:bg-[#FAF6F7] max-sm:px-3.5 ${kv}`}
          >
            <dt className={`${dt} ${kvHead}`}>โจทย์จากลูกค้า</dt>
            <dd className="break-words max-sm:col-span-2 max-sm:pt-0! max-sm:pb-3 max-sm:text-left! max-sm:text-[15.5px] max-sm:leading-[1.5] max-sm:font-bold">
              {r.problem}
            </dd>
            {/* ประเภทงานกับผู้รับผิดชอบเป็นคนละเรื่อง แยกบรรทัดกันไม่ให้อ่านปนกัน */}
            <dt className={dt}>ประเภทงาน</dt>
            <dd className="flex flex-wrap items-center gap-2 max-sm:justify-end">
              <KindTag kind={r.kind} full />
              <span className="text-[12px] text-muted-foreground max-sm:hidden">ประเภทติดกับตัวงาน ไม่เปลี่ยนตามคนที่รับ</span>
            </dd>
            <dt className={dt}>ผู้รับผิดชอบ</dt>
            <dd className="break-words">{psOwner(r)}</dd>
            <dt className={dt}>ความเร่งด่วน</dt>
            <dd>
              {r.urgency}
              {r.urgentReason ? ` · ${r.urgentReason}` : ""}
            </dd>
            <dt className={dt}>วันส่งงาน</dt>
            <dd className="num">{thaiDate(r.due)}</dd>
            <dt className={dt}>งบประมาณโดยประมาณ</dt>
            <dd className="num">{(r.budget || 0).toLocaleString("en-US")} บาท</dd>
            {r.attachments.length > 0 && (
              <>
                <dt className={dt}>ไฟล์แนบจากฝ่ายขาย</dt>
                <dd className="flex flex-col gap-0.5 max-sm:items-end">
                  {r.attachments.map((a) =>
                    /^https?:\/\//.test(a) ? (
                      <a key={a} href={a} target="_blank" rel="noreferrer" className="break-all underline">
                        {a}
                      </a>
                    ) : (
                      <span key={a} className="break-all">
                        {a}
                      </span>
                    ),
                  )}
                </dd>
              </>
            )}
            <dt className={dt}>สถานะ</dt>
            <dd>
              <StatusTag status={r.status} />
            </dd>
          </dl>

          {/* แผนงานของข้อเสนอ (Full Proposal · M2) — วางเป็นช่วงสัปดาห์ PM แปลงเป็นวันจริงตอนรับงาน */}
          <ProposalPlan request={r} readOnly={ro} />

          {/* ถามตอบกับฝ่ายขายทั้งสาย — ทั้งสองฝั่งอ่านชุดเดียวกัน จะได้ไม่ต้องไปตามกันในไลน์ */}
          <PsThread notes={thread} />

          {rounds.length > 0 && (
            <>
              <p className="mt-[18px] mb-2 text-[13px] font-bold max-sm:text-[14px]">ข้อเสนอที่ส่งแล้ว</p>
              <ul className="max-sm:flex max-sm:flex-col max-sm:gap-2">
                {rounds.map((x) => {
                  const meta = [thaiDate(x.at)];
                  if (x.files && x.files.length > 1) meta.push(`แนบ ${x.files.length} รายการ`);
                  if (x.hours > 0) meta.push(`${x.hours} ชม.`);
                  if (x.note && x.note !== "—") meta.push(x.note);
                  return (
                    <li
                      key={x.id}
                      className="flex flex-col gap-0.5 border-t border-border py-[9px] max-sm:rounded-[14px] max-sm:border-0 max-sm:bg-[#FAF6F7] max-sm:p-3.5 max-sm:first:bg-[#FDF0F2]"
                    >
                      <b className="text-[13px] font-semibold break-all max-sm:text-[14px] max-sm:font-bold">
                        รอบที่ {x.round} · {x.file}
                      </b>
                      <span className="text-[12px] text-muted-foreground max-sm:text-[12.5px] max-sm:leading-[1.5]">
                        {meta.join(" · ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </>
      )}

      {form === "send" && (
        <div>
          <BackToDetail onBack={() => setForm(null)} />
          <p className="mb-2 text-[13px] font-bold">ส่งข้อเสนอรอบที่ {rounds.length + 1}</p>
          <FileDrop
            files={files}
            onChange={(next) => {
              setFiles(next);
              setSendErr(false);
            }}
            title="ลากไฟล์มาวาง หรือกดเพื่อเลือกไฟล์"
            hint="PDF, รูปภาพ หรือไฟล์เอกสาร เลือกได้หลายไฟล์"
            label="เลือกไฟล์ข้อเสนอ"
            links
            linkPlaceholder="หรือวางลิงก์ เช่น Canva, Google Drive"
            onBusy={setUploading}
          />
          {/* เลือกเทมเพลตจากคลัง (/presales-templates) มาแนบได้เลย ไม่ต้องหาไฟล์ใหม่ */}
          {templates.length > 0 && (
            <select
              value=""
              aria-label="เลือกจากคลังเทมเพลต"
              onChange={(e) => {
                const t = templates.find((x) => x.id === e.target.value);
                if (!t) return;
                setFiles([
                  ...files,
                  { id: `tpl:${t.id}:${Date.now()}`, name: t.url ?? t.file, size: t.url ? 0 : (t.size ?? 0), url: t.url },
                ]);
                setSendErr(false);
              }}
              className="field-control mt-3 cursor-pointer"
            >
              <option value="">เลือกจากคลังเทมเพลต</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          <textarea
            rows={2}
            aria-label="ข้อความถึงฝ่ายขาย"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="ข้อความถึงฝ่ายขาย (ไม่บังคับ)"
            className="field-control mt-3 resize-y py-2.5 leading-relaxed"
          />
          {/* ของเดิมที่เกินต้นแบบ — ชั่วโมงรวมของคำขอไปโผล่ในหน้าคำขอก่อนการขายของฝ่ายขาย */}
          <label htmlFor="w-hours" className={`${lb} mt-3`}>
            ชั่วโมงที่ใช้รอบนี้ (ไม่บังคับ)
          </label>
          <input
            id="w-hours"
            type="number"
            min={0.5}
            step={0.5}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
            placeholder="เช่น 4"
            className="field-control num max-w-[200px]"
          />
          {sendErr && <p className="mt-2 text-[12.5px] text-destructive">แนบไฟล์หรือลิงก์อย่างน้อย 1 รายการ</p>}
        </div>
      )}

      {form === "ask" && (
        <div>
          <BackToDetail onBack={() => setForm(null)} />
          <label htmlFor="w-ask" className={lb}>
            ต้องการข้อมูลอะไรเพิ่มจากฝ่ายขาย
          </label>
          <textarea
            id="w-ask"
            autoFocus
            rows={3}
            value={ask}
            onChange={(e) => {
              setAsk(e.target.value);
              setAskErr(false);
            }}
            placeholder="เช่น จำนวนรถที่ใช้จริง และระบบบัญชีที่ใช้อยู่"
            className="field-control resize-y py-2.5 leading-relaxed"
          />
          {askErr && <p className="mt-2 text-[12.5px] text-destructive">บอกฝ่ายขายว่าต้องการข้อมูลอะไร</p>}
        </div>
      )}
    </Sheet>
  );
}

/**
 * สายถามตอบข้อมูลเพิ่ม — ใช้ทั้งฝั่งทีมก่อนการขาย (หน้านี้) และฝั่งฝ่ายขาย (presales-page)
 * คำถามของทีมอยู่ซ้าย คำตอบของฝ่ายขายอยู่ขวา พร้อมชื่อคนพิมพ์และเวลา
 * ไม่มีชื่อกับเวลาแล้วอ่านไม่ออกว่าใครถามและถามไว้นานแค่ไหน
 */
export function PsThread({ notes }: { notes: PsNote[] }) {
  if (notes.length === 0) return null;
  return (
    <section className="mt-[18px]">
      <p className="mb-2 text-[13px] font-bold">ถามตอบข้อมูลเพิ่ม</p>
      <ul className="flex flex-col gap-2">
        {notes.map((n, i) => (
          <li
            key={`${n.at}-${i}`}
            className={`rounded-[12px] px-3.5 py-2.5 ${
              n.side === "ps"
                ? "bg-[var(--warning-soft)]"
                : "bg-muted sm:ml-6"
            }`}
          >
            <p className="flex flex-wrap items-baseline gap-x-2 text-[11.5px] text-muted-foreground">
              <b className="font-semibold text-foreground">{n.by}</b>
              <span>{n.side === "ps" ? "ขอข้อมูลเพิ่ม" : "ตอบข้อมูล"}</span>
              {n.at && <span className="num">{thaiStamp(n.at)} น.</span>}
            </p>
            <p className="mt-1 text-[13px] leading-relaxed break-words">{n.tx}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** ปุ่มกลับไปอ่านโจทย์ระหว่างกรอกฟอร์ม — ไม่ปิดหน้าต่าง สิ่งที่กรอกไว้จึงยังอยู่ */
function BackToDetail({ onBack }: { onBack: () => void }) {
  return (
    <button
      type="button"
      onClick={onBack}
      className="mb-3 flex items-center gap-1 text-[12.5px] font-semibold text-primary hover:underline"
    >
      ‹ กลับไปดูรายละเอียดคำขอ
    </button>
  );
}


/*
 * แผนงานของข้อเสนอ — BD/SA วางเป็นช่วงสัปดาห์ เพราะตอนทำข้อเสนอยังไม่รู้ว่าลูกค้าจะเริ่มวันไหน
 * PM เลือกวันเริ่มตอนรับงาน ระบบแปลงสัปดาห์เป็นวันที่จริงให้ (flow.ts buildInboxJob)
 * ไม่วางแผนไว้ก็ได้ — PM จะได้แม่แบบเฟสมาตรฐานไปจัดเอง
 */
function ProposalPlan({ request, readOnly }: { request: PresalesRequest; readOnly: boolean }) {
  const saved = request.plan ?? [];
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<ProposalPlanPhase[]>(saved);
  const roles = teamRoles();
  /* เพิ่มตำแหน่งในทีมใหม่ได้จากหน้างาน (ข้อมูลหลัก HR-10) — ตั้งให้เฟสที่กำลังแก้อยู่ */
  const [roleRow, setRoleRow] = useState(-1);
  const addRole = useAddOption({ catalog: "teamRoles" }, (v) => {
    if (roleRow >= 0) set(roleRow, { role: v });
  });

  function start() {
    setRows(saved.length ? saved : [{ name: "", role: roles[0]?.key ?? "", fromWeek: 1, toWeek: 1, tasks: [] }]);
    setEditing(true);
  }
  function set(i: number, patch: Partial<ProposalPlanPhase>) {
    setRows((r) => r.map((x, k) => (k === i ? { ...x, ...patch } : x)));
  }

  return (
    <section className="mt-[18px]">
      {addRole.dialog}
      <div className="mb-2 flex items-center gap-2">
        <p className="text-[13px] font-bold">แผนงานของข้อเสนอ</p>
        {!readOnly && !editing && (
          <button type="button" className="btn glass-thin btn-mini ml-auto" onClick={start}>
            {saved.length ? "แก้แผนงาน" : "วางแผนงาน"}
          </button>
        )}
      </div>

      {!editing && saved.length === 0 && (
        <p className="text-[12.5px] text-muted-foreground">
          ยังไม่ได้วางแผนงาน — PM จะได้แม่แบบเฟสมาตรฐานไปจัดเองตอนรับงาน
        </p>
      )}

      {!editing && saved.length > 0 && (
        <ul className="grid gap-1.5">
          {saved.map((x, i) => (
            <li key={i} className="rounded-[11px] border border-border bg-card px-3 py-2 text-[12.5px]">
              <b className="font-semibold">{x.name}</b>
              <span className="text-muted-foreground">
                {" · "}สัปดาห์ที่ {x.fromWeek}
                {x.toWeek > x.fromWeek ? `–${x.toWeek}` : ""} · {teamRoleLabel(x.role)}
              </span>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <div className="grid gap-2">
          {rows.map((x, i) => (
            <div key={i} className="grid gap-2 rounded-[11px] border border-border bg-card p-2.5 sm:grid-cols-[minmax(0,1fr)_120px_86px_86px_36px]">
              <input
                value={x.name}
                onChange={(e) => set(i, { name: e.target.value })}
                placeholder="ชื่อเฟส เช่น ออกแบบหน้าจอ"
                aria-label={`ชื่อเฟสที่ ${i + 1}`}
                className="field-control"
              />
              <select
                value={x.role}
                aria-label={`ตำแหน่งที่ทำเฟสที่ ${i + 1}`}
                onChange={(e) => {
                  setRoleRow(i);
                  if (addRole.pick(e.target.value)) return;
                  set(i, { role: e.target.value });
                }}
                className="field-control cursor-pointer"
              >
                {roles.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.label}
                  </option>
                ))}
                {addRole.option}
              </select>
              <input
                type="number"
                min={1}
                value={x.fromWeek}
                aria-label={`สัปดาห์เริ่มของเฟสที่ ${i + 1}`}
                onChange={(e) => set(i, { fromWeek: Number(e.target.value) || 1 })}
                className="field-control num"
              />
              <input
                type="number"
                min={1}
                value={x.toWeek}
                aria-label={`สัปดาห์จบของเฟสที่ ${i + 1}`}
                onChange={(e) => set(i, { toWeek: Number(e.target.value) || 1 })}
                className="field-control num"
              />
              <button
                type="button"
                aria-label={`ลบเฟสที่ ${i + 1}`}
                onClick={() => setRows((r) => r.filter((_, k) => k !== i))}
                className="btn glass-thin justify-center text-destructive"
              >
                ✕
              </button>
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="btn glass-thin"
              onClick={() =>
                setRows((r) => [
                  ...r,
                  {
                    name: "",
                    role: roles[0]?.key ?? "",
                    fromWeek: (r[r.length - 1]?.toWeek ?? 0) + 1,
                    toWeek: (r[r.length - 1]?.toWeek ?? 0) + 1,
                    tasks: [],
                  },
                ])
              }
            >
              + เพิ่มเฟส
            </button>
            <button type="button" className="btn glass-thin ml-auto" onClick={() => setEditing(false)}>
              ยกเลิก
            </button>
            <button
              type="button"
              className="btn solid btn-solid"
              onClick={() => {
                savePresalesPlan(request.no, rows);
                setEditing(false);
              }}
            >
              บันทึกแผนงาน
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
