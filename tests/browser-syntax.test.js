import test from 'node:test'
import assert from 'node:assert/strict'
import {checkBrowserSyntax} from '../mio-browser-syntax-check.js'
test('release build syntax gate rejects the exact white-screen regex regression',()=>{
 assert.doesNotThrow(()=>checkBrowserSyntax(String.raw`export const good=/^\[\[MIO_BLOCK:([a-z0-9_]+)\]\]$/i;`))
 assert.throws(()=>checkBrowserSyntax('export const bad=/^[[MIO_BLOCK:([a-z0-9_]+)]]$/i;'),/Browser JavaScript validation failed/)
 assert.throws(()=>checkBrowserSyntax('export function broken( {'),/Browser JavaScript validation failed/)
})
