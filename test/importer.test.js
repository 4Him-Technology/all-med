import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseScraperCsv, rowToLead } from '../src/importer.js'

test('mapeia as colunas do gosom/google-maps-scraper para o lead', () => {
  const lead = rowToLead({
    title: ' Clínica X ',
    category: 'Dentista',
    address: 'Rua 1, Campinas',
    phone: '(19) 3333-4444',
    website: 'https://x.com.br',
    emails: 'a@x.com.br, lixo, b@x.com.br',
    review_rating: '4.7',
    review_count: '128',
    latitude: '-22.9',
    longitude: '-47.06',
    link: 'https://www.google.com/maps/place/x',
    place_id: 'ChIJ123',
    cid: '999',
  })
  assert.deepEqual(lead, {
    nome: 'Clínica X',
    categoria: 'Dentista',
    endereco: 'Rua 1, Campinas',
    telefone: '(19) 3333-4444',
    site: 'https://x.com.br',
    emails: ['a@x.com.br', 'b@x.com.br'],
    avaliacao: 4.7,
    total_avaliacoes: 128,
    latitude: -22.9,
    longitude: -47.06,
    link_maps: 'https://www.google.com/maps/place/x',
    place_id: 'ChIJ123',
  })
})

test('usa cid como chave quando não há place_id e descarta URL insegura', () => {
  const lead = rowToLead({ title: 'Y', cid: '999', website: 'javascript:alert(1)' })
  assert.equal(lead.place_id, '999')
  assert.equal(lead.site, null)
})

test('corta os campos nos limites da tabela do Supabase', () => {
  const lead = rowToLead({ title: 'x'.repeat(300), address: 'y'.repeat(600), website: `https://${'a'.repeat(600)}.com`, place_id: 'p' })
  assert.equal(lead.nome.length, 200)
  assert.equal(lead.endereco.length, 500)
  assert.equal(lead.site, null)
})

test('linha sem título é ignorada e contada', () => {
  const r = parseScraperCsv('title,place_id\nA,1\n,2\n')
  assert.equal(r.leads.length, 1)
  assert.equal(r.ignorados, 1)
})

test('csv sem a coluna title é rejeitado', () => {
  assert.throws(() => parseScraperCsv('foo,bar\n1,2\n'), /title/)
})
