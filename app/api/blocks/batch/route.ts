import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { blocks } = await req.json() as {
    blocks: Array<{ title: string; start_time: string; end_time: string }>;
  };

  if (!Array.isArray(blocks) || blocks.length === 0) {
    return NextResponse.json({ error: 'blocks array is required' }, { status: 400 });
  }
  if (blocks.length > 90) {
    return NextResponse.json({ error: 'Too many blocks (max 90)' }, { status: 400 });
  }

  const supabase = createSupabaseServer();

  const rows = blocks.map((b) => ({
    user_id:    user.id,
    title:      b.title,
    start_time: b.start_time,
    end_time:   b.end_time,
  }));

  const { data, error } = await supabase
    .from('calendar_blocks')
    .insert(rows)
    .select();

  if (error) {
    console.error('[POST /api/blocks/batch]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ blocks: data });
}
