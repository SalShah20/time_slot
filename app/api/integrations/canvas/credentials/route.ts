import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, createSupabaseServer } from '@/lib/supabase-server';
import { checkPremium } from '@/lib/premium';
import { validateCanvasCredentials } from '@/lib/canvasApi';

/** Save Canvas credentials after validating them. */
export async function POST(req: NextRequest) {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  if (!(await checkPremium(supabase, user.id))) {
    return NextResponse.json({ error: 'Canvas integration requires Premium' }, { status: 403 });
  }

  const { canvas_token, canvas_domain } = (await req.json()) as {
    canvas_token?: string;
    canvas_domain?: string;
  };

  if (!canvas_token || !canvas_domain) {
    return NextResponse.json({ error: 'canvas_token and canvas_domain are required' }, { status: 400 });
  }

  // Strip protocol/trailing slashes — we only need the hostname
  const domain = canvas_domain.replace(/^https?:\/\//, '').replace(/\/+$/, '');

  const valid = await validateCanvasCredentials(domain, canvas_token);
  if (!valid) {
    return NextResponse.json(
      { error: 'Invalid Canvas credentials. Check your token and institution URL.' },
      { status: 400 },
    );
  }

  const { error } = await supabase
    .from('user_tokens')
    .update({ canvas_token, canvas_domain: domain })
    .eq('user_id', user.id);

  if (error) {
    console.error('[canvas/credentials] update error:', error);
    return NextResponse.json({ error: 'Failed to save credentials' }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** Disconnect Canvas — clear credentials. */
export async function DELETE() {
  const user = await getAuthUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const supabase = createSupabaseServer();

  await supabase
    .from('user_tokens')
    .update({
      canvas_token: null,
      canvas_domain: null,
      canvas_last_synced: null,
      canvas_auto_sync: false,
    })
    .eq('user_id', user.id);

  return NextResponse.json({ success: true });
}
