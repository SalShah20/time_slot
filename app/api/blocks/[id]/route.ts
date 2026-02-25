import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';

export async function DELETE(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();
  const { error } = await supabase
    .from('calendar_blocks')
    .delete()
    .eq('id', params.id)
    .eq('user_id', user.id); // prevent deleting other users' blocks

  if (error) {
    console.error('[DELETE /api/blocks/[id]]', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
