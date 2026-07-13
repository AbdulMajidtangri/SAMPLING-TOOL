import { useMemo, useState } from 'react'
import './App.css'

type SampleMethod = 'random' | 'systematic' | 'stratified'

function pickRandomSample<T>(items: T[], size: number): T[] {
  const copy = [...items]
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[copy[i], copy[j]] = [copy[j], copy[i]]
  }
  return copy.slice(0, size)
}

function pickSystematicSample<T>(items: T[], size: number): T[] {
  if (size <= 0 || items.length === 0) return []
  const interval = Math.max(1, Math.floor(items.length / size))
  const start = Math.floor(Math.random() * interval)
  const sample: T[] = []
  for (let i = start; sample.length < size && i < items.length; i += interval) {
    sample.push(items[i])
  }
  return sample
}

function App() {
  const [rawInput, setRawInput] = useState(
    'Alice\nBob\nCarol\nDave\nEve\nFrank\nGrace\nHeidi\nIvan\nJudy',
  )
  const [sampleSize, setSampleSize] = useState(3)
  const [method, setMethod] = useState<SampleMethod>('random')
  const [result, setResult] = useState<string[]>([])

  const population = useMemo(
    () =>
      rawInput
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    [rawInput],
  )

  function runSample() {
    const size = Math.min(Math.max(1, sampleSize), population.length)
    if (population.length === 0) {
      setResult([])
      return
    }

    if (method === 'systematic') {
      setResult(pickSystematicSample(population, size))
      return
    }

    // random + stratified (single group for now)
    setResult(pickRandomSample(population, size))
  }

  return (
    <div className="app">
      <header className="header">
        <div>
          <p className="eyebrow">Desktop</p>
          <h1>Sampling Tool</h1>
          <p className="subtitle">
            Build a sample from a population list using Electron + React.
          </p>
        </div>
        <span className="platform">
          {window.electronAPI?.platform ?? 'web'}
        </span>
      </header>

      <main className="layout">
        <section className="panel">
          <label htmlFor="population">Population (one item per line)</label>
          <textarea
            id="population"
            value={rawInput}
            onChange={(e) => setRawInput(e.target.value)}
            rows={12}
          />
          <p className="meta">{population.length} items</p>
        </section>

        <section className="panel controls">
          <label htmlFor="method">Method</label>
          <select
            id="method"
            value={method}
            onChange={(e) => setMethod(e.target.value as SampleMethod)}
          >
            <option value="random">Simple random</option>
            <option value="systematic">Systematic</option>
            <option value="stratified">Stratified (single group)</option>
          </select>

          <label htmlFor="size">Sample size</label>
          <input
            id="size"
            type="number"
            min={1}
            max={Math.max(1, population.length)}
            value={sampleSize}
            onChange={(e) => setSampleSize(Number(e.target.value))}
          />

          <button type="button" className="primary" onClick={runSample}>
            Draw sample
          </button>

          <div className="result">
            <h2>Sample</h2>
            {result.length === 0 ? (
              <p className="empty">No sample yet. Click Draw sample.</p>
            ) : (
              <ol>
                {result.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ol>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
