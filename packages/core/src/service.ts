import { $, Awaitable, clone, Context, defineProperty, Observed, Query, segment, Service } from 'koishi'
// import { Dialogue, DialogueTest, equal } from './utils'
import { Dialogue, DialogueTest } from '.'
import { simplify } from 'simplify-chinese'

declare module 'koishi' {
  namespace Context {
    interface Services {
      dialogue: DialogueService
    }
  }

  interface EventMap {
    'dialogue/abstract'(dialogue: Dialogue, output: Abstract, session: Dialogue.Session): void
    'dialogue/appendix'(dialogue: Dialogue, output: string[], prefix: string, argv: Dialogue.Session): void
    'dialogue/detail'(dialogue: Dialogue, output: string[], session: Dialogue.Session): Awaitable<void>
  }
}

const halfWidth = ',,.~?!()[]'
const fullWidth = '，、。～？！（）【】'
const fullWidthRegExp = new RegExp(`[${fullWidth}]`)

interface Question {
  /** 被 unescape 处理后原本的句子 */
  original: string
  /** 去除句首句尾标点符号，句中空格和句首称呼的句子 */
  parsed: string
  /** 是否含有称呼 */
  appellative: boolean
  /** 是否仅含有称呼 */
  activated: boolean
}

export default class DialogueService extends Service {
  history: Record<number, Dialogue> = {}

  constructor(ctx: Context, public config: Dialogue.Config) {
    super(ctx, 'dialogue', true)

    ctx.model.extend('dialogue', {
      id: 'unsigned',
      flag: 'unsigned(4)',
      probS: { type: 'decimal', precision: 4, scale: 3, initial: 1 },
      probA: { type: 'decimal', precision: 4, scale: 3, initial: 0 },
      original: 'string(255)',
      question: 'string(255)',
      answer: 'text',
    }, {
      autoInc: true,
    })
  }

  flag(flag: keyof typeof Dialogue.Flag) {
    this.ctx.before('dialogue/search', (session, test) => {
      test[flag] = session.argv.options[flag]
    })

    this.ctx.on('dialogue/modify', (session, data) => {
      const { options } = session.argv
      if (options[flag] !== undefined) {
        data.flag &= ~Dialogue.Flag[flag]
        data.flag |= +options[flag] * Dialogue.Flag[flag]
      }
    })

    this.ctx.on('dialogue/query', (test, query) => {
      if (test[flag] === undefined) return
      query.$and.push({
        flag: { [test[flag] ? '$bitsAllSet' : '$bitsAllClear']: Dialogue.Flag[flag] },
      })
    })
  }

  async stats(): Promise<Dialogue.Stats> {
    const selection = this.ctx.database.select('dialogue')
    const [dialogues, questions] = await Promise.all([
      selection.evaluate(row => $.count(row.id)).execute(),
      selection.evaluate(row => $.count(row.question)).execute(),
    ])
    return { dialogues, questions }
  }

  get(test: DialogueTest): Promise<Dialogue[]>
  get<K extends Dialogue.Field>(ids: number[], fields?: K[]): Promise<Pick<Dialogue, K>[]>
  async get(test: DialogueTest | number[], fields?: Dialogue.Field[]) {
    if (Array.isArray(test)) {
      const dialogues = await this.ctx.database.get('dialogue', test, fields)
      dialogues.forEach(d => defineProperty(d, '_backup', clone(d)))
      return dialogues
    } else {
      const query: Query.Expr<Dialogue> = { $and: [] }
      this.ctx.emit('dialogue/query', test, query)
      const dialogues = await this.ctx.database.get('dialogue', query)
      dialogues.forEach(d => defineProperty(d, '_backup', clone(d)))
      return dialogues/* .filter((data) => {
        if (!test.guilds || test.partial) return true
        return !(data.flag & Dialogue.Flag.complement) === test.reversed || !equal(test.guilds, data.guilds)
      }) */
    }
  }

  async update(dialogues: Observed<Dialogue>[], session: Dialogue.Session) {
    const data: Partial<Dialogue>[] = []
    const { options } = session.argv
    for (const dialogue of dialogues) {
      if (!Object.keys(dialogue.$diff).length) {
        options.skipped.push(dialogue.id)
      } else {
        options.updated.push(dialogue.id)
        data.push({ ...dialogue.$diff, id: dialogue.id })
        dialogue.$diff = {}
        this.addHistory(dialogue._backup, 'modify', session, false)
      }
    }
    await this.ctx.database.upsert('dialogue', data)
  }

  async remove(dialogues: Dialogue[], session: Dialogue.Session, revert = false) {
    const ids = dialogues.map(d => d.id)
    for (const id of ids) {
      this.addHistory(session.argv.options.dialogueMap[id], 'remove', session, revert)
    }
    await this.ctx.database.remove('dialogue', ids)
    return ids
  }

  async revert(dialogues: Dialogue[], session: Dialogue.Session) {
    const created = dialogues.filter(d => d._type === 'create')
    const edited = dialogues.filter(d => d._type !== 'create')
    await this.remove(created, session, true)
    await this.recover(edited, session)
    return session.text('.revert-success', [dialogues.map(d => d.id).sort((a, b) => a - b).join(', ')])
  }

  async recover(dialogues: Dialogue[], session: Dialogue.Session) {
    await this.ctx.database.upsert('dialogue', dialogues)
    for (const dialogue of dialogues) {
      this.addHistory(dialogue, 'modify', session, true)
    }
  }

  addHistory(dialogue: Dialogue, type: Dialogue.ModifyType, session: Dialogue.Session, revert: boolean) {
    if (revert) return delete this.history[dialogue.id]
    this.history[dialogue.id] = dialogue
    const time = Date.now()
    defineProperty(dialogue, '_timestamp', time)
    defineProperty(dialogue, '_operator', session.userId)
    defineProperty(dialogue, '_type', type)
    this.ctx.setTimeout(() => {
      if (this.history[dialogue.id]?._timestamp === time) {
        delete this.history[dialogue.id]
      }
    }, this.config.historyTimeout)
  }

  stripQuestion(source: string): Question {
    const original = segment.unescape(source)
    source = segment.transform(source, {
      text: ({ content }, index, chain) => {
        let message = simplify(segment.unescape('' + content))
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(fullWidthRegExp, $0 => halfWidth[fullWidth.indexOf($0)])
        if (index === 0) message = message.replace(/^[()\[\]]*/, '')
        if (index === chain.length - 1) message = message.replace(/[\.,?!()\[\]~]*$/, '')
        return message
      },
    })
    const capture = this.ctx.app._nameRE.exec(source)
    const unprefixed = capture ? source.slice(capture[0].length) : source
    return {
      original,
      parsed: unprefixed || source,
      appellative: unprefixed && unprefixed !== source,
      activated: !unprefixed && unprefixed !== source,
    }
  }

  formatDialogue(session: Dialogue.Session, dialogue: Dialogue) {
    const abstract = getAbstract(session, dialogue)
    const { original, answer } = dialogue
    const questionType = session.text(`commands.teach.messages.entity.${abstract.questionType || 'question'}`)
    const answerType = session.text(`commands.teach.messages.entity.${abstract.answerType || 'answer'}`)
    return [
      session.text('commands.teach.messages.detail', [formatAbstract(dialogue, abstract) + questionType, original]),
      session.text('commands.teach.messages.detail', [answerType, formatAnswer(answer, this.config)]),
    ].join(session.text('general.comma'))
  }

  list(session: Dialogue.Session, dialogues: Dialogue[], prefix = '') {
    return dialogues.map((dialogue) => {
      const output = [prefix + this.formatDialogue(session, dialogue)]
      this.ctx.emit('dialogue/appendix', dialogue, output, prefix, session)
      return output.join('\n')
    })
  }
}

export function formatAnswer(source: string, { maxAnswerLength = 100 }: Dialogue.Config) {
  let trimmed = false
  const lines = source.split(/(\r?\n|\$n)/g)
  if (lines.length > 1) {
    trimmed = true
    source = lines[0].trim()
  }
  source = source.replace(/\[CQ:image,[^\]]+\]/g, '[图片]')
  if (source.length > maxAnswerLength) {
    trimmed = true
    source = source.slice(0, maxAnswerLength)
  }
  if (trimmed && !source.endsWith('……')) {
    if (source.endsWith('…')) {
      source += '…'
    } else {
      source += '……'
    }
  }
  return source
}

export interface Abstract extends Array<string> {
  questionType?: string
  answerType?: string
}

export function getAbstract(session: Dialogue.Session, dialogue: Dialogue) {
  const abstract: Abstract = []
  session.app.emit('dialogue/abstract', dialogue, abstract, session)
  return abstract
}

export function formatAbstract(dialogue: Dialogue, abstract: Abstract) {
  return `${dialogue.id}. ${abstract.length ? `[${abstract.join(', ')}] ` : ''}`
}

export function formatPrefix(session: Dialogue.Session, dialogue: Dialogue, showAnswerType = false) {
  const details = getAbstract(session, dialogue)
  let result = formatAbstract(dialogue, details)
  if (details.questionType) {
    result += `[${session.text('commands.teach.messages.entity.' + details.questionType)}] `
  }
  if (showAnswerType && details.answerType) {
    result += `[${session.text('commands.teach.messages.entity.' + details.answerType)}] `
  }
  return result
}

export function formatAnswers(session: Dialogue.Session, dialogues: Dialogue[], prefix = '') {
  const app = session.app
  return dialogues.map((dialogue) => {
    const { answer } = dialogue
    const output = [`${prefix}${formatPrefix(session, dialogue, true)}${formatAnswer(answer, app.dialogue.config)}`]
    app.emit('dialogue/appendix', dialogue, output, prefix, session)
    return output.join('\n')
  })
}
