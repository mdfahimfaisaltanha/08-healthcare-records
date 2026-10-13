import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "ClinicOS — Appointments & Records",
  description:
    "Healthcare appointment and records system with RBAC, field-level encryption, and append-only audit logging.",
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
