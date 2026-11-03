import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseCsv } from '../src/csv.js'

test('parseia cabeçalho, aspas, vírgulas e quebras de linha dentro do campo', () => {
  const txt = '﻿title,address,emails\r\n"Padaria ""Boa""","Rua A, 10\nCentro","a@x.com, b@x.com"\r\nOutra,,\r\n\r\n'
  assert.deepEqual(parseCsv(txt), [
    { title: 'Padaria "Boa"', address: 'Rua A, 10\nCentro', emails: 'a@x.com, b@x.com' },
    { title: 'Outra', address: '', emails: '' },
  ])
})

test('csv vazio ou só com cabeçalho vira lista vazia', () => {
  assert.deepEqual(parseCsv(''), [])
  assert.deepEqual(parseCsv('title,address\n'), [])
})
