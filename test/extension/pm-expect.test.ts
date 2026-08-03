import { describe, it, expect as vExpect } from 'vitest'
import { expect } from '../../src/extension/scripting/pm-expect'

describe('pm.expect', () => {
  it('equal passes and fails', () => {
    expect(1).to.equal(1)
    vExpect(() => expect(1).to.equal(2)).toThrow()
  })
  it('eql does deep equality', () => {
    expect({ a: 1 }).to.eql({ a: 1 })
    vExpect(() => expect({ a: 1 }).to.eql({ a: 2 })).toThrow()
  })
  it('be.a checks type', () => {
    expect('x').to.be.a('string')
    vExpect(() => expect(1).to.be.a('string')).toThrow()
  })
  it('include works for arrays and strings', () => {
    expect([1, 2]).to.include(2)
    expect('hello').to.include('ell')
    vExpect(() => expect([1]).to.include(9)).toThrow()
  })
  it('be.ok / be.true / be.false', () => {
    expect(1).to.be.ok
    expect(true).to.be.true
    expect(false).to.be.false
    vExpect(() => { expect(0).to.be.ok }).toThrow()
  })
  it('be.above / be.below', () => {
    expect(5).to.be.above(3)
    expect(2).to.be.below(3)
    vExpect(() => expect(2).to.be.above(3)).toThrow()
  })
  it('negation via .to.not', () => {
    expect(1).to.not.equal(2)
    vExpect(() => expect(1).to.not.equal(1)).toThrow()
  })
})
