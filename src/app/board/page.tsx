import type { Metadata } from "next";
import { BoardApp } from "@/components/BoardApp";

export const metadata: Metadata = { title: "Board · OFP Planner" };

export default function Board() {
  return <BoardApp />;
}
