import assert from 'node:assert/strict'
import { test } from 'node:test'
import { cabecalhosSeguranca, validarConfigSupabase } from '../src/seguranca.js'

const jwt = (role) => `x.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.y`

test('só aceita a chave pública do Supabase no navegador', () => {
  const url = 'https://abc.supabase.co'
  assert.deepEqual(validarConfigSupabase({ url, chave: 'sb_publishable_123' }), { supabaseUrl: url, supabaseKey: 'sb_publishable_123' })
  assert.equal(validarConfigSupabase({ url, chave: jwt('anon') }).supabaseUrl, url)
  assert.throws(() => validarConfigSupabase({ url, chave: 'sb_secret_123' }), /secreta/)
  assert.throws(() => validarConfigSupabase({ url, chave: jwt('service_role') }), /secreta/)
  assert.throws(() => validarConfigSupabase({ url: 'http://abc.supabase.co', chave: 'sb_publishable_1' }), /https/)
  assert.throws(() => validarConfigSupabase({ url }), /juntos/)
  assert.equal(validarConfigSupabase({}), null)
})

test('CSP libera só o próprio site, o CDN fixo do supabase-js e o projeto Supabase', () => {
  const csp = cabecalhosSeguranca('https://abc.supabase.co')['content-security-policy']
  assert.match(csp, /script-src 'self' https:\/\/cdn\.jsdelivr\.net;/)
  assert.match(csp, /connect-src 'self' https:\/\/abc\.supabase\.co wss:\/\/abc\.supabase\.co;/)
  assert.match(csp, /font-src https:\/\/fonts\.gstatic\.com;/)
  assert.match(cabecalhosSeguranca()['content-security-policy'], /connect-src 'self';/)
})

test('CSP libera o mapa da aba Google Maps: CSS do Leaflet no CDN fixo e os tiles do OpenStreetMap', () => {
  const csp = cabecalhosSeguranca()['content-security-policy']
  assert.match(csp, /style-src 'self' https:\/\/fonts\.googleapis\.com https:\/\/cdn\.jsdelivr\.net;/)
  assert.match(csp, /img-src 'self' data: https:\/\/tile\.openstreetmap\.org;/)
})
