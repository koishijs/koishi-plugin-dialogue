import { Argv, Awaitable, Channel, Context, Next, noop, Random, segment, Session, User } from 'koishi'
import { Dialogue, DialogueTest } from '.'

declare module 'koishi' {
  interface Events {
    'dialogue/state'(state: SessionState): void
    'dialogue/receive'(state: SessionState): void | boolean
    'dialogue/prepare'(state: SessionState): void
    'dialogue/before-attach-user'(state: SessionState, userFields: Set<User.Field>): void
    'dialogue/attach-user'(state: SessionState): void | boolean
    'dialogue/before-send'(state: SessionState): Awaitable<void | boolean>
    'dialogue/send'(state: SessionState): void
  }

  interface Context {
    getSessionState(this: Context, session: Session): SessionState
  }

  interface Session {
    _redirected?: number
  }
}

declare module '.' {
  namespace Dialogue {
    interface Config {
      appellationTimeout?: number
      maxRedirections?: number
    }
  }
}

export interface SessionState {
  userId?: string
  channelId?: string
  answer?: string
  session?: Session<User.Field>
  test?: DialogueTest
  dialogue?: Dialogue
  dialogues?: Dialogue[]
  next?: Next
  isSearch?: boolean
}

export function escapeAnswer(message: string) {
  return message.replace(/\$/g, '@@__PLACEHOLDER__@@')
}

export function unescapeAnswer(message: string) {
  return message.replace(/@@__PLACEHOLDER__@@/g, '$')
}

Context.prototype.getSessionState = function (session) {
  const { channelId, userId, app } = session
  if (!app.dialogue.states[channelId]) {
    this.emit('dialogue/state', app.dialogue.states[channelId] = { channelId } as SessionState)
  }
  const state = Object.create(app.dialogue.states[channelId])
  state.session = session
  state.userId = userId
  return state
}

export async function getTotalWeight(ctx: Context, state: SessionState) {
  const { session, dialogues } = state
  ctx.emit(session, 'dialogue/prepare', state)
  const userFields = new Set<User.Field>(['name', 'flag'])
  ctx.emit(session, 'dialogue/before-attach-user', state, userFields)
  await session.observeUser(userFields)
  if (ctx.bail(session, 'dialogue/attach-user', state)) return 0
  return dialogues.reduce((prev, curr) => prev + curr._weight, 0)
}

export class MessageBuffer {
  private buffer = ''
  private original = false

  public hasData = false
  public send: Session['send']
  public sendQueued: Session['sendQueued']

  constructor(private session: Session) {
    this.send = session.send.bind(session)
    this.sendQueued = session.sendQueued.bind(session)

    session.send = async (message: string) => {
      if (!message) return
      this.hasData = true
      if (this.original) {
        return this.send(message)
      }
      this.buffer += message
    }

    session.sendQueued = async (message, delay) => {
      if (!message) return
      this.hasData = true
      if (this.original) {
        return this.sendQueued(message, delay)
      }
      return this._flush(this.buffer + message, delay)
    }
  }

  write(message: string) {
    if (!message) return
    this.hasData = true
    this.buffer += message
  }

  private async _flush(message: string, delay?: number) {
    this.original = true
    message = message.trim()
    const result = await this.sendQueued(message, delay)
    this.buffer = ''
    this.original = false
    return result
  }

  flush() {
    return this._flush(this.buffer)
  }

  async execute(argv: Argv) {
    this.original = false
    const send = this.session.send
    const sendQueued = this.session.sendQueued
    await this.session.execute(argv)
    this.session.sendQueued = sendQueued
    this.session.send = send
    this.original = true
  }

  async end(message = '') {
    this.write(message)
    await this.flush()
    this.original = true
    delete this.session.send
    delete this.session.sendQueued
  }
}

const tokenizer = new Argv.Tokenizer()

tokenizer.interpolate('$n', '', (rest) => {
  return { rest, tokens: [], source: '' }
})

export async function triggerDialogue(ctx: Context, session: Session, next: Next = noop) {
  if (!session.content) return

  const state = ctx.getSessionState(session)
  state.next = next
  state.test = {}

  if (ctx.bail('dialogue/receive', state)) return next()
  const logger = ctx.logger('dialogue')
  logger.debug('[receive]', session.content)

  // fetch matched dialogues
  const dialogues = state.dialogues = await ctx.root.dialogue.get(state.test)

  // pick dialogue
  let dialogue: Dialogue
  const total = await getTotalWeight(ctx, state)
  if (!total) return next()
  const target = Random.real(Math.max(1, total))
  let pointer = 0
  for (const _dialogue of dialogues) {
    pointer += _dialogue._weight
    if (target < pointer) {
      dialogue = _dialogue
      break
    }
  }
  if (!dialogue) return next()
  logger.debug('[attach]', session.messageId)

  // parse answer
  state.dialogue = dialogue
  state.dialogues = [dialogue]
  state.answer = dialogue.answer
    .replace(/\$\$/g, '@@__PLACEHOLDER__@@')
    .replace(/\$A/g, segment('at', { type: 'all' }).toString())
    .replace(/\$a/g, segment('at', { id: session.userId }).toString())
    .replace(/\$m/g, segment('at', { id: session.selfId }).toString())
    .replace(/\$s/g, () => escapeAnswer(session.username))
    .replace(/\$0/g, escapeAnswer(session.content))

  if (dialogue.flag & Dialogue.Flag.regexp) {
    const capture = dialogue._capture || new RegExp(dialogue.original, 'i').exec(state.test.original)
    // emojis will be transformed into "?" in mysql
    // which will lead to incorrect matches
    // TODO enhance emojis in regexp tests
    if (!capture) return
    capture.forEach((segment, index) => {
      if (index && index <= 9) {
        state.answer = state.answer.replace(new RegExp(`\\$${index}`, 'g'), escapeAnswer(segment || ''))
      }
    })
  }

  if (await ctx.serial(session, 'dialogue/before-send', state)) return
  logger.debug('[send]', session.messageId, '->', dialogue.answer)

  // send answers
  const buffer = new MessageBuffer(session)
  session._redirected = (session._redirected || 0) + 1

  // parse answer
  let index: number
  const { content, inters } = tokenizer.parseToken(unescapeAnswer(state.answer))
  while (inters.length) {
    const argv = inters.shift()
    buffer.write(content.slice(index, argv.pos))
    if (argv.initiator === '$n') {
      await buffer.flush()
    } else {
      await buffer.execute(argv)
    }
    index = argv.pos
  }
  await buffer.end(content.slice(index))
  await ctx.parallel(session, 'dialogue/send', state)
}

export default function receiver(ctx: Context, config: Dialogue.Config) {
  const { maxRedirections = 3 } = config
  const ctx2 = ctx.guild()

  ctx.before('attach', (session) => {
    if (session.stripped.appel) return
    const { activated } = ctx.getSessionState(session)
    if (activated[session.userId]) session.stripped.appel = true
  })

  ctx2.middleware(async (session, next) => {
    return await triggerDialogue(ctx, session, next)
  })

  // @ts-ignore
  ctx.on('notice/poke', async (session) => {
    if (session.targetId !== session.selfId) return
    const { flag } = await session.observeChannel(['flag'])
    if (flag & Channel.Flag.ignore) return
    session.content = 'hook:poke'
    await triggerDialogue(ctx, session)
  })

  async function triggerNotice(name: string, session: Session) {
    const { flag, assignee } = await session.observeChannel(['flag', 'assignee'])
    if (assignee !== session.selfId) return
    if (flag & Channel.Flag.ignore) return
    session.content = 'hook:' + name + (session.userId === session.selfId ? ':self' : ':others')
    await triggerDialogue(ctx, session)
  }

  // @ts-ignore
  ctx.on('notice/honor', async (session) => {
    await triggerNotice(session.subsubtype, session)
  })

  ctx.on('guild-member-added', triggerNotice.bind(null, 'join'))

  ctx.on('guild-member-removed', triggerNotice.bind(null, 'leave'))

  ctx.on('dialogue/receive', ({ session }) => {
    // generally flag and authority has already attached to users
    if (session.user?.authority < config.authority.receive) return true
  })

  ctx.on('dialogue/receive', ({ session, test }) => {
    if (session.content.includes('<image ')) return true
    const { appel, content } = session.stripped
    const { original, parsed, appellative, activated } = ctx.root.dialogue.stripQuestion(content)
    test.question = parsed
    test.original = original
    test.activated = activated
    test.appellative = appellative || appel
  })

  // predict the user fields involved
  ctx.before('dialogue/attach-user', ({ dialogues, session }, userFields) => {
    for (const data of dialogues) {
      const { inters } = tokenizer.parseToken(data.answer)
      for (const argv of inters) {
        session.collect('user', argv, userFields)
      }
    }
  })

  ctx2.command('dialogue <message:text>')
    .action(async ({ session }, message = '') => {
      if (session._redirected > maxRedirections) return
      session.content = message
      return await triggerDialogue(ctx, session)
    })
}
