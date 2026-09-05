import {supabase} from './supabaseClient'
import {createWithdrawalRepository} from './mioWithdrawalRepository.js'
export const mioWithdrawalStore=createWithdrawalRepository(supabase)
