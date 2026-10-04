import type { Metadata } from "next";
import { BriefApp } from "@/components/BriefApp";

export const metadata: Metadata = { title: "Brief · OFP Planner" };

export default function Brief() {
  return <BriefApp />;
}
