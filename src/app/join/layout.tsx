import type { Metadata } from "next";
import { AuthFrame } from "@/components/nav/auth-frame";

export const metadata: Metadata = {
  title: "Join an exercise",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default function JoinLayout({ children }: { children: React.ReactNode }) {
  return <AuthFrame>{children}</AuthFrame>;
}
