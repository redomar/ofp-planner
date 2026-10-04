import type { Metadata } from "next";
import { SettingsApp } from "@/components/SettingsApp";

export const metadata: Metadata = { title: "Settings · OFP Planner" };

export default function Settings() {
  return <SettingsApp />;
}
