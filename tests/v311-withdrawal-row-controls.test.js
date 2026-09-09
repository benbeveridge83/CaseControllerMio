import test from 'node:test'

test('V311 actual configured transform pipeline and persistence acknowledgements',async()=>{
 await import('../scripts/test-withdrawal-release.mjs')
})
