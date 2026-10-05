import type { Metadata } from "next";
import { JourneysApp } from "@/components/JourneysApp";

export const metadata: Metadata = { title: "Journeys · OFP Planner" };

export default function Journeys() {
  return <JourneysApp />;
}
