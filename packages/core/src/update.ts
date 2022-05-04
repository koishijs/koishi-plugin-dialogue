import { Awaitable, Context, deduplicate, difference, isInteger, pick, sleep, Time } from 'koishi'
import { prepareTargets, RE_DIALOGUES, split } from './utils'
import { Dialogue } from '.'
import { formatDialogue, formatQuestionAnswers } from './search'

declare module 'koishi' {
  interface EventMap {
    'dialogue/before-modify'(argv: Dialogue.Argv): Awaitable<void | string>
    'dialogue/modify'(argv: Dialogue.Argv, dialogue: Dialogue): void
    'dialogue/after-modify'(argv: Dialogue.Argv): void
    'dialogue/before-detail'(argv: Dialogue.Argv): Awaitable<void>
    'dialogue/detail'(dialogue: Dialogue, output: string[], argv: Dialogue.Argv): Awaitable<void>
  }
}

declare module '.' {
  namespace Dialogue {
    interface Config {
      previewDelay?: number
      maxPreviews?: number
    }
  }
}

export default function apply(ctx: Context) {
  ctx.command('teach')
    .option('review', '-v')
    .option('revert', '-V')
    .option('includeLast', '-l [count]', { type: isIntegerOrInterval })
    .option('excludeLast', '-L [count]', { type: isIntegerOrInterval })
    .option('target', '<ids>', { type: RE_DIALOGUES })
    .option('remove', '-r')

  ctx.on('dialogue/execute', (argv) => {
    const { remove, revert, target } = argv.options
    if (!target) return
    argv.target = deduplicate(split(target))
    delete argv.options.target
    try {
      return update(argv)
    } catch (err) {
      ctx.logger('teach').warn(err)
      const operation = argv.session.text(`.operation.${revert ? 'revert' : remove ? 'remove' : 'modify'}`)
      return argv.session.text('.unknown-error', [operation])
    }
  })

  ctx.on('dialogue/execute', (argv) => {
    const { options, session } = argv
    const { includeLast, excludeLast } = options
    if (!options.review && !options.revert) return
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
    return options.review ? review(dialogues, argv) : revert(dialogues, argv)
  }, true)

  ctx.before('dialogue/detail', async (argv) => {
    if (argv.options.modify) return
    await argv.app.parallel('dialogue/search', argv, {}, argv.dialogues)
  })

  ctx.on('dialogue/detail-short', ({ _type, _timestamp }, output, { session }) => {
    if (_type) {
      output.unshift(`${session.text(`.operation.${_type}`)}-${Time.format(Date.now() - _timestamp)}`)
    }
  })

  ctx.on('dialogue/detail', ({ original, answer, flag, _type, _timestamp }, output, { session }) => {
    const entity = session.text(`.entity.${flag & Dialogue.Flag.regexp ? 'regexp' : 'question'}`)
    output.push(session.text('.detail', [entity, original]))
    output.push(session.text('.detail', [session.text('.entity.answer'), answer]))
    if (_type) {
      output.push(session.text('.review', [
        session.text(`.operation.${_type}`),
        Date.now() - _timestamp,
      ]))
    }
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

function review(dialogues: Dialogue[], argv: Dialogue.Argv) {
  const output = dialogues.map((dialogue) => {
    return formatDialogue(argv, dialogue)
  })
  output.unshift(argv.session.text('.recent-history'))
  return output.join('\n')
}

async function revert(dialogues: Dialogue[], argv: Dialogue.Argv) {
  try {
    return await argv.app.dialogue.revert(dialogues, argv)
  } catch (err) {
    argv.app.logger('teach').warn(err)
    return argv.session.text('.unknown-error', [argv.session.text('.operation.revert')])
  }
}

export async function update(argv: Dialogue.Argv) {
  const { app, session, options, target, config, args } = argv
  const { maxPreviews = 10, previewDelay = 500 } = config
  const { revert, review, remove, search } = options

  options.modify = !review && !search && (Object.keys(options).length || args.length)
  if (!options.modify && !search && target.length > maxPreviews) {
    return session.text('.max-previews', [maxPreviews])
  }

  argv.uneditable = []
  argv.updated = []
  argv.skipped = []
  const dialogues = argv.dialogues = revert || review
    ? Object.values(pick(app.dialogue.history, target)).filter(Boolean)
    : await app.dialogue.get(target)
  argv.dialogueMap = Object.fromEntries(dialogues.map(d => [d.id, { ...d }]))

  if (search) {
    return formatQuestionAnswers(argv, dialogues).join('\n')
  }

  const actualIds = argv.dialogues.map(d => d.id)
  argv.unknown = difference(target, actualIds)
  await app.serial('dialogue/before-detail', argv)

  if (!options.modify) {
    if (argv.unknown.length) {
      await session.send(session.text(`.${review ? 'revert' : 'modify'}-unknown`, [argv.unknown.join(', ')]))
    }
    for (let index = 0; index < dialogues.length; index++) {
      const type = argv.session.text(`.entity.${review ? 'history' : 'detail'}`)
      const output = [argv.session.text('.detail-header', [dialogues[index].id, type])]
      await app.serial('dialogue/detail', dialogues[index], output, argv)
      if (index) await sleep(previewDelay)
      await session.send(output.join('\n'))
    }
    return ''
  }

  const targets = prepareTargets(argv)

  if (revert) {
    const message = targets.length ? await argv.app.dialogue.revert(targets, argv) : ''
    return sendResult(argv, message)
  }

  if (remove) {
    let message = ''
    if (targets.length) {
      const editable = await argv.app.dialogue.remove(targets, argv)
      message = argv.session.text('.remove-success', [editable.join(', ')])
    }
    await app.serial('dialogue/after-modify', argv)
    return sendResult(argv, message)
  }

  if (targets.length) {
    const result = await app.serial('dialogue/before-modify', argv)
    if (typeof result === 'string') return result
    for (const dialogue of targets) {
      app.emit('dialogue/modify', argv, dialogue)
    }
    await argv.app.dialogue.update(targets, argv)
    await app.serial('dialogue/after-modify', argv)
  }

  return sendResult(argv)
}

export async function create(argv: Dialogue.Argv) {
  const { app, options, args: [question, answer] } = argv
  options.create = options.modify = true

  argv.unknown = []
  argv.uneditable = []
  argv.updated = []
  argv.skipped = []
  argv.dialogues = await app.dialogue.get({ question, answer, regexp: false })
  await app.serial('dialogue/before-detail', argv)
  const result = await app.serial('dialogue/before-modify', argv)
  if (typeof result === 'string') return result

  if (argv.dialogues.length) {
    argv.target = argv.dialogues.map(d => d.id)
    argv.dialogueMap = Object.fromEntries(argv.dialogues.map(d => [d.id, d]))
    const targets = prepareTargets(argv)
    if (options.remove) {
      let message = ''
      if (targets.length) {
        const editable = await argv.app.dialogue.remove(targets, argv)
        message = argv.session.text('.remove-success', [editable.join(', ')])
      }
      await app.serial('dialogue/after-modify', argv)
      return sendResult(argv, message)
    }
    for (const dialogue of targets) {
      app.emit('dialogue/modify', argv, dialogue)
    }
    await argv.app.dialogue.update(targets, argv)
    await app.serial('dialogue/after-modify', argv)
    return sendResult(argv)
  }

  const dialogue = { flag: 0 } as Dialogue
  if (app.bail('dialogue/permit', argv, dialogue)) {
    return argv.session.text('.low-permission')
  }

  try {
    app.emit('dialogue/modify', argv, dialogue)
    const created = await app.database.create('dialogue', dialogue)
    argv.app.dialogue.addHistory(dialogue, 'create', argv, false)
    argv.dialogues = [created]

    await app.serial('dialogue/after-modify', argv)
    return sendResult(argv, argv.session.text('.create-success', [argv.dialogues[0].id]))
  } catch (err) {
    await argv.session.send(argv.session.text('.unknown-error', [argv.session.text('.operation.create')]))
    throw err
  }
}

export function sendResult(argv: Dialogue.Argv, prefix?: string, suffix?: string) {
  const { session, options, uneditable, unknown, skipped, updated, target, config } = argv
  const { remove, revert, create } = options
  const output = []
  if (prefix) output.push(prefix)
  if (updated.length) {
    if (create) {
      output.push(session.text('.create-modified', [updated.join(', ')]))
    } else {
      output.push(session.text('.modify-success', [updated.join(', ')]))
    }
  }
  if (skipped.length) {
    if (create) {
      output.push(session.text('.create-unchanged', [target.join(', '), config.prefix + skipped.join(',')]))
    } else {
      output.push(session.text('.unchanged', [skipped.join(', ')]))
    }
  }
  if (uneditable.length) {
    const operation = session.text('.operation.' + (revert ? 'revert' : remove ? 'remove' : 'modify'))
    output.push(session.text('.permission-denied', [uneditable.join(', '), operation]))
  }
  if (unknown.length) {
    output.push(session.text(`.${revert ? 'revert' : 'modify'}-unknown`, [unknown.join(', ')]))
  }
  if (suffix) output.push(suffix)
  return output.join('\n')
}
