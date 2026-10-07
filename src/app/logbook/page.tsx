import type { Metadata } from "next";
import { LogbookApp } from "@/components/LogbookApp";

export const metadata: Metadata = { title: "Logbook · OFP Planner" };

export default function Logbook() {
  return <LogbookApp />;
}
