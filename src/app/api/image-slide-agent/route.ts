import { NextRequest } from "next/server";
import {
  GET as videoAgentGET,
  POST as videoAgentPOST,
} from "@/app/api/video-agent/image-slide-agent/route";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return videoAgentGET(request);
}

export async function POST(request: NextRequest) {
  return videoAgentPOST(request);
}
