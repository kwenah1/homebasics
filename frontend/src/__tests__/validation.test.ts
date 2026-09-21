import { describe, expect, it } from 'vitest'

import { passwordProblems, registerSchema, safeNext } from '../lib/validation'

describe('passwordProblems (ACC-02, must match backend policy)', () => {
  it.each([
    ['abcdefg1', []],
    ['A'.repeat(63) + '1', []],
    ['abcdef1', ['at least 8 characters']],
    ['A'.repeat(64) + '1', ['at most 64 characters']],
    ['abcdefgh', ['at least one number']],
    ['12345678', ['at least one letter']],
    ['!!', ['at least 8 characters', 'at least one letter', 'at least one number']],
    ['é'.repeat(39) + '1', ['at most 64 characters', 'at least one letter']],
  ])('%j -> %j', (password, expected) => {
    expect(passwordProblems(password)).toEqual(expected)
  })
})

describe('registerSchema', () => {
  const valid = {
    first_name: 'Ann',
    last_name: 'Lee',
    email: 'ann@homebasics.test',
    password: 'Sparkle123',
    confirm_password: 'Sparkle123',
  }

  it('accepts a valid form', () => {
    expect(registerSchema.safeParse(valid).success).toBe(true)
  })

  it('flags mismatched confirmation on the confirm field', () => {
    const result = registerSchema.safeParse({ ...valid, confirm_password: 'Different1' })
    expect(result.success).toBe(false)
    expect(result.error?.issues[0].path).toEqual(['confirm_password'])
  })

  it('trims names and rejects blanks', () => {
    expect(registerSchema.safeParse({ ...valid, first_name: '   ' }).success).toBe(false)
  })
})

describe('safeNext (open-redirect guard)', () => {
  it.each([
    ['/account', '/account'],
    ['/c/kitchen?page=2', '/c/kitchen?page=2'],
    [null, '/account'],
    ['', '/account'],
    ['https://evil.example', '/account'],
    ['//evil.example', '/account'],
    ['/\\evil.example', '/account'],
    ['javascript:alert(1)', '/account'],
  ])('%j -> %j', (input, expected) => {
    expect(safeNext(input)).toBe(expected)
  })
})
