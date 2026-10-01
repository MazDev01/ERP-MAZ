"use client";

/*
 * งานเข้าใหม่ของ PM (ตามต้นแบบ pm-inbox.html)
 *
 * กล่องนี้มีแต่งานที่ยังรอรับ รับแล้วออกจากกล่องไปรอจัดคิวที่หน้าวางแผน แล้วกลายเป็นโปรเจค
 * ทุกงานที่รับเข้ามาเป็นโปรเจคเหมือนกัน ต่างกันแค่มีข้อเสนอเป็นโครงเฟสตั้งต้นหรือต้องสร้างเฟสเอง
 *
 * กด "รับงาน" → เปิดเอกสาร (ถือว่าอ่านแล้ว จุดแดงหาย) → เลือกวันเริ่มโครงการ → รับงาน
 * รับแล้วพาไปหน้าวางแผนของโปรเจคนั้นทันที ไม่ทิ้งคนไว้กับกล่องเปล่า — จัดคิวคือสิ่งที่ต้องทำต่อ
 * ทุกลิงก์ในหน้านี้อยู่ในหน้าของ PM เท่านั้น ไม่พาข้ามไปหน้าของบทบาทอื่น
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useFindParam } from "@/lib/deep-link";
import { addDays, daysBetween, thaiDate, todayIso } from "@/lib/format";
import { serviceLabel, type InboxJob } from "@/lib/pm-data";
import { acceptInboxJob, markInboxSeen, usePm } from "@/lib/pm-store";
import { Sheet } from "./lead-dialogs";
import { ProposalPreview, QuotationPreview } from "./pm-docs";
import { SearchBox } from "./sales-ui";
import { ReadOnlyNote, usePmReadOnly } from "./pm-readonly";
import { ThaiDatePicker } from "./thai-date-picker";

/** ขั้นของงานตอนนี้ — ลิงก์ที่เจาะมาต้องบอกได้ว่างานนั้นไปถึงไหนแล้ว */
function stageText(j: InboxJob) {
  return j.stage === "new" ? "รอ PM รับงาน" : "PM รับงานแล้ว · รอจัดคิวในหน้าวางแผน";
}

export function PmInboxPage() {
  const pm = usePm();
  const router = useRouter();
  /*
   * ลิงก์จากหน้าอื่น ?find=<เลขที่ดีล> ต้อง "กรอง" ให้เหลืองานนั้น (ผู้ใช้กำหนด 23 ก.ย. 2569)
   * ส่งเลขเอกสารมากับลิงก์แล้วไม่กรอง เท่ากับให้คนไปหาเองในรายการ
   * และต้องเห็นงานนั้นแม้ PM รับไปแล้ว พร้อมบอกว่าตอนนี้อยู่ขั้นไหน ไม่ใช่ขึ้นว่าไม่พบ
   */
  const find = useFindParam();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState(find);
  const [viewing, setViewing] = useState<string | null>(() =>
    pm.inbox.some((j) => j.deal === find && j.stage === "new") ? find : null,
  );

  /* ล่าสุดอยู่บน เพราะเป็นกล่องงานเข้า ไม่ใช่คิวที่ต้องไล่จากเก่าสุด */
  const waiting = filter
    ? pm.inbox.filter((j) => j.deal === filter)
    : pm.inbox.filter((j) => j.stage === "new");
  /* งานที่วางแผนจบแล้วออกจากกล่องไปเป็นโปรเจค — ลิงก์ที่เจาะมาต้องยังบอกได้ว่าอยู่ที่ไหน */
  const project = filter ? pm.projects.find((p) => p.deal === filter) : undefined;
  const term = q.trim().toLowerCase();
  const rows = waiting
    .filter((j) => !term || `${j.scope} ${j.cus} ${j.deal}`.toLowerCase().includes(term))
    .sort((a, b) => b.sentAt.localeCompare(a.sentAt));

  const job = viewing ? pm.inbox.find((j) => j.deal === viewing) : undefined;

  /* GM ดูได้อย่างเดียว PM เป็นคนรับงาน (ต้นแบบ pm-inbox.html?as=gm) */
  const ro = usePmReadOnly();

  function open(j: InboxJob) {
    markInboxSeen(j.deal);
    setViewing(j.deal);
  }

  return (
    <div className="space-y-4">
      <div className="bar">
        <div>
          <p>งานที่รอ PM รับงาน</p>
        </div>
        <div className="tools">
          <span className="text-[13px] text-muted-foreground">
            {rows.length ? (
              <>
                {filter ? "งานที่กรองอยู่" : "งานรอรับ"}{" "}
                <b className="num text-primary">{rows.length}</b> รายการ
              </>
            ) : filter ? (
              "ไม่มีงานในกล่องนี้"
            ) : (
              "ไม่มีงานรอรับ"
            )}
          </span>
        </div>
      </div>
      <ReadOnlyNote />

      {filter && (
        <div className="glass flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[14px] px-4 py-3 text-[13px]">
          <span className="min-w-0">
            กรองเฉพาะดีล <b className="num">{filter}</b>
            {project && (
              <span className="text-muted-foreground"> · รับงานแล้ว · เปิดเป็นโปรเจคแล้ว</span>
            )}
            {!project && rows.length === 0 && (
              <span className="text-muted-foreground"> · ไม่พบงานของดีลนี้ในกล่องงานเข้า</span>
            )}
          </span>
          {project && (
            <Link
              href={`/pm/projects?deal=${encodeURIComponent(filter)}`}
              className="text-[12.5px] font-semibold text-primary hover:underline"
            >
              เปิดโปรเจค
            </Link>
          )}
          <button
            type="button"
            className="btn glass-thin ml-auto h-9"
            onClick={() => setFilter("")}
          >
            ล้างตัวกรอง
          </button>
        </div>
      )}

      <SearchBox value={q} onChange={setQ} placeholder="ค้นหางานหรือลูกค้า" />

      {/* มือถือ: การ์ดต่องาน ชื่องานเด่นบนสุด ข้อมูลรองรวมเป็นสองบรรทัด ปุ่มรับงานเต็มความกว้างกดง่าย */}
      <ul className="space-y-2.5 sm:hidden">
        {rows.length === 0 ? (
          <li className="glass rounded-[18px] py-12 text-center text-[13px] text-muted-foreground">
            {q ? "ไม่พบงานที่ค้นหา" : filter ? "ไม่พบงานของดีลนี้" : "ไม่มีงานรอรับ"}
          </li>
        ) : (
          rows.map((j) => (
            <li key={j.deal} className="glass rounded-[18px] px-4 py-3.5">
              <div className="flex items-start gap-2">
                {!j.seen && (
                  <i className="mt-[7px] size-2 flex-none rounded-full bg-primary" aria-label="ยังไม่ได้เปิดดู" />
                )}
                <b className="min-w-0 flex-1 text-[14.5px] leading-snug font-bold">{j.scope}</b>
              </div>
              <p className="mt-1 text-[12.5px] leading-snug">
                {j.cus} · <span className="text-muted-foreground">{serviceLabel(j.service)}</span>
              </p>
              <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11.5px] leading-snug text-muted-foreground">
                <span>{j.proposal?.no ? `Proposal ${j.proposal.no}` : `ใบเสนอราคา ${j.quo}`}</span>
                <span className="num">เข้า {thaiDate(j.sentAt)}</span>
              </p>
              <p className="mt-1 text-[11.5px] font-semibold text-muted-foreground">{stageText(j)}</p>
              {!ro && j.stage === "new" && (
                <button
                  type="button"
                  className="btn solid btn-solid mt-3 h-11 w-full justify-center"
                  onClick={() => open(j)}
                >
                  รับงาน
                </button>
              )}
            </li>
          ))
        )}
      </ul>

      <section className="panel glass flex flex-col max-sm:hidden">
        <div className="scroll-stable min-h-0 flex-1 overflow-auto">
          <table className="data-table cards-sm min-w-[1000px]">
            <thead>
              <tr>
                <th>งาน</th>
                <th style={{ width: 200 }}>ลูกค้า</th>
                <th style={{ width: 150 }}>บริการ</th>
                <th style={{ width: 220 }}>แหล่งที่มา</th>
                <th style={{ width: 130 }}>วันที่เข้า</th>
                <th className="c" style={{ width: 120 }} />
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-[50px] text-center text-muted-foreground">
                    {q ? "ไม่พบงานที่ค้นหา" : filter ? "ไม่พบงานของดีลนี้" : "ไม่มีงานรอรับ"}
                  </td>
                </tr>
              ) : (
                rows.map((j) => (
                  <tr key={j.deal}>
                    <td data-label="งาน">
                      <span className="inline-flex items-center gap-2 font-semibold">
                        {!j.seen && (
                          <i
                            className="size-2 flex-none rounded-full bg-primary"
                            aria-label="ยังไม่ได้เปิดดู"
                          />
                        )}
                        {j.scope}
                      </span>
                    </td>
                    <td data-label="ลูกค้า">{j.cus}</td>
                    <td data-label="บริการ">{serviceLabel(j.service)}</td>
                    {/* Proposal เป็นข้อมูลประกอบของงาน ไม่ใช่ประเภทงาน จึงแสดงเป็นข้อความธรรมดา */}
                    <td data-label="แหล่งที่มา" className="muted">
                      {j.proposal?.no ? `Proposal ${j.proposal.no}` : `ใบเสนอราคา ${j.quo}`}
                      <span className="mt-[3px] block text-[11.5px]">{stageText(j)}</span>
                    </td>
                    <td data-label="วันที่เข้า" className="num muted">
                      {thaiDate(j.sentAt)}
                    </td>
                    <td className="c">
                      {!ro && j.stage === "new" && (
                        <button type="button" className="btn solid btn-solid" onClick={() => open(j)}>
                          รับงาน
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      {job && job.stage === "new" && (
        <AcceptSheet
          job={job}
          onClose={() => setViewing(null)}
          onAccept={(start, name) => {
            acceptInboxJob(job.deal, start, name);
            setViewing(null);
            /* รับแล้วงานออกจากกล่อง เหลือกล่องเปล่า — พาไปหน้าวางแผนของโปรเจคที่เพิ่งเปิด
               เพราะจัดคิวงานคือขั้นถัดไปที่ต้องทำแน่ ๆ ไม่ใช่ให้ไปหาเองจากหน้าโปรเจค */
            router.push(`/pm/plan?deal=${encodeURIComponent(job.deal)}`);
          }}
        />
      )}
    </div>
  );
}

/** เอกสารของงาน + เลือกวันเริ่มโครงการ แล้วรับงาน */
function AcceptSheet({
  job,
  onClose,
  onAccept,
}: {
  job: InboxJob;
  onClose: () => void;
  onAccept: (start: string, name: string) => void;
}) {
  const today = todayIso();
  /* ชื่อโปรเจค (PM-BR-03) — ตั้งต้นเป็น "ลูกค้า – ขอบเขตงาน" PM แก้ให้ทีมรู้ว่างานอะไร */
  const [name, setName] = useState(() => job.name || `${job.cus} – ${job.scope}`);
  /* ตามต้นแบบ: ตั้งต้นเป็นวันเริ่มตามข้อเสนอเสมอ (แม้เลยมาแล้ว) ไม่มีจึงใช้วันนี้ — ส่วนปฏิทินยังเลือกย้อนหลังไม่ได้ */
  const [start, setStart] = useState(() => job.planStart || today);
  const [pick, setPick] = useState(false);
  const hasPlan = job.phases.length > 0 && Boolean(job.planStart);
  const shift = hasPlan && start ? daysBetween(job.planStart, start) : 0;

  return (
    <Sheet
      wide
      title={`${job.cus} (${job.deal})`}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn glass-thin flex-1 justify-center sm:flex-none" onClick={onClose}>
            ปิด
          </button>
          <button
            type="button"
            className="btn solid btn-solid flex-1 justify-center disabled:opacity-45 sm:flex-none"
            disabled={!start}
            onClick={() => onAccept(start, name)}
          >
            รับงาน
          </button>
        </>
      }
    >
      <QuotationPreview job={job} />

      {job.proposal?.no ? (
        <div className="mt-4">
          <ProposalPreview job={job} variant="inbox" />
          {job.proposal.note && <Note>{job.proposal.note}</Note>}
        </div>
      ) : job.proposal ? (
        /* หาเอกสารข้อเสนอไม่เจอจริง ๆ — บอกไปตรง ๆ ว่าไม่มี ไม่ใช่โชว์เอกสารเปล่า */
        <Note>{job.proposal.note}</Note>
      ) : (
        <Note>
          งานเดี่ยว รับจ้างเป็นชิ้น ไม่มีข้อเสนอจึงไม่มีเฟสและกรอบเวลา
          ผู้จัดการโครงการจับคนและกำหนดวันส่งได้เลย ไม่ต้องเปิดเป็นโปรเจค
        </Note>
      )}

      <section className="mt-4 rounded-[12px] border border-border bg-card px-4 py-3.5">
        <label htmlFor="qName" className="mb-2 block text-[12.5px] font-semibold text-muted-foreground">
          ชื่อโปรเจค
        </label>
        <input
          id="qName"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="ตั้งชื่อให้ทีมรู้ว่างานอะไร"
          autoComplete="off"
          className="field-control mb-3.5 w-full max-w-[420px] rounded-[11px] text-[13px]"
          style={{ height: 38 }}
        />
        <p className="mb-2 text-[12.5px] font-semibold text-muted-foreground">วันเริ่มโครงการ</p>
        <div className="max-w-[260px]">
          <ThaiDatePicker
            value={start}
            min={today}
            open={pick}
            label="วันเริ่มโครงการ"
            onToggle={() => setPick((v) => !v)}
            onPick={(iso) => {
              setStart(iso);
              setPick(false);
            }}
          />
        </div>
        <p className="mt-2.5 text-[12.5px] leading-relaxed">
          {!start ? (
            <span className="font-semibold text-destructive">เลือกวันเริ่มโครงการก่อน</span>
          ) : !hasPlan ? (
            <>
              งานนี้ไม่มีโครงเฟสมาให้ เริ่มโครงการ <b>{thaiDate(start)}</b> แล้วสร้างเฟสเองในหน้าวางแผน
            </>
          ) : (
            <>
              เริ่ม <b>{thaiDate(start)}</b> · {job.phases.length} เฟส · ระยะ {job.durationDays} วัน · คาดส่งมอบ{" "}
              <b>{thaiDate(addDays(job.planEnd, shift))}</b>
              {shift !== 0 && (
                <span className="ml-1.5 text-muted-foreground">
                  (เลื่อนจากข้อเสนอ {shift > 0 ? "+" : ""}
                  {shift} วัน)
                </span>
              )}
            </>
          )}
        </p>
      </section>
    </Sheet>
  );
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-3.5 rounded-[11px] border border-border bg-card px-3.5 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
      {children}
    </p>
  );
}
