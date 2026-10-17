const env = import.meta.env as Record<string, string | undefined>;
export const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? '';
export const supabaseKey = (env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY)?.trim() ?? '';
export const supabaseConfigured = Boolean(supabaseUrl && supabaseKey && !supabaseUrl.includes('your-project'));
