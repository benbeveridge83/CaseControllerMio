// Fail closed if a later App revision changes the integration anchors.
export function transformMioCloudPersistence(source){
 let code=source
 const once=(from,to)=>{if(!code.includes(from)||code.indexOf(from)!==code.lastIndexOf(from))throw new Error(`V277 anchor changed: ${from.slice(0,100)}`);code=code.replace(from,to)}
 const region=(start,end,replacement)=>{const a=code.indexOf(start),b=code.indexOf(end,a+start.length);if(a<0||b<a)throw new Error(`V277 missing: ${start}`);code=code.slice(0,a)+replacement+'\n\n'+code.slice(b)}
 code="import { mioStorage, mioCloudStore } from './mioCloudRuntime.js'\nconst localStorage = mioStorage\n"+code
 code=code.replaceAll('window.localStorage','localStorage').replace(/const MIO_APP_VERSION = 'Mio V\d+'/,"const MIO_APP_VERSION = 'Mio V277 (cloud storage)'")
 once('  const mioCloudStateLoadedRef = useRef(false)',`  const mioCloudStateLoadedRef = useRef(false)
  const [mioCloudHydrationDone, setMioCloudHydrationDone] = useState(false)
  useEffect(() => {
    if (!mioCloudHydrationDone) return
    mioCloudStateLoadedRef.current = true
    mioCloudStateSkipSaveRef.current = false
    mioCloudStore.activate()
  }, [mioCloudHydrationDone])`)
 region('  function applyMioCloudStateRecord(record) {','  async function migrateExistingLocalStateToSupabase(userId) {',`  function applyMioCloudStateRecord(record) {
    const binding = getMioCloudStateBindings()[record.key]
    if (!binding) return
    binding.setter(coerceMioStoredValue(parseMioStoredValue(record, binding.fallback), binding.kind, binding.fallback), record)
  }`)
 region('  async function migrateExistingLocalStateToSupabase(userId) {','  async function loadMioCloudStateFromSupabase(userId) {',`  async function migrateExistingLocalStateToSupabase(userId) {
    // Account-confirmed migration now occurs in the root boundary before App mounts.
    return mioCloudStore.status().owner === userId
  }`)
 region('  async function loadMioCloudStateFromSupabase(userId) {','  async function saveMioStateKeyNow(key, value, options = {}) {',`  async function loadMioCloudStateFromSupabase(userId) {
    if (!userId || mioCloudStore.status().owner !== userId || mioCloudStateLoadingRef.current) return false
    mioCloudStateLoadingRef.current = true
    mioCloudStateSkipSaveRef.current = true
    try {
      mioCloudStore.records().forEach(applyMioCloudStateRecord)
      setMioCloudHydrationDone(true)
      return true
    } finally { mioCloudStateLoadingRef.current = false }
  }`)
 region('  async function saveMioStateKeyNow(key, value, options = {}) {','  function saveMioStateKey(key, value) {',`  async function saveMioStateKeyNow(key, value, options = {}) {
    if (!session?.user?.id || mioCloudStore.status().owner !== session.user.id) {
      if (options.throwOnError) throw new Error('Sign in before saving. No local fallback was written.')
      return false
    }
    return mioCloudStore.saveNow(key, value, options)
  }`)
 region('  function saveMioStateKey(key, value) {','  function normalizeTagLibrarySnapshot(value = []) {',`  function saveMioStateKey(key, value) {
    if (!session?.user?.id || mioCloudStore.status().owner !== session.user.id || !mioCloudStateLoadedRef.current || mioCloudStateSkipSaveRef.current) return
    mioCloudStore.stage(key, value)
  }`)
 once('        mioCloudStateLoadedRef.current = true\n        initialDataRetryAttemptRef.current = 0','        setMioCloudHydrationDone(true)\n        initialDataRetryAttemptRef.current = 0')
 region('  function clearMioBrowserCacheForAuthentication() {','  async function logIn(e) {',`  function clearMioBrowserCacheForAuthentication() {
    // Unverified local records are never deleted to make room for authentication.
  }`)
 const a=code.indexOf('        try {\n          const preserve = []'),b=code.indexOf('        const retry = await supabase.auth.signInWithPassword',a)
 if(a<0||b<a)throw new Error('V277 missing unsafe login-cache recovery')
 code=code.slice(0,a)+'        // The auth adapter has a session-only fallback. Never clear case data.\n'+code.slice(b)
 once('  async function logOut() {',`  async function logOut() {
    if (mioCloudStore.status().pending && !(await mioCloudStore.flushAll())) {
      alert('Changes remain unsaved. Use the cloud-save panel to retry or preserve pending edits before signing out.')
      return
    }`)
 region('  function collectMioLocalStorageSnapshot() {','  function downloadMioLocalStorageBackup() {',`  function collectMioLocalStorageSnapshot() {
    const values = Object.fromEntries(Object.entries(mioCloudStore.snapshot()).map(([key, raw]) => {
      let parsed = raw
      try { parsed = JSON.parse(raw) } catch {}
      return [key, { raw, parsed }]
    }))
    return { exported_at: new Date().toISOString(), origin: window.location.origin, user_email: session?.user?.email || '', values }
  }`)
 region('  async function pushMioLocalStorageBackupToSupabase() {','  function downloadMioRelationalPhase2Sql() {',`  async function pushMioLocalStorageBackupToSupabase() {
    if (!session?.user?.id) return alert('Please sign in first.')
    try {
      const rows = Object.entries(mioCloudStore.snapshot()).map(([key, raw_value]) => ({ key, raw_value }))
      for (let i = 0; i < rows.length; i += 8) await mioCloudStore.archive(rows.slice(i, i + 8), 'manual-cloud-backup')
      alert('A verified recovery copy was saved in Supabase. Active records were not overwritten.')
    } catch (error) { alert('Recovery copy could not be verified: ' + (error.message || String(error))) }
  }`)
 code=code.replaceAll('Local audit trail of approved attempts from this browser. Vercel logs also record successful server mutations.','Cloud-saved audit trail of approved attempts. Vercel logs also record successful server mutations.')
 code=code.replace(/^.*sessionStorage\.setItem\('caseMioContinueReliefMatter(?:Name|Id)'.*\n/gm,'')
 code=code.replaceAll('Saved automatically on this browser.', 'Saved automatically to Supabase.')
 code=code.replaceAll('Download emergency local backup', 'Download app-data backup')
 code=code.replaceAll('Migrate local data to Supabase</button>', 'Preserve cloud recovery copy</button>')
 code=code.replaceAll('Clear browser log', 'Clear saved log')
 code=code.replaceAll('was too large for localStorage. Large file contents were not saved locally.', 'could not be queued for cloud saving. Check the save-status panel.')
 if(code.includes('localStorage.clear()')||code.includes('window.localStorage'))throw new Error('V277 left a direct browser-storage escape')
 return code
}
export default function mioV277CloudPersistence(){return{name:'mio-v277-cloud-persistence',enforce:'pre',transform(source,id){if(!id.replaceAll('\\','/').endsWith('/src/App.jsx'))return null;return{code:transformMioCloudPersistence(source),map:null}}}}
