import { NextRequest, NextResponse } from 'next/server';
import { getSetting, setSetting } from '@/lib/local-db';

export async function GET(request: NextRequest) {
  try {
    const key = request.nextUrl.searchParams.get('key');
    if (key) {
      const value = getSetting(key);
      return NextResponse.json({ key, value });
    }
    return NextResponse.json({ error: 'Key parameter required' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { key, value } = await request.json();
    if (!key) {
      return NextResponse.json({ error: 'Key is required' }, { status: 400 });
    }
    setSetting(key, value);
    return NextResponse.json({ success: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
