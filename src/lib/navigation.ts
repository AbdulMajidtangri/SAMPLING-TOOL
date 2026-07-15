export type MainScreenId = 'samplingWorkspace' | 'workingPaper'

export interface MainScreenOption {
  id: MainScreenId
  label: string
}

export const MAIN_SCREEN_OPTIONS: MainScreenOption[] = [
  { id: 'samplingWorkspace', label: 'Sampling Workspace' },
  { id: 'workingPaper', label: 'Working Paper' },
]
