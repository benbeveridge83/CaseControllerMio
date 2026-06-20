import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://vnnkxqpyndidnjbrbywz.supabase.co'
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZubmt4cXB5bmRpZG5qYnJieXd6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc1ODA5MjksImV4cCI6MjA5MzE1NjkyOX0.MHxhT_mLzMZv6r4mvOcNvtR_kGcsY1yuXhYWL2luntI'

export const supabase = createClient(supabaseUrl, supabaseAnonKey)