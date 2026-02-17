import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function GET() {
  try {
    const { data, error } = await supabase
      .from("collections")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) throw error;
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch collections" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { name, appName, appDescription, description } = body;

    if (!name || !appName || !appDescription) {
      return NextResponse.json(
        { error: "Name, app name, and app description are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from("collections")
      .insert({
        name,
        app_name: appName,
        app_description: appDescription,
        description,
      })
      .select()
      .single();

    if (error) throw error;
    return NextResponse.json(data, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create collection" },
      { status: 500 }
    );
  }
}
