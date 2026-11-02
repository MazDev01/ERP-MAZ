import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import { AppShell } from "@/components/app-shell";
import { PwaBoot } from "@/components/pwa-boot";
import "./globals.css";

const notoThai = Noto_Sans_Thai({
  variable: "--font-noto-thai",
  subsets: ["thai", "latin"],
  /*
   * ไม่ระบุ weight — Noto Sans Thai เป็นฟอนต์แบบผันน้ำหนักได้ (variable font)
   * ไฟล์เดียวครอบคลุมน้ำหนัก 100–900 จึงได้ 800 ที่ใช้กับตัวเลขใหญ่และหัวข้อเด่นอยู่แล้ว
   *
   * เดิมระบุเป็นรายการ ["400"…"800"] ซึ่งบังคับให้โหลดไฟล์แยกน้ำหนักละไฟล์
   * ทางนั้นทำให้ next dev (Turbopack 16.3.4) พังทั้งหน้า ขึ้น
   * "Can't resolve @vercel/turbopack-next/internal/font/google/font"
   * ตรวจแล้วสลับกลับไปกลับมาสองรอบ ใส่แล้วพัง 500 ตัดออกแล้วได้ 200 (2 พ.ย. 2569)
   * ส่วน next build ไม่เป็น จึงไม่เคยเห็นตอนสั่ง build อย่างเดียว
   */
});

export const metadata: Metadata = {
  title: "ERP MAZ",
  description: "ระบบ ERP งานขายและงานบุคคลของ MAZ",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "ERP MAZ" },
};

export const viewport: Viewport = {
  themeColor: "#db0000",
  initialScale: 1,
  width: "device-width",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoThai.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col font-sans">
        <PwaBoot />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
