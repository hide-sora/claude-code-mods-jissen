import { describe, expect, test, tier } from 'claude-code/testing'

tier('user')

describe('register', () => {
  test('denies a command the judge reads as destructive', async ($, on) => {
    const commands: string[] = []
    on('fs.read', () => ({ value: '' }))
    on('fs.write', () => ({ value: undefined }))
    on('model.classify', () => ({ value: 'destructive' }))
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      commands.push(String(e.command))
      return { result: { stdout: '', stderr: '', interrupted: false }, text: '' }
    })

    const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/build' })

    expect(r).toMatchObject({ deny: expect.any(String) })
    expect(commands).toEqual([])
  })

  test('runs a command the judge reads as safe', async ($, on) => {
    const commands: string[] = []
    on('fs.read', () => ({ value: '' }))
    on('fs.write', () => ({ value: undefined }))
    on('model.classify', () => ({ value: 'safe' }))
    on('tool.call', { tool: 'Bash' }, ($, e) => {
      commands.push(String(e.command))
      return { result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok' }
    })

    const r = await $.tool.call({ tool: 'Bash', command: 'rm -f /tmp/one.lock' })

    expect(r).toMatchObject({ text: 'ok' })
    expect(commands).toEqual(['rm -f /tmp/one.lock'])
  })

  test('never asks the judge about a command the trigger misses', async ($, on) => {
    const judged: string[] = []
    on('fs.read', () => ({ value: '' }))
    on('fs.write', () => ({ value: undefined }))
    on('model.classify', ($, e) => {
      judged.push(e.text)
      return { value: 'safe' }
    })
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: 'hello', stderr: '', interrupted: false },
      text: 'hello',
    }))

    const r = await $.tool.call({ tool: 'Bash', command: 'echo hello' })

    expect(r).toMatchObject({ text: 'hello' })
    expect(judged).toEqual([])
  })

  test('denies when the judge itself rejects', async ($, on) => {
    on('fs.read', () => ({ value: '' }))
    on('fs.write', () => ({ value: undefined }))
    on('model.classify', () => {
      throw new Error('no API key')
    })
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: '', stderr: '', interrupted: false },
      text: '',
    }))

    const r = await $.tool.call({ tool: 'Bash', command: 'rm -rf /tmp/build' })

    expect(r).toMatchObject({ deny: expect.stringContaining('could not answer') })
  })
})
