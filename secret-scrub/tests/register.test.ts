import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

const KEY = 'sk-test1234567890abcdefghij'
const LINE = `openai_key=${KEY}`

const readResult = (content: string) => ({
  result: {
    type: 'text' as const,
    file: { filePath: '/secrets.txt', content, numLines: 1, startLine: 1, totalLines: 1 },
  },
  text: content,
})

describe('register', () => {
  test('masks a key in both the record and the model-facing text', async ($, on) => {
    const written: string[] = []
    on('fs.read', () => ({ value: '' }))
    on('fs.write', ($, e) => {
      written.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Read' }, () => readResult(LINE))

    const r = await $.tool.call({ tool: 'Read', file_path: '/secrets.txt' })

    expect(JSON.stringify(r)).not.toContain(KEY)
    expect(JSON.stringify(r)).toContain('[REDACTED:openai]')
    expect(written.join('')).toContain('tool=Read')
  })

  test('leaves a clean Bash result alone and logs nothing', async ($, on) => {
    const written: string[] = []
    on('fs.read', () => ({ value: '' }))
    on('fs.write', ($, e) => {
      written.push(e.text)
      return { value: undefined }
    })
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: 'hello', stderr: '', interrupted: false },
      text: 'hello',
    }))

    const r = await $.tool.call({ tool: 'Bash', command: 'echo hello' })

    expect(r).toMatchObject({ text: 'hello' })
    expect(written).toEqual([])
  })
})
