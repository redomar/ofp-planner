import type { Metadata } from "next";
import { RangeApp } from "@/components/RangeApp";

export const metadata: Metadata = { title: "Range · OFP Planner" };

export default function Range() {
  return <RangeApp />;
}
