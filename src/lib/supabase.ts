import { createClient } from '@supabase/supabase-js';
import { supabaseConfigured, supabaseKey, supabaseUrl } from './config';
export const supabase = supabaseConfigured ? createClient(supabaseUrl, supabaseKey, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
