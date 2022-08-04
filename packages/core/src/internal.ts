import { Context, defineProperty, Query, segment } from 'koishi'
import { Dialogue } from '.'
import { analyze, create } from './update'
import { distance } from 'fastest-levenshtein'

declare module 'koishi' {
  namespace Command {
    interface Config {
      noInterp?: boolean
    }
  }
}

declare module '.' {
  namespace Dialogue {
    interface Options {
      ignoreHint?: boolean
      regexp?: boolean
      redirect?: string
    }
  }
}

export default function apply(ctx: Context, config: Dialogue.Config) {
  ctx.command('teach')
    .option('ignoreHint', '-I')
    .option('regexp', '-x', { authority: config.authority.regExp })
    .option('regexp', '-X', { value: false })
    .option('redirect', '=> <answer:string>')

  ctx.before('dialogue/action', (session) => {
    function parseArgument() {
      if (!args.length) return ''
      const arg = args.shift()
      if (!arg || arg === '~' || arg === '～') return ''
      return arg.trim()
    }

    const { options, args } = session.argv
    const question = parseArgument()
    const answer = options.redirect ? `$(dialogue ${options.redirect})` : parseArgument()
    if (args.length) {
      return session.text('.too-many-arguments')
    } else if (/\[CQ:(?!face)/.test(question)) {
      return session.text('.prohibited-cq-code')
    }
    const { original, parsed, appellative } = options.regexp
      ? { original: segment.unescape(question), parsed: question, appellative: false }
      : ctx.dialogue.stripQuestion(question)
    defineProperty(options, 'appellative', appellative)
    defineProperty(options, 'original', original)
    args[0] = parsed
    args[1] = answer
    if (!args[0] && !args[1]) args.splice(0, Infinity)
  })

  function maybeAnswer(question: string, dialogues: Dialogue[]) {
    return dialogues.every(dialogue => {
      const dist = distance(question, dialogue.answer)
      return dist < dialogue.answer.length / 2
        && dist < distance(question, dialogue.question)
    })
  }

  function maybeRegExp(question: string) {
    return question.startsWith('^') || question.endsWith('$')
  }

  ctx.before('dialogue/modify', async (session) => {
    const { options, args } = session.argv
    const { ignoreHint, regexp, target, dialogues } = options
    const [question, answer] = args

    function applySuggestion(session: Dialogue.Session) {
      return session.withScope('commands.teach.messages', () => {
        return session.argv.options.target ? analyze(session) : create(session)
      })
    }

    // the user may want to modify the answer but modified the question
    if (target && !ignoreHint && question && !answer && maybeAnswer(question, dialogues)) {
      const dispose = session.middleware(({ content }, next) => {
        dispose()
        content = content.trim()
        if (content && content !== '.' && content !== '。') return next()
        args[1] = options.original
        args[0] = ''
        return applySuggestion(session)
      })
      return session.text('.probably-modify-answer')
    }

    // if the question is likely to be a regular expression
    // but the original dialogue is not in regexp mode
    // prompt the user to add -x option
    if (question && !regexp && maybeRegExp(question) && !ignoreHint && (!target || !dialogues.every(d => d.flag & Dialogue.Flag.regexp))) {
      const dispose = session.middleware(({ content }, next) => {
        dispose()
        content = content.trim()
        if (content && content !== '.' && content !== '。') return next()
        options.regexp = true
        return applySuggestion(session)
      })
      const operation = session.text('.operation', [target ? 'modify' : 'create'])
      return session.text('.probably-regexp', [operation])
    }

    // check the syntax of the input regular expression
    if (regexp || regexp !== false && question && dialogues.some(d => d.flag & Dialogue.Flag.regexp)) {
      const questions = question ? [question] : dialogues.map(d => d.question)
      try {
        questions.forEach(q => new RegExp(q))
      } catch (error) {
        return session.text('.illegal-regexp')
      }
    }
  })

  ctx.before('dialogue/modify', async (session) => {
    const { options, args } = session.argv
    // missing question or answer when creating a dialogue
    if (options.action === 'create' && !options.target && !(args[0] && args[1])) {
      return session.text('.missing-question-or-answer')
    }
  })

  ctx.on('dialogue/modify', (session, data) => {
    const { args, options } = session.argv

    if (args[1]) {
      data.answer = args[1]
    }

    if (options.regexp !== undefined) {
      data.flag = (data.flag & ~Dialogue.Flag.regexp) | (+options.regexp * Dialogue.Flag.regexp)
    }

    if (args[0]) {
      data.question = args[0]
      data.original = options.original
    }
  })

  ctx.on('dialogue/detail', async (dialogue, detail, session) => {
    if (dialogue._redirections?.length) {
      detail.add([
        session.text('.redirections'),
        ...ctx.dialogue.list(session, dialogue._redirections),
      ].join('\n'), -1000)
    }
  })

  ctx.before('command/execute', ({ command, session }) => {
    if (command.config.noInterp && session._redirected) {
      return session.text('.prohibited-command', [command.name])
    }
  })

  ctx.before('dialogue/modify', async (session) => {
    const { args } = session.argv
    if (!args[1] || !ctx.assets) return
    try {
      args[1] = await ctx.assets.transform(args[1])
    } catch (error) {
      ctx.logger('teach').warn(error.message)
      return session.text('.upload-failed')
    }
  })

  ctx.on('dialogue/query', ({ regexp, answer, question, original }, query) => {
    if (regexp) {
      if (answer) query.answer = { $regex: new RegExp(answer, 'i') }
      if (original) query.original = { $regex: new RegExp(original, 'i') }
      return
    }
    if (answer) query.answer = answer
    if (regexp === false) {
      if (question) query.question = question
    } else if (original) {
      const $or: Query.Expr<Dialogue>[] = [{
        flag: { $bitsAllSet: Dialogue.Flag.regexp },
        original: { $regexFor: original },
      }]
      if (question) $or.push({ flag: { $bitsAllClear: Dialogue.Flag.regexp }, question })
      query.$and.push({ $or })
    }
  })
}
