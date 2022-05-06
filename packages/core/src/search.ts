import { Dialogue, DialogueTest } from '.'
import { Context, Dict } from 'koishi'
import { getTotalWeight } from './receiver'
import { formatAnswers, formatPrefix } from './service'

declare module 'koishi' {
  interface EventMap {
    'dialogue/before-search'(argv: Dialogue.Session, test: DialogueTest): void | boolean
    'dialogue/search'(argv: Dialogue.Session, test: DialogueTest, dialogue: Dialogue[]): Promise<void>
  }
}

declare module '.' {
  interface Dialogue {
    _redirections: Dialogue[]
  }

  namespace Dialogue {
    interface Config {
      itemsPerPage?: number
      mergeThreshold?: number
      maxAnswerLength?: number
    }

    interface Options {
      questionMap?: Dict<Dialogue[]>
      autoMerge?: boolean
      recursive?: boolean
      page?: number
      pipe?: string
    }
  }
}

export default function apply(ctx: Context) {
  ctx.command('dialogue.stats').action(async ({ session }) => {
    const stats = await ctx.dialogue.stats()
    return session.text('.output', stats)
  })

  ctx.command('teach')
    .option('page', '/ <page:posint>')
    .option('autoMerge', '')
    .option('recursive', '-R', { value: false })
    .option('pipe', '| <op:text>')

  ctx.on('dialogue/appendix', ({ _redirections }, output, prefix, argv) => {
    if (!_redirections) return
    output.push(...formatAnswers(argv, _redirections, prefix + '= '))
  })

  ctx.on('dialogue/abstract', ({ flag }, output) => {
    if (flag & Dialogue.Flag.regexp) {
      output.questionType = 'regexp'
    }
  })

  ctx.before('dialogue/search', ({ argv }, test) => {
    test.noRecursive = argv.options.recursive === false
  })

  ctx.before('dialogue/search', ({ argv }, test) => {
    test.appellative = argv.options.appellative
  })

  ctx.on('dialogue/search', async (session, test, dialogues) => {
    const { options } = session.argv
    if (!options.questionMap) {
      options.questionMap = { [test.question]: dialogues }
    }
    for (const dialogue of dialogues) {
      const { answer } = dialogue
      // TODO extract dialogue command
      if (!answer.startsWith('%{dialogue ')) continue
      const { original, parsed } = ctx.dialogue.stripQuestion(answer.slice(11, -1).trimStart())
      if (parsed in options.questionMap) continue
      // TODO multiple tests in one query
      const dialogues = options.questionMap[parsed] = await ctx.dialogue.get({
        ...test,
        regexp: null,
        question: parsed,
        original: original,
      })
      Object.defineProperty(dialogue, '_redirections', { writable: true, value: dialogues })
      await ctx.parallel('dialogue/search', session, test, dialogues)
    }
  })

  ctx.on('dialogue/action', (session) => {
    const { options } = session.argv
    if (options.action !== 'search') return
    return showSearch(session)
  }, true)
}

async function showSearch(session: Dialogue.Session) {
  const app = session.app
  const { options, args: [question, answer] } = session.argv
  const { regexp, page = 1, original, pipe, recursive, autoMerge } = options
  const { itemsPerPage = 30, mergeThreshold = 5 } = app.dialogue.config

  const test: DialogueTest = { question, answer, regexp, original }
  if (app.bail('dialogue/before-search', session, test)) return ''
  const dialogues = await app.dialogue.get(test)

  if (pipe) {
    if (!dialogues.length) return session.text('.search.empty')
    const command = app.command('teach')
    const argv = { ...command.parse(pipe), session, command }
    const target = argv.options['target'] = dialogues.map(d => d.id).join(',')
    argv.source = `#${target} ${pipe}`
    return command.execute(argv)
  }

  if (recursive !== false && !autoMerge) {
    await app.parallel('dialogue/search', session, test, dialogues)
  }

  if (!original && !answer) {
    if (!dialogues.length) return sendEmpty('.search.empty-all')
    return sendResult('.search.result-all', app.dialogue.list(session, dialogues))
  }

  if (!options.regexp) {
    const hint = options.regexp !== false ? session.text('.search.regexp-hint') : ''
    if (!original) {
      if (!dialogues.length) return sendEmpty('.search.empty-answer', hint)
      const output = dialogues.map(d => `${formatPrefix(session, d)}${d.original}`)
      return sendResult('.search.result-answer', output)
    } else if (!answer) {
      if (!dialogues.length) return sendEmpty('.search.empty-question', hint)
      const output = formatAnswers(session, dialogues)
      const state = app.getSessionState(session)
      state.isSearch = true
      state.test = test
      state.dialogues = dialogues
      const total = await getTotalWeight(app, state)
      const epilog = dialogues.length > 1 ? session.text('.search.probability') + Math.min(total, 1).toFixed(3) : ''
      return sendResult('.search.result-question', output, epilog)
    } else {
      if (!dialogues.length) return sendEmpty('.search.empty-dialogue', hint)
      const output = [dialogues.map(d => d.id).join(', ')]
      return sendResult('.search.result-dialogue', output)
    }
  }

  let output: string[]
  if (!autoMerge || question && answer) {
    output = app.dialogue.list(session, dialogues)
  } else {
    const idMap: Dict<number[]> = {}
    for (const dialogue of dialogues) {
      const key = question ? dialogue.original : dialogue.answer
      if (!idMap[key]) idMap[key] = []
      idMap[key].push(dialogue.id)
    }
    const type = session.text('commands.teach.messages.entity.' + (question ? 'answer' : 'question'))
    output = Object.keys(idMap).map((key) => {
      const { length } = idMap[key]
      return length <= mergeThreshold
        ? `${key} (#${idMap[key].join(', #')})`
        : `${key} (${session.text('.search.count', [length])}${type})`
    })
  }

  if (!original) {
    if (!dialogues.length) return sendEmpty('.search.empty-regexp-answer')
    return sendResult('.search.result-regexp-answer', output)
  } else if (!answer) {
    if (!dialogues.length) return sendEmpty('.search.empty-regexp-question')
    return sendResult('.search.result-regexp-question', output)
  } else {
    if (!dialogues.length) return sendEmpty('.search.empty-regexp-dialogue')
    return sendResult('.search.result-regexp-dialogue', output)
  }

  function sendEmpty(path: string, hint?: string) {
    return session.text(path, [original, answer, hint])
  }

  function sendResult(path: string, output: string[], suffix?: string) {
    if (output.length <= itemsPerPage) {
      output.unshift(session.text(path, [original, answer]))
      if (suffix) output.push(suffix)
    } else {
      const pageCount = Math.ceil(output.length / itemsPerPage)
      output = output.slice((page - 1) * itemsPerPage, page * itemsPerPage)
      const hint = session.text('.search.page-hint', [page, pageCount])
      output.unshift(session.text(path, [original, answer, hint]))
      if (suffix) output.push(suffix)
      output.push(session.text('.search.page-footer'))
    }
    return output.join('\n')
  }
}
