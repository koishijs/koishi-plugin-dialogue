import { Context, isInteger, Time } from 'koishi'
import { handleError } from './update'

declare module '.' {
  namespace Dialogue {
    interface Options {
      includeLast?: any
      excludeLast?: any
    }
  }
}

export default function apply(ctx: Context) {
  ctx.command('teach')
    .option('action', '-v', { value: 'review' })
    .option('action', '-V', { value: 'revert' })
    .option('includeLast', '-l [count]', { type: isIntegerOrInterval })
    .option('excludeLast', '-L [count]', { type: isIntegerOrInterval })

  ctx.on('dialogue/action', (session) => {
    const { options } = session.argv
    const { includeLast, excludeLast, action, target } = options
    if (action !== 'review' && action !== 'revert' || target) return
    const now = Date.now(), includeTime = Time.parseTime(includeLast), excludeTime = Time.parseTime(excludeLast)
    const dialogues = Object.values(ctx.dialogue.history).filter((dialogue) => {
      if (dialogue._operator !== session.userId) return
      const offset = now - dialogue._timestamp
      if (includeTime && offset >= includeTime) return
      if (excludeTime && offset < excludeTime) return
      return true
    }).sort((d1, d2) => d2._timestamp - d1._timestamp).filter((_, index, temp) => {
      if (!includeTime && includeLast && index >= +includeLast) return
      if (!excludeTime && excludeLast && index < temp.length - +excludeLast) return
      return true
    })

    if (!dialogues.length) return session.text('.no-history')
    if (action === 'review') {
      const output = dialogues.map((dialogue) => {
        return session.app.dialogue.formatDialogue(session, dialogue)
      })
      output.unshift(session.text('.recent-history'))
      return output.join('\n')
    }
    return handleError(session, () => {
      return session.app.dialogue.revert(dialogues, session)
    })
  }, true)

  ctx.on('dialogue/abstract', ({ _type, _timestamp }, output, session) => {
    if (!_type) return
    output.unshift(`${session.text(`.operation.${_type}`)}-${Time.format(Date.now() - _timestamp)}`)
  })

  ctx.on('dialogue/detail', ({ _type, _timestamp }, detail, session) => {
    if (!_type) return
    detail.add(session.text('.review', [
      session.text(`.operation.${_type}`),
      Date.now() - _timestamp,
    ]), -100)
  })
}

function isIntegerOrInterval(source: string) {
  const n = +source
  if (n * 0 === 0) {
    if (isInteger(n) && n > 0) return n
    throw new Error()
  } else {
    if (Time.parseTime(source)) return source
    throw new Error()
  }
}
