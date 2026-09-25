import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "DSKRU CO-OP · สหกรณ์โรงเรียน",
  description:
    "ร้านสหกรณ์โรงเรียน DSKRU สำหรับนักเรียนทุกคน · เลือกสินค้า ชำระเงิน และจัดการร้าน",
  icons: { icon: "/favicon.svg" },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th">
      <body>{children}</body>
    </html>
  );
}
