import type { MetadataRoute } from "next";

/** ให้ติดตั้งลงหน้าจอโฮมได้เหมือนแอป — ตรงกับ manifest ในแบบ UI */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ERP MAZ",
    short_name: "ERP MAZ",
    description: "ระบบ ERP งานขายและงานบุคคลของ MAZ",
    lang: "th",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f4f5f7",
    theme_color: "#db0000",
    /*
     * ต้องมี PNG ด้วย ไม่ใช่ SVG อย่างเดียว
     * iPhone ใช้ apple-touch-icon (PNG) ตอน "เพิ่มไปยังหน้าจอโฮม" ถ้าไม่มีจะเอาภาพหน้าจอเว็บไปทำไอคอน
     * ส่วน Android บาง launcher ก็ยังไม่รับ SVG (เจอตอนเตรียมทดสอบบนมือถือจริง 16 พ.ย. 2569)
     */
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
