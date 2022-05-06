import { Awaitable, Context, difference, observe, pick, sleep } from 'koishi'
import { Dialogue } from '.'

declare module 'koishi' {
  interface EventMap {
    'dialogue/before-modify'(session: Dialogue.Session): Awaitable<void | string>
    'dialogue/modify'(session: Dialogue.Session, dialogue: Dialogue): void
    'dialogue/after-modify'(session: Dialogue.Session): void
    'dialogue/before-detail'(session: Dialogue.Session): Awaitable<void>
  }
}

declare module '.' {
  namespace Dialogue {
    interface Config {
      previewDelay?: number
      maxPreviews?: number
    }

    interface Options {
      target?: number[]
    }
  }
}

export default function apply(ctx: Context) {
  ctx.command('teach')
    .option('action', '-r', { value: 'remove' })

  ctx.on('dialogue/action', (session) => {
    const { options } = session.argv
    if (!options.target) return
    return analyze(session)
  }, true)

  ctx.on('dialogue/action', (session) => {
    return create(session)
  })

  ctx.before('dialogue/detail', async (session) => {
    const { action, dialogues } = session.argv.options
    if (action === 'modify') return
    await ctx.parallel('dialogue/search', session, {}, dialogues)
  })

  ctx.on('dialogue/detail', ({ original, answer, flag }, output, session) => {
    const entity = session.text(`.entity.${flag & Dialogue.Flag.regexp ? 'regexp' : 'question'}`)
    output.push(session.text('.detail', [entity, original]))
    output.push(session.text('.detail', [session.text('.entity.answer'), answer]))
  })
}

export async function handleError(session: Dialogue.Session, callback: (session: Dialogue.Session) => Promise<string>) {
  try {
    return await callback(session)
  } catch (err) {
    const { action } = session.argv.options
    session.app.logger('dialogue').warn(err)
    return session.text('.unknown-error', [session.text(`.operation.${action}`)])
  }
}

export function prepareTargets(session: Dialogue.Session, dialogues?: Dialogue[]) {
  const { options } = session.argv
  dialogues ||= options.dialogues
  const targets = dialogues.filter((dialogue) => {
    return !session.app.bail('dialogue/permit', session, dialogue)
  })
  options.forbidden.unshift(...difference(dialogues, targets).map(d => d.id))
  return targets.map(dialogue => observe(dialogue))
}

function prepareModifyOptions(session: Dialogue.Session) {
  const { options } = session.argv
  options.forbidden = []
  options.updated = []
  options.skipped = []
}

export async function analyze(session: Dialogue.Session) {
  const app = session.app
  const { options, args } = session.argv
  const { maxPreviews = 10, previewDelay = 500 } = app.dialogue.config
  const { target, action } = options

  if (!options.action && (Object.keys(options).length > 1 || args.length)) {
    options.action = 'modify'
  } else if (!options.action && target.length > maxPreviews) {
    return session.text('.max-previews', [maxPreviews])
  }

  prepareModifyOptions(session)
  const dialogues = options.dialogues = action === 'review' || action === 'revert'
    ? Object.values(pick(app.dialogue.history, target)).filter(Boolean)
    : await app.dialogue.get(target)
  options.dialogueMap = Object.fromEntries(dialogues.map(d => [d.id, { ...d }]))

  const actualIds = options.dialogues.map(d => d.id)
  options.unknown = difference(target, actualIds)
  await app.serial('dialogue/before-detail', session)

  if (!options.action) {
    if (options.unknown.length) {
      await session.send(session.text(`.${options.action === 'review' ? 'revert' : 'modify'}-unknown`, [options.unknown.join(', ')]))
    }
    for (let index = 0; index < dialogues.length; index++) {
      const type = session.text(`.entity.${options.action === 'review' ? 'history' : 'detail'}`)
      const output = [session.text('.detail-header', [dialogues[index].id, type])]
      await app.serial('dialogue/detail', dialogues[index], output, session)
      if (index) await sleep(previewDelay)
      await session.send(output.join('\n'))
    }
    return ''
  }

  return handleError(session, async () => {
    const targets = prepareTargets(session)

    if (action === 'revert') {
      const message = targets.length ? await app.dialogue.revert(targets, session) : ''
      return sendResult(session, message)
    }

    if (action === 'remove') {
      let message = ''
      if (targets.length) {
        const editable = await app.dialogue.remove(targets, session)
        message = session.text('.remove-success', [editable.join(', ')])
      }
      await app.serial('dialogue/after-modify', session)
      return sendResult(session, message)
    }

    if (targets.length) {
      const result = await app.serial('dialogue/before-modify', session)
      if (typeof result === 'string') return result
      for (const dialogue of targets) {
        app.emit('dialogue/modify', session, dialogue)
      }
      await app.dialogue.update(targets, session)
      await app.serial('dialogue/after-modify', session)
    }

    return sendResult(session)
  })
}

export async function create(session: Dialogue.Session) {
  const { options, args: [question, answer] } = session.argv
  const app = session.app
  options.action = 'create'
  options.unknown = []
  prepareModifyOptions(session)
  options.dialogues = await app.dialogue.get({ question, answer, regexp: false })
  await app.serial('dialogue/before-detail', session)
  const result = await app.serial('dialogue/before-modify', session)
  if (typeof result === 'string') return result

  if (options.dialogues.length) {
    options.target = options.dialogues.map(d => d.id)
    options.dialogueMap = Object.fromEntries(options.dialogues.map(d => [d.id, d]))
    const targets = prepareTargets(session)
    for (const dialogue of targets) {
      app.emit('dialogue/modify', session, dialogue)
    }
    await app.dialogue.update(targets, session)
    await app.serial('dialogue/after-modify', session)
    return sendResult(session)
  }

  const dialogue = { flag: 0 } as Dialogue
  if (app.bail('dialogue/permit', session, dialogue)) {
    return session.text('.low-permission')
  }

  return handleError(session, async () => {
    app.emit('dialogue/modify', session, dialogue)
    const created = await app.database.create('dialogue', dialogue)
    app.dialogue.addHistory(dialogue, 'create', session, false)
    options.dialogues = [created]

    await app.serial('dialogue/after-modify', session)
    return sendResult(session, session.text('.create-success', [options.dialogues[0].id]))
  })
}

export function sendResult(session: Dialogue.Session, prolog?: string, epilog?: string) {
  const { prefix } = session.app.dialogue.config
  const { action, forbidden, unknown, skipped, updated, target } = session.argv.options
  const output = []
  if (prolog) output.push(prolog)
  if (updated.length) {
    if (action === 'create') {
      output.push(session.text('.create-modified', [updated.join(', ')]))
    } else {
      output.push(session.text('.modify-success', [updated.join(', ')]))
    }
  }
  if (skipped.length) {
    if (action === 'create') {
      output.push(session.text('.create-unchanged', [target.join(', '), prefix + skipped.join(',')]))
    } else {
      output.push(session.text('.unchanged', [skipped.join(', ')]))
    }
  }
  if (forbidden.length) {
    const operation = session.text('.operation.' + action)
    output.push(session.text('.permission-denied', [forbidden.join(', '), operation]))
  }
  if (unknown.length) {
    output.push(session.text(`.${action === 'revert' ? 'revert' : 'modify'}-unknown`, [unknown.join(', ')]))
  }
  if (epilog) output.push(epilog)
  return output.join('\n')
}
