import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'

export async function POST(request: NextRequest) {
    let response = NextResponse.json({ ok: true })

    const supabase = createServerClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
            cookies: {
                getAll() {
                    return request.cookies.getAll()
                },
                setAll(cookiesToSet) {
                    // mutate request cookies and mirror on response
                    cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
                    response = NextResponse.json({ ok: true })
                    cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
                },
            },
        }
    )

    try {
        const { event, session } = await request.json()

        if (event === 'SIGNED_OUT') {
            await supabase.auth.signOut()
            return response
        }

        if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) {
            // Set the session on the server so middleware can read cookies on SSR
            await supabase.auth.setSession({
                access_token: session.access_token,
                refresh_token: session.refresh_token,
            } as any)
        }
    } catch (e) {
        // ignore malformed body
    }

    return response
}
