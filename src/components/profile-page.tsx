"use client";

import { optionsOf } from "@/lib/options";
import { bkkNow, parseIsoDate, todayIso } from "@/lib/format";

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { saveProfile, useProfile } from "@/lib/profile-data";
import {
  NOTIFY_CHANNELS,
  NOTIFY_EVENTS,
  saveNotifySettings,
  useNotifySettings,
  type NotifySettings,
} from "@/lib/notify-settings";
import { setProfilePhoto, useProfilePhoto } from "@/lib/profile-store";
import { setMobileBack } from "@/lib/mobile-back";
import Link from "next/link";
import {
  BellIcon,
  CameraIcon,
  CheckIcon,
  ChevronRightIcon,
  DownloadIcon,
  LockIcon,
  LogoutIcon,
  PencilIcon,
  UserIcon,
} from "./icons";
import { FileDrop, type PickedFile } from "./file-drop";
import { PhotoCropper } from "./photo-cropper";

import { DateField } from "./thai-date-picker";
import { ADD_VALUE, useAddOption } from "./add-option";
/* ข้อมูลตัวอย่างย้ายไปหน้าผู้ดูแลระบบ (/admin/data) — เป็นเครื่องมือดูแลระบบ ไม่ใช่ของพนักงาน */
type Pane = "profile" | "notify" | "security";

const PANES: { key: Pane; label: string; icon: React.ReactNode }[] = [
  { key: "profile", label: "ข้อมูลส่วนตัว", icon: <UserIcon className="size-4" /> },
  { key: "notify", label: "การแจ้งเตือน", icon: <BellIcon className="size-4" /> },
  { key: "security", label: "รหัสผ่าน", icon: <LockIcon className="size-4" /> },
  /* แถบเมนูล่างย้ายไปให้ฝ่ายบุคคลตั้งที่หน้าตั้งค่าระบบ (เจ้าของสั่ง 1 ต.ค. 2569) */
];

export function ProfilePage() {
  const params = useSearchParams();
  /*
   * ผู้ดูแลระบบเป็นบัญชีสำหรับควบคุมระบบ ไม่ใช่คนในทะเบียน (เจ้าของสั่ง 25 ก.ย. 2569)
   * จึงไม่มีข้อมูลส่วนตัวและไม่มีรูป เหลือเฉพาะรหัสผ่านกับการแจ้งเตือนที่จำเป็นต่อการเข้าใช้งาน
   */
  const panes = PANES;
  const fallback: Pane = "profile";
  const tabParam = params.get("tab");
  const initial = (tabParam as Pane) || fallback;
  const [pane, setPane] = useState<Pane>(initial);
  /*
   * แผงที่เปิดอยู่จริง — บทบาทอ่านจาก localStorage จึงรู้หลัง hydrate
   * ถ้ายึดค่าที่ตั้งไว้ตอนเรนเดอร์แรก ผู้ดูแลระบบจะค้างอยู่ที่แผง "ข้อมูลส่วนตัว" ที่ไม่มีให้ดู แล้วจอว่างเปล่า
   */
  const current = panes.some((p) => p.key === pane) ? pane : fallback;
  const [saved, setSaved] = useState<string | null>(null);

  function flash(message: string) {
    setSaved(message);
  }

  /*
   * มือถือ: หน้ารวมก่อน แล้วค่อยเข้าไปทีละเรื่อง (ต้นแบบ mobile/profile-glass.html 30 ก.ย. 2569)
   * เดิมยัดทุกแผงไว้หน้าเดียวจนต้องเลื่อนยาวมาก · จอกว้างยังเป็นสองคอลัมน์เหมือนเดิม
   */
  const [open, setOpen] = useState<Pane | null>(tabParam ? initial : null);

  /*
   * มาจากลิงก์ ?tab=... เช่น "เปลี่ยนรหัสผ่าน" ในเมนูบัญชี
   * ตอนอยู่หน้า /profile อยู่แล้ว Next เปลี่ยนแค่ค่าในที่อยู่เว็บ ไม่ได้สร้างคอมโพเนนต์ใหม่
   * ถ้าอ่าน ?tab= แค่ตอนเรนเดอร์แรก กดแล้วจะค้างอยู่แผงเดิม (เจ้าของแจ้ง 1 ต.ค. 2569)
   * จึงปรับสถานะตอนที่ค่าในที่อยู่เว็บเปลี่ยน ไม่ใช่ใน useEffect (กันวาดซ้ำซ้อน)
   */
  const [seenTab, setSeenTab] = useState(tabParam);
  if (tabParam !== seenTab) {
    setSeenTab(tabParam);
    if (tabParam && panes.some((p) => p.key === tabParam)) {
      setPane(tabParam as Pane);
      setOpen(tabParam as Pane);
    }
  }

  /* เปิดเรื่องย่อยอยู่ — ปุ่มย้อนกลับบนแถบหัวพากลับมาหน้ารวมโปรไฟล์ ไม่ใช่ออกไปหน้าหลักเลย */
  useEffect(() => {
    if (open === null) return;
    setMobileBack(() => {
      setOpen(null);
      setSaved(null);
    });
    return () => setMobileBack(null);
  }, [open]);

  return (
    <>
      {/* ── มือถือ ── */}
      <div className="sm:hidden">
        {open === null ? (
          <ProfileHub panes={panes} onPane={setOpen} />
        ) : (
          <div>
            {/* ปุ่มย้อนกลับมีอันเดียว คือปุ่มบนแถบหัว — กดแล้วกลับมาหน้ารวมโปรไฟล์ก่อน
               (เจ้าของสั่ง 1 ต.ค. 2569 ว่าอย่าให้มีปุ่มย้อนกลับสองอัน) ตรงนี้เหลือแค่ชื่อเรื่อง */}
            {saved && (
              <p className="mb-[18px] flex items-center gap-[11px] rounded-[14px] bg-[var(--success-soft)] px-[17px] py-3 text-[13.5px] font-medium text-[var(--success)]">
                <CheckIcon className="size-[18px] shrink-0" strokeWidth={2.4} />
                {saved}
              </p>
            )}
            {open === "profile" && <PersonalPane onSaved={flash} />}
            {open === "notify" && <NotifyPane onSaved={flash} />}
            {open === "security" && <SecurityPane onSaved={flash} />}
          </div>
        )}
      </div>

      {/* ── จอคอม ── */}
      <div className="mx-auto hidden max-w-[1060px] grid-cols-[minmax(0,1fr)] items-start gap-[22px] sm:grid lg:grid-cols-[262px_minmax(0,1fr)]">
        <ProfileCard pane={current} panes={panes} onPane={(p) => { setPane(p); setSaved(null); }} />

        <div className="min-w-0">
          {saved && (
            <p className="mb-[18px] flex items-center gap-[11px] rounded-[14px] bg-[var(--success-soft)] px-[17px] py-3 text-[13.5px] font-medium text-[var(--success)]">
              <CheckIcon className="size-[18px] shrink-0" strokeWidth={2.4} />
              {saved}
            </p>
          )}
          {current === "profile" && <PersonalPane onSaved={flash} />}
          {current === "notify" && <NotifyPane onSaved={flash} />}
          {current === "security" && <SecurityPane onSaved={flash} />}
        </div>
      </div>
    </>
  );
}

/*
 * หน้ารวมของโปรไฟล์บนมือถือ — รูป ชื่อ ตำแหน่ง ปุ่มแก้ไข แล้วตามด้วยรายการเรื่องอื่น
 * รูปยังเป็นสี่เหลี่ยมมุมมนมีขอบตามที่เจ้าของสั่งไว้ (29 ก.ย. 2569) ไม่ใช่วงกลมแบบในต้นแบบ
 */
function ProfileHub({ panes, onPane }: { panes: typeof PANES; onPane: (p: Pane) => void }) {
  const me = useProfile();
  const photo = useProfilePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<string | null>(null);
  const short = me.name.split(" ").map((x) => x[0]).join("").slice(0, 2);
  const rows = panes.filter((p) => p.key !== "profile");

  function pick(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropping(String(reader.result));
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <div className="flex flex-col gap-2">
      <section className="glass flex flex-col items-center rounded-[28px] px-4 pt-6 pb-5 text-center">
        <span className="relative inline-block">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="" className="size-[92px] rounded-full border-[3px] border-white object-cover shadow-[0_10px_24px_-12px_rgb(26_93_181/0.6)]" />
          ) : (
            <span className="grid size-[92px] place-items-center rounded-full border-[3px] border-white bg-[#E3EEFC] text-[30px] font-bold text-[#1A5DB5] shadow-[0_10px_24px_-12px_rgb(26_93_181/0.6)]">
              {short}
            </span>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            aria-label="เปลี่ยนรูปโปรไฟล์"
            className="absolute -right-0.5 -bottom-0.5 grid size-8 place-items-center rounded-full border-[3px] border-white bg-foreground text-white"
          >
            <CameraIcon className="size-[15px]" strokeWidth={2.2} />
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/gif"
            aria-label="เลือกไฟล์รูปโปรไฟล์"
            className="sr-only"
            onChange={(e) => pick(e.target.files?.[0])}
          />
        </span>
        <h2 className="mt-4 text-[19px] font-bold">{me.name}</h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{me.position}</p>
        <button
          type="button"
          onClick={() => onPane("profile")}
          className="mt-[18px] flex h-[42px] items-center gap-2 rounded-full bg-primary px-5 text-[14px] font-semibold text-white shadow-[0_10px_20px_-12px_rgb(200_16_46/0.9)]"
        >
          <PencilIcon className="size-4" strokeWidth={2.2} />
          แก้ไขข้อมูลส่วนตัว
        </button>
      </section>

      {rows.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => onPane(p.key)}
          className="glass flex h-[54px] items-center gap-3 rounded-[16px] px-4 text-left"
        >
          <span className="flex text-muted-foreground">{p.icon}</span>
          <span className="flex-1 text-[14.5px] font-semibold">{p.label}</span>
          <ChevronRightIcon className="size-[18px] text-muted-foreground" strokeWidth={2.3} />
        </button>
      ))}

      <Link href="/install" className="glass flex h-[54px] items-center gap-3 rounded-[16px] px-4 text-foreground">
        <DownloadIcon className="size-[18px] text-muted-foreground" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] font-semibold">ติดตั้งแอป</span>
        <ChevronRightIcon className="size-[18px] text-muted-foreground" strokeWidth={2.3} />
      </Link>

      <a href="/login" className="glass mt-1 flex h-[54px] items-center gap-3 rounded-[16px] px-4 text-primary">
        <LogoutIcon className="size-[18px]" strokeWidth={2} />
        <span className="flex-1 text-[14.5px] font-semibold">ออกจากระบบ</span>
      </a>

      {cropping && (
        <PhotoCropper
          src={cropping}
          onCancel={() => setCropping(null)}
          onDone={(url) => {
            setProfilePhoto(url);
            setCropping(null);
          }}
        />
      )}
    </div>
  );
}

// ─── การ์ดซ้าย ────────────────────────────────────────────────────
function ProfileCard({
  pane,
  panes,
  onPane,
}: {
  pane: Pane;
  panes: typeof PANES;
  onPane: (p: Pane) => void;
}) {
  const photo = useProfilePhoto();
  const fileRef = useRef<HTMLInputElement>(null);
  const [cropping, setCropping] = useState<string | null>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setCropping(String(reader.result));
    reader.readAsDataURL(file);
    if (fileRef.current) fileRef.current.value = "";
  }

  const me = useProfile();
  const short = me.name.split(" ").map((s) => s[0]).join("").slice(0, 2);

  return (
    <aside className="glass rounded-[20px] px-4 py-4 sm:px-5 lg:sticky lg:top-[88px] lg:pt-[26px] lg:pb-[18px] lg:text-center">
      <div className="flex items-center gap-4 lg:block">
      {/* เปลี่ยนรูปได้ทุกบทบาท รวมผู้ดูแลระบบ (เจ้าของสั่ง 25 ก.ย. 2569)
          รูปเป็นของบัญชี ไม่ใช่ข้อมูลส่วนตัวของคน บัญชีควบคุมระบบจึงตั้งรูปประจำบัญชีได้ */}
      <span className="relative inline-block shrink-0">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt=""
            className="size-16 rounded-full border-[3px] border-white object-cover shadow-[0_4px_14px_rgba(28,20,45,.14)] lg:size-[104px]"
          />
        ) : (
          <span className="grid size-16 place-items-center rounded-full bg-accent text-xl font-bold text-primary lg:size-[104px] lg:text-[34px]">
            {short}
          </span>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="absolute -right-0.5 -bottom-0.5 grid size-7 place-items-center rounded-full border-[3px] border-white bg-primary text-white transition-colors hover:bg-primary-hover lg:right-0.5 lg:bottom-0.5 lg:size-[30px]"
          aria-label="เปลี่ยนรูปโปรไฟล์"
        >
          <CameraIcon className="size-[15px]" strokeWidth={2.2} />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/gif"
          aria-label="เลือกไฟล์รูปโปรไฟล์"
          className="sr-only"
          onChange={(e) => pick(e.target.files?.[0])}
        />
      </span>

        {/* ผู้ดูแลระบบไม่มีชื่อคนและไม่มีตำแหน่ง — บรรทัดเดียวว่า "ผู้ดูแลระบบ" พอ (เจ้าของสั่ง 25 ก.ย. 2569) */}
        <div className="min-w-0 lg:mt-3.5">
          <h2 className="truncate text-[17px] font-semibold">{me.name}</h2>
          {(
            <p className="mt-[3px] truncate text-[13px] text-muted-foreground">
              {me.position}
            </p>
          )}
        </div>
      </div>

      {/*
        มือถือ: สามช่องเท่า ๆ กันในแถวเดียว ไอคอนอยู่บน ชื่ออยู่ล่าง · ออกจากระบบกินเต็มแถวถัดไป
        เดิมเป็นชิปเรียงแถวเดียวที่ต้องเลื่อนซ้ายขวา ปุ่มท้ายแถวจึงถูกซ่อนอยู่นอกจอ
        คนที่ไม่รู้ว่าเลื่อนได้จะหาไม่เจอ (เจ้าของแจ้ง 25 ก.ย. 2569)
        จอใหญ่: เมนูแนวตั้งเหมือนเดิม
      */}
      <div className="mt-4 grid grid-cols-3 gap-2 lg:mt-5 lg:flex lg:flex-col lg:gap-1 lg:text-left">
        {panes.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => onPane(p.key)}
            className={`flex min-w-0 flex-col items-center justify-start gap-1 rounded-[14px] px-2 py-2.5 text-[12px] leading-tight font-medium transition-colors lg:w-full lg:flex-row lg:gap-[11px] lg:rounded-xl lg:px-3.5 lg:py-[11px] lg:text-[13.5px] ${
              pane === p.key
                ? "bg-accent font-semibold text-primary"
                : "bg-secondary text-muted-foreground lg:bg-transparent lg:hover:bg-muted lg:hover:text-foreground"
            }`}
          >
            {p.icon}
            <span className="min-w-0 text-center lg:text-left">{p.label}</span>
          </button>
        ))}
        <hr className="mx-1 my-1.5 hidden border-border lg:block" />
        <a
          href="/login"
          className="col-span-3 flex items-center justify-center gap-2 rounded-[14px] bg-secondary px-3.5 py-2.5 text-[13px] font-medium text-primary transition-colors lg:w-full lg:justify-start lg:gap-[11px] lg:rounded-xl lg:bg-transparent lg:py-[11px] lg:hover:bg-accent/60"
        >
          <LogoutIcon className="size-4" />
          ออกจากระบบ
        </a>
      </div>

      {cropping && (
        <PhotoCropper
          src={cropping}
          onCancel={() => setCropping(null)}
          onDone={(url) => {
            setProfilePhoto(url);
            setCropping(null);
          }}
        />
      )}
    </aside>
  );
}

// ─── ข้อมูลส่วนตัว ────────────────────────────────────────────────
function PersonalPane({ onSaved }: { onSaved: (m: string) => void }) {
  /* ระดับการศึกษาเพิ่มได้จากตรงนี้ — ใช้ชุดเดียวกับหน้าผู้ดูแลระบบ "ตัวเลือกในรายการ" */
  const addEdu = useAddOption({ list: "eduLevel" }, () => {});
  const me = useProfile();
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone);
  const [officePhone, setOfficePhone] = useState(me.officePhone);
  const [emPhone, setEmPhone] = useState(me.emergencyPhone);
  const [birth, setBirth] = useState(me.birth);
  const [nums, setNums] = useState({ weight: "", height: "", sibs: "", order: "" });
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [bad, setBad] = useState<{ name?: boolean; phone?: boolean }>({});
  const age = ageFrom(birth);

  function save() {
    const digits = phone.replace(/\D/g, "");
    const next = { name: !name.trim(), phone: digits.length < 9 };
    setBad(next);
    if (next.name || next.phone) return;
    /* เก็บเข้าสโตร์กลาง หน้าอื่นที่ใช้ชื่อ–เบอร์เดียวกันจะเปลี่ยนตามทันที */
    saveProfile({
      name: name.trim(),
      phone,
      officePhone,
      emergencyPhone: emPhone,
      birth,
    });
    onSaved("บันทึกข้อมูลส่วนตัวเรียบร้อย (ยังไม่มีระบบหลังบ้าน)");
  }

  return (
    <section className="glass rounded-[20px] px-4 py-5 sm:px-7 sm:py-[26px]">
      <h2 className="text-lg font-semibold">ข้อมูลส่วนตัว</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        ตามแบบฟอร์มข้อมูลประจำตัวพนักงาน MAZ · ช่องที่มี{" "}
        <em className="text-primary not-italic">*</em> ต้องกรอก
      </p>

      <H3>ข้อมูลทั่วไป</H3>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-5">
        <F
          label="ชื่อ–สกุล (ภาษาไทย)"
          required
          error={bad.name ? "กรอกชื่อ–สกุลภาษาไทย" : undefined}
        >
          <Input
            value={name}
            onChange={(v) => {
              setName(v);
              setBad((b) => ({ ...b, name: false }));
            }}
          />
        </F>
        <F label="ชื่อ–สกุล (ภาษาอังกฤษ)">
          <Input placeholder="Chitpon Panyanon" />
        </F>
        <F label="ชื่อเล่น">
          <Input />
        </F>
        <F label="เพศ">
          <div className="flex h-12 items-center gap-[18px]">
            {/* อ่านจากข้อมูลหลัก — เพิ่มเพศใหม่แล้วขึ้นให้เลือกที่นี่ด้วย */}
            {optionsOf("sex").map((g) => (
              <label
                key={g}
                className="flex cursor-pointer items-center gap-2.5 text-[13.5px] font-medium"
              >
                <input
                  type="radio"
                  name="sex"
                  defaultChecked={g === optionsOf("sex")[0]}
                  className="size-[19px] accent-[var(--primary)]"
                />
                {g}
              </label>
            ))}
          </div>
        </F>

        <div className="sm:col-span-2">
          <F label="ที่อยู่ที่ติดต่อได้">
            <textarea
              aria-label="ที่อยู่ที่ติดต่อได้"
              className="field-control h-[86px] resize-y rounded-xl px-[15px] py-3 text-sm leading-relaxed"
              placeholder="บ้านเลขที่ ถนน ตำบล อำเภอ จังหวัด รหัสไปรษณีย์"
            />
          </F>
        </div>

        <F
          label="เบอร์ติดต่อ"
          required
          error={bad.phone ? "กรอกเบอร์ติดต่อให้ครบ 9–10 หลัก" : undefined}
        >
          <Input
            inputMode="numeric"
            value={phone}
            onChange={(v) => {
              setPhone(formatPhone(v));
              setBad((b) => ({ ...b, phone: false }));
            }}
          />
        </F>
        <F label="เบอร์ออฟฟิศที่ถืออยู่">
          <Input
            inputMode="numeric"
            placeholder="ถ้าบริษัทให้เครื่องด้วย"
            value={officePhone}
            onChange={(v) => setOfficePhone(formatPhone(v))}
          />
        </F>
        <F label="E-mail (ส่วนตัว)">
          <Input type="email" placeholder="name@example.com" />
        </F>
        <F label="E-mail (บริษัท)">
          <Input defaultValue={me.email} readOnly />
        </F>
        <F label="ID LINE">
          <Input placeholder="@lineid" />
        </F>
        <F label="วัน/เดือน/ปีเกิด">
          <DateField
            value={birth}
            onChange={setBirth}
            label="วัน/เดือน/ปีเกิด"
            max={todayIso()}
            clearable
            className="h-12 rounded-xl px-[15px] text-sm font-normal"
          />
        </F>
        <F label="อายุ" hint="คำนวณจากวันเกิดอัตโนมัติ">
          <Input value={age} readOnly />
        </F>
        <F label="สถานภาพสมรส">
          <Select options={["โสด", "สมรส", "หย่าร้าง", "หม้าย"]} />
        </F>
        <F label="น้ำหนัก (กก.)">
          <Input
            inputMode="numeric"
            placeholder="0"
            value={nums.weight}
            onChange={(v) => setNums((n) => ({ ...n, weight: digits3(v) }))}
          />
        </F>
        <F label="ส่วนสูง (ซม.)">
          <Input
            inputMode="numeric"
            placeholder="0"
            value={nums.height}
            onChange={(v) => setNums((n) => ({ ...n, height: digits3(v) }))}
          />
        </F>
        <F label="เชื้อชาติ">
          <Input placeholder="ไทย" />
        </F>
        <F label="สัญชาติ">
          <Input placeholder="ไทย" />
        </F>
        <F label="การรับราชการทหาร">
          <Select
            options={[
              "ผ่านการเกณฑ์ทหารแล้ว",
              "ได้รับการยกเว้น",
              "ยังไม่ได้เกณฑ์",
              "ไม่เกี่ยวข้อง",
            ]}
          />
        </F>
      </div>

      <H3>ข้อมูลครอบครัว</H3>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-5">
        <F label="ชื่อบิดา">
          <Input />
        </F>
        <F label="อาชีพบิดา">
          <Input />
        </F>
        <F label="ชื่อมารดา">
          <Input />
        </F>
        <F label="อาชีพมารดา">
          <Input />
        </F>
        <F label="จำนวนพี่น้อง (คน)">
          <Input
            inputMode="numeric"
            placeholder="0"
            value={nums.sibs}
            onChange={(v) => setNums((n) => ({ ...n, sibs: digits3(v) }))}
          />
        </F>
        <F label="คุณเป็นบุตรคนที่">
          <Input
            inputMode="numeric"
            placeholder="0"
            value={nums.order}
            onChange={(v) => setNums((n) => ({ ...n, order: digits3(v) }))}
          />
        </F>
      </div>

      <div className="flex items-center justify-between gap-3">
        <H3>ประวัติการศึกษา</H3>
        {addEdu.canAdd && (
          <button type="button" className="lnk text-[12.5px]" onClick={() => addEdu.pick(ADD_VALUE)}>
            ＋ เพิ่มระดับการศึกษา
          </button>
        )}
      </div>
      {addEdu.dialog}
      {/* จอเล็กกรอกทีละระดับ จอใหญ่เป็นตารางเหมือนแบบฟอร์มกระดาษ */}
      <div className="space-y-3 md:hidden">
        {optionsOf("eduLevel").map((lv) => (
          <div key={lv} className="glass-thin rounded-[14px] p-3.5">
            <p className="mb-2.5 text-[12.5px] font-semibold text-muted-foreground">
              {lv}
            </p>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="col-span-2">
                <Input placeholder="ชื่อสถานศึกษา" aria-label={`สถานศึกษา ${lv}`} />
              </div>
              <Input placeholder="ประเทศ" aria-label={`ประเทศ ${lv}`} />
              <Input placeholder="สาขาวิชา" aria-label={`สาขาวิชา ${lv}`} />
              <Input
                inputMode="decimal"
                placeholder="เกรด 0.00"
                aria-label={`เกรด ${lv}`}
              />
              <Input
                inputMode="numeric"
                placeholder="ปีที่สำเร็จ"
                aria-label={`ปีที่สำเร็จ ${lv}`}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="glass-thin hidden overflow-x-auto rounded-[14px] md:block">
        <table className="data-table min-w-[760px]">
          <thead>
            <tr>
              <th style={{ width: 170 }}>ระดับการศึกษา</th>
              <th>ชื่อสถานศึกษา</th>
              <th style={{ width: 130 }}>ประเทศ</th>
              <th style={{ width: 140 }}>สาขาวิชา</th>
              <th style={{ width: 100 }}>เกรดเฉลี่ย</th>
              <th style={{ width: 110 }}>ปีที่สำเร็จ</th>
            </tr>
          </thead>
          <tbody>
            {optionsOf("eduLevel").map((lv) => (
              <tr key={lv}>
                <td className="text-[12.5px] font-medium whitespace-nowrap text-muted-foreground">
                  {lv}
                </td>
                <td>
                  <input className="field-control h-[38px] text-[13px]" aria-label={`สถานศึกษา ${lv}`} />
                </td>
                <td>
                  <input className="field-control h-[38px] text-[13px]" placeholder="ไทย" aria-label={`ประเทศ ${lv}`} />
                </td>
                <td>
                  <input className="field-control h-[38px] text-[13px]" aria-label={`สาขาวิชา ${lv}`} />
                </td>
                <td>
                  <input className="field-control h-[38px] text-[13px]" inputMode="decimal" placeholder="0.00" aria-label={`เกรด ${lv}`} />
                </td>
                <td>
                  <input className="field-control h-[38px] text-[13px]" inputMode="numeric" placeholder="2562" aria-label={`ปีที่สำเร็จ ${lv}`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H3>บุคคลที่ติดต่อได้กรณีเร่งด่วน</H3>
      <div className="grid gap-4 sm:grid-cols-2 sm:gap-x-5">
        <F label="ชื่อ–สกุล">
          <Input />
        </F>
        <F label="ความสัมพันธ์">
          <Select
            options={["บิดา", "มารดา", "คู่สมรส", "พี่น้อง", "บุตร", "ญาติ", "เพื่อน"]}
          />
        </F>
        <F label="โทรศัพท์">
          <Input
            inputMode="numeric"
            placeholder="08x-xxx-xxxx"
            value={emPhone}
            onChange={(v) => setEmPhone(formatPhone(v))}
          />
        </F>
      </div>

      <H3>เอกสารแนบ</H3>
      <FileDrop
        files={files}
        onChange={setFiles}
        title="แนบรูปถ่าย"
        hint="รูปถ่ายหน้าตรง พื้นหลังสุภาพ · JPG หรือ PNG"
        accept="image/*"
        label="เลือกรูปถ่าย"
      />

      {/* ฟอร์มยาวมาก — มือถือให้ปุ่มบันทึกลอยอยู่เหนือแถบล่างตลอด ไม่ต้องเลื่อนลงไปหา */}
      <div className="mt-[26px] grid gap-3.5 max-sm:sticky max-sm:bottom-[calc(var(--botbar)+10px)] max-sm:z-10 max-sm:grid-cols-2 max-sm:gap-2.5 max-sm:rounded-2xl max-sm:border max-sm:border-border max-sm:bg-card max-sm:p-2.5 max-sm:shadow-[0_-6px_16px_-10px_rgb(0_0_0/0.25)] sm:grid-cols-2">
        <button
          type="button"
          className="h-12 rounded-[14px] border-[1.5px] border-primary bg-white text-[14.5px] font-semibold text-primary transition-colors hover:bg-accent max-sm:h-11 max-sm:text-[13.5px]"
          onClick={() => setBad({})}
        >
          ยกเลิกการแก้ไข
        </button>
        <button
          type="button"
          className="btn-solid h-12 rounded-[14px] text-[14.5px] font-semibold max-sm:h-11 max-sm:text-[13.5px]"
          onClick={save}
        >
          บันทึกการเปลี่ยนแปลง
        </button>
      </div>
    </section>
  );
}

/** ช่องกรอกมาตรฐานของหน้านี้ — สูง 48px มุมมน 12px ตามแบบฟอร์ม */
function Input({
  value,
  onChange,
  className,
  ...props
}: Omit<React.InputHTMLAttributes<HTMLInputElement>, "onChange"> & {
  onChange?: (v: string) => void;
}) {
  return (
    <input
      {...props}
      value={value}
      onChange={onChange ? (e) => onChange(e.target.value) : undefined}
      className={`field-control h-12 rounded-xl px-[15px] text-sm ${className ?? ""}`}
    />
  );
}

function Select({ options, id }: { options: string[]; id?: string }) {
  return (
    <select id={id} className="field-control h-12 cursor-pointer rounded-xl px-[15px] text-sm">
      <option value="">ยังไม่ระบุ</option>
      {options.map((o) => (
        <option key={o}>{o}</option>
      ))}
    </select>
  );
}

function digits3(v: string) {
  return v.replace(/\D/g, "").slice(0, 3);
}

// ─── การแจ้งเตือน ─────────────────────────────────────────────────
const LEAD_IN = [0, 5, 10, 15, 30];
const LEAD_OUT = [0, 5, 10, 15];
const REPEAT = [0, 5, 10, 15];

function NotifyPane({ onSaved }: { onSaved: (m: string) => void }) {
  const stored = useNotifySettings();
  /* แก้ในหน้าก่อน กดบันทึกแล้วค่อยเขียนลงสโตร์ที่หน้าอื่นอ่าน */
  const [draft, setDraft] = useState<NotifySettings>(stored);
  const { on, leadIn, leadOut, repeat, quietLunch: quiet, channels } = draft;
  const patch = (v: Partial<NotifySettings>) => setDraft((d) => ({ ...d, ...v }));
  const setOn = (v: boolean) => patch({ on: v });
  const setLeadIn = (v: number) => patch({ leadIn: v });
  const setLeadOut = (v: number) => patch({ leadOut: v });
  const setRepeat = (v: number) => patch({ repeat: v });
  const setQuiet = (v: boolean) => patch({ quietLunch: v });
  /** เดสก์ท็อปสั่นไม่ได้ ปิดสวิตช์ไว้เลยจะได้ไม่หลอกกัน */
  const canVibrate =
    typeof navigator !== "undefined" && "vibrate" in navigator;

  return (
    <section className="glass rounded-[20px] px-4 py-5 sm:px-7 sm:py-[26px]">
      <h2 className="text-lg font-semibold">การแจ้งเตือน</h2>
      <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
        เลือกได้ว่าเรื่องไหนจะเตือนด้วยวิธีใด ระบบยังคงส่งเรื่องสำคัญที่เกี่ยวกับบัญชีของคุณเสมอ
      </p>

      <div className="glass-thin mt-5 flex items-center justify-between gap-3 rounded-[14px] px-4 py-3.5 text-sm font-semibold">
        <span>
          เปิดการแจ้งเตือน
          <small className="mt-0.5 block text-[11.5px] font-normal text-muted-foreground">
            {on
              ? "ป๊อปอัปจะเด้งให้อัตโนมัติเมื่อถึงเวลาและอยู่ในพื้นที่ทำงาน"
              : "ปิดอยู่ · ต้องกดปุ่มเช็คอินเองทุกครั้ง"}
          </small>
        </span>
        <Switch on={on} onToggle={() => setOn(!on)} label="เปิดการแจ้งเตือน" />
      </div>

      <div className={on ? "" : "pointer-events-none opacity-40"}>
        <div className="mt-5 grid grid-cols-[minmax(0,1fr)_44px_44px_44px] sm:grid-cols-[minmax(0,1fr)_60px_60px_60px] gap-2.5 border-b border-border pb-2.5">
          <span />
          {NOTIFY_CHANNELS.map((c) => (
            <span key={c.key} className="text-center text-[11.5px] font-semibold text-muted-foreground">
              {c.label}
            </span>
          ))}
        </div>

        {NOTIFY_EVENTS.map((e) => (
          <div
            key={e.key}
            className="grid grid-cols-[minmax(0,1fr)_44px_44px_44px] sm:grid-cols-[minmax(0,1fr)_60px_60px_60px] items-center gap-2.5 border-b border-border py-4 last:border-b-0"
          >
            <span>
              <b className="block text-[13.5px] font-semibold">{e.title}</b>
              <span className="mt-[3px] block text-xs leading-relaxed text-muted-foreground">
                {e.detail}
              </span>
            </span>
            {NOTIFY_CHANNELS.map((c) => (
              <span key={c.key} className="flex justify-center">
                <Switch
                  on={channels[e.key][c.key]}
                  label={`${e.title} — ${c.label}`}
                  disabled={c.key === "vibrate" && !canVibrate}
                  onToggle={() =>
                    patch({
                      channels: {
                        ...channels,
                        [e.key]: { ...channels[e.key], [c.key]: !channels[e.key][c.key] },
                      },
                    })
                  }
                />
              </span>
            ))}
          </div>
        ))}

        <H3>เวลาแจ้งเตือน</H3>
        <div className="grid gap-[18px]">
          <Pills label="เตือนล่วงหน้าก่อนเข้างาน" options={LEAD_IN} value={leadIn} onChange={setLeadIn} zero="ตรงเวลา" />
          <Pills label="เตือนตอนเลิกงาน" options={LEAD_OUT} value={leadOut} onChange={setLeadOut} zero="ตรงเวลา" />
          <Pills label="เตือนซ้ำถ้ายังไม่กด" options={REPEAT} value={repeat} onChange={setRepeat} zero="ไม่เตือนซ้ำ" every />
        </div>

        <H3>อื่น ๆ</H3>
        <div className="flex items-center justify-between gap-3 py-3.5 text-[13.5px]">
          <span>
            ปิดเสียงช่วงพักกลางวัน
            <small className="mt-0.5 block text-[11.5px] text-muted-foreground">
              12:00–13:00 น. แจ้งเตือนแบบเงียบ
            </small>
          </span>
          <Switch on={quiet} onToggle={() => setQuiet(!quiet)} label="ปิดเสียงช่วงพักกลางวัน" />
        </div>
      </div>

      <div className="mt-[26px] grid gap-3.5 sm:grid-cols-2">
        <button
          type="button"
          className="h-12 rounded-[14px] border-[1.5px] border-primary bg-white text-[14.5px] font-semibold text-primary transition-colors hover:bg-accent"
          onClick={() => setDraft(stored)}
        >
          ยกเลิกการแก้ไข
        </button>
        <button
          type="button"
          className="btn-solid h-12 rounded-[14px] text-[14.5px] font-semibold"
          onClick={() => {
            saveNotifySettings(draft);
            onSaved("บันทึกการตั้งค่าแจ้งเตือนเรียบร้อย");
          }}
        >
          บันทึกการเปลี่ยนแปลง
        </button>
      </div>
    </section>
  );
}

function Pills({
  label,
  options,
  value,
  onChange,
  zero,
  every,
}: {
  label: string;
  options: number[];
  value: number;
  onChange: (v: number) => void;
  zero: string;
  every?: boolean;
}) {
  return (
    <div>
      <p className="mb-2.5 text-[12.5px] font-semibold text-muted-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            onClick={() => onChange(o)}
            className={`rounded-xl border-[1.5px] px-4 py-2.5 text-[13px] transition-colors ${
              o === value
                ? "border-primary bg-accent font-semibold text-primary"
                : "border-border bg-white text-muted-foreground hover:border-muted-foreground/40"
            }`}
          >
            {o === 0 ? zero : `${every ? "ทุก " : ""}${o} นาที`}
          </button>
        ))}
      </div>
    </div>
  );
}

function Switch({
  on,
  onToggle,
  label,
  disabled,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      title={disabled ? "สั่นใช้ได้เฉพาะบนมือถือ" : undefined}
      onClick={onToggle}
      className={`relative h-[25px] w-11 shrink-0 rounded-[14px] transition-colors disabled:opacity-35 ${
        on ? "bg-primary" : "bg-[#dde2e9]"
      }`}
    >
      <span
        className={`absolute top-[3px] left-[3px] size-[19px] rounded-full bg-white shadow transition-transform ${
          on ? "translate-x-[19px]" : ""
        }`}
      />
    </button>
  );
}

// ─── รหัสผ่าน ─────────────────────────────────────────────────────
function SecurityPane({ onSaved }: { onSaved: (m: string) => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [touched, setTouched] = useState(false);

  const nextProblem = next ? passwordProblem(next) : "";
  const mismatch = confirm.length > 0 && confirm !== next;

  function save() {
    setTouched(true);
    if (!current || !next || nextProblem || confirm !== next) return;
    setCurrent("");
    setNext("");
    setConfirm("");
    setTouched(false);
    onSaved("เปลี่ยนรหัสผ่านเรียบร้อย (ยังไม่มีระบบหลังบ้าน)");
  }

  return (
    <section className="glass rounded-[20px] px-4 py-5 sm:px-7 sm:py-[26px]">
      <h2 className="text-lg font-semibold">รหัสผ่าน</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        เปลี่ยนรหัสผ่านที่ใช้เข้าสู่ระบบ
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <F
            label="รหัสผ่านปัจจุบัน"
            required
            error={touched && !current ? "กรอกรหัสผ่านปัจจุบัน" : undefined}
            hint="หากลืมรหัสผ่าน ต้องติดต่อฝ่ายบุคคลเพื่อรีเซ็ตให้"
          >
            <input
              type="password"
              className="field-control h-12 rounded-xl px-[15px] text-sm"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
            />
          </F>
        </div>
        <F
          label="รหัสผ่านใหม่"
          required
          error={nextProblem || (touched && !next ? "กรอกรหัสผ่านใหม่" : undefined)}
          hint="อย่างน้อย 8 ตัวอักษร · พิมพ์ใหญ่ · พิมพ์เล็ก · ตัวเลข · อักขระพิเศษ"
        >
          <input
            type="password"
            className="field-control h-12 rounded-xl px-[15px] text-sm"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        </F>
        <F
          label="ยืนยันรหัสผ่านใหม่"
          required
          error={mismatch ? "รหัสผ่านยืนยันไม่ตรงกัน" : undefined}
        >
          <input
            type="password"
            className="field-control h-12 rounded-xl px-[15px] text-sm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </F>
      </div>

      <div className="mt-[26px] grid gap-3.5 sm:grid-cols-2">
        <button
          type="button"
          className="h-12 rounded-[14px] border-[1.5px] border-primary bg-white text-[14.5px] font-semibold text-primary transition-colors hover:bg-accent"
          onClick={() => {
            setCurrent("");
            setNext("");
            setConfirm("");
            setTouched(false);
          }}
        >
          ยกเลิกการแก้ไข
        </button>
        <button
          type="button"
          className="btn-solid h-12 rounded-[14px] text-[14.5px] font-semibold"
          onClick={save}
        >
          เปลี่ยนรหัสผ่าน
        </button>
      </div>
    </section>
  );
}

// ─── ชิ้นส่วนร่วม ─────────────────────────────────────────────────
function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mt-6 mb-3 text-xs font-bold tracking-wide text-muted-foreground">
      {children}
    </h3>
  );
}

function F({
  label,
  required,
  hint,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  /* ผูก label กับช่องกรอกให้เอง หลักการเดียวกับ Field ใน ui.tsx */
  const id = useId();
  const kid =
    isValidElement<{ id?: string }>(children) && (children.type === Input || children.type === Select)
      ? cloneElement(children, { id })
      : children;

  return (
    <div>
      <label htmlFor={id} className="mb-[7px] block text-[12.5px] font-medium text-muted-foreground">
        {label}
        {required && <em className="ml-0.5 text-primary not-italic">*</em>}
      </label>
      {kid}
      {error ? (
        <p className="mt-1.5 text-[12.5px] text-destructive">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-[11.5px] text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}

function formatPhone(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 10);
  if (d.length > 6) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length > 3) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return d;
}

function ageFrom(iso: string) {
  if (!iso) return "";
  /* วันเกิดเป็น yyyy-mm-dd — new Date(iso) จะได้เที่ยงคืน UTC แล้วถอยไปวันก่อนบนเครื่องนอกไทย */
  const b = parseIsoDate(iso);
  const t = bkkNow();
  let a = t.getFullYear() - b.getFullYear();
  const m = t.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a -= 1;
  return a >= 0 ? `${a} ปี` : "";
}

/** คืนข้อความบอกว่าขาดอะไร หรือ "" ถ้าผ่าน */
function passwordProblem(v: string) {
  if (v.length < 8) return `ต้องมีอย่างน้อย 8 ตัวอักษร ตอนนี้มี ${v.length} ตัว`;
  if (!/[A-Z]/.test(v)) return "ต้องมีตัวพิมพ์ใหญ่อย่างน้อย 1 ตัว";
  if (!/[a-z]/.test(v)) return "ต้องมีตัวพิมพ์เล็กอย่างน้อย 1 ตัว";
  if (!/[0-9]/.test(v)) return "ต้องมีตัวเลขอย่างน้อย 1 ตัว";
  if (!/[^A-Za-z0-9]/.test(v)) return "ต้องมีอักขระพิเศษอย่างน้อย 1 ตัว เช่น . # / @ !";
  return "";
}

/* ─── แถบเมนูล่าง ───────────────────────────────────────────────── */

