import { describe, expect, it } from 'vitest'
import { MAIN_SCREEN_OPTIONS } from './navigation'

describe('main screen navigation', () => {
  it('only exposes the two required screens', () => {
    expect(MAIN_SCREEN_OPTIONS.map((screen) => screen.id)).toEqual([
      'samplingWorkspace',
      'workingPaper',
    ])
    expect(MAIN_SCREEN_OPTIONS.map((screen) => screen.label)).toEqual([
      'Sampling Workspace',
      'Working Paper',
    ])
  })
})
