import { contain, Context, Dict, difference, Query, union } from 'koishi'
import { Dialogue, equal, prepareTargets, RE_DIALOGUES, split } from '../utils'
import { formatQuestionAnswers } from '../search'

declare module '../receiver' {
  interface SessionState {
    predecessors?: Record<number, Record<number, number>>
  }
}

declare module '../utils' {
  interface DialogueTest {
    stateful?: boolean
    context?: boolean
    predecessors?: (string | number)[]
  }

  interface Dialogue {
    predecessors: string[]
    successorTimeout: number
    _predecessors: Dialogue[]
    _successors: Dialogue[]
  }

  namespace Dialogue {
    interface Config {
      successorTimeout?: number
    }

    interface Argv {
      predecessors?: number[]
      successors?: number[]
      predOverwrite?: boolean
      succOverwrite?: boolean
    }
  }
}

export default function apply(ctx: Context, config: Dialogue.Config) {
  const { successorTimeout = 20000 } = config
  if (!successorTimeout) return

  ctx.command('teach')
    .option('setPred', '< <ids:string>', { type: RE_DIALOGUES })
    .option('addPred', '<< <ids:string>', { type: RE_DIALOGUES })
    .option('setSucc', '> <ids:string>', { type: RE_DIALOGUES })
    .option('addSucc', '>> <ids:string>', { type: RE_DIALOGUES })
    .option('createSuccessor', '># <op:text>')
    .option('successorTimeout', '-z [time:posint]')
    .option('context', '-c')
    .option('context', '-C', { value: false })

  ctx.emit('dialogue/flag', 'context')

  ctx.on('dialogue/validate', (argv) => {
    const { options, session } = argv

    if ('setPred' in options) {
      if ('addPred' in options) {
        return session.text('.options-conflict', ['--set-pred, --add-pred'])
      } else {
        argv.predecessors = split(options.setPred)
        argv.predOverwrite = true
      }
    } else if ('addPred' in options) {
      argv.predecessors = split(options.addPred)
      argv.predOverwrite = false
    }

    if ('setSucc' in options) {
      if ('addSucc' in options) {
        return session.text('.options-conflict', ['--set-succ, --add-succ'])
      } else {
        argv.successors = split(options.setSucc)
        argv.succOverwrite = true
      }
    } else if ('addSucc' in options) {
      argv.successors = split(options.addSucc)
      argv.succOverwrite = false
    }

    if (options.remove) {
      argv.successors = []
      argv.succOverwrite = true
    }
  })

  ctx.on('dialogue/modify', ({ predOverwrite, predecessors }, data) => {
    // merge predecessors
    if (!data.predecessors) data.predecessors = []
    if (!predecessors) return
    if (predOverwrite) {
      if (!equal(data.predecessors, predecessors)) data.predecessors = predecessors.map(String)
    } else {
      if (!contain(data.predecessors, predecessors)) data.predecessors = union(data.predecessors, predecessors.map(String))
    }
  })

  ctx.on('dialogue/modify', ({ options }, data) => {
    // set successor timeout
    if (options.successorTimeout) {
      data.successorTimeout = options.successorTimeout * 1000
    }
  })

  ctx.on('dialogue/after-modify', async (argv) => {
    // modify successors
    const { succOverwrite, successors, dialogues } = argv
    if (!successors) return
    const predecessors = dialogues.map(dialogue => '' + dialogue.id)
    const successorDialogues = await ctx.teach.get(successors)
    const newTargets = successorDialogues.map(d => d.id)
    argv.unknown = difference(successors, newTargets)

    if (succOverwrite) {
      for (const dialogue of await ctx.teach.get({ predecessors })) {
        if (!newTargets.includes(dialogue.id)) {
          newTargets.push(dialogue.id)
          successorDialogues.push(dialogue)
        }
      }
    }

    const targets = prepareTargets(argv, successorDialogues)

    for (const data of targets) {
      if (!successors.includes(data.id)) {
        data.predecessors = difference(data.predecessors, predecessors)
      } else if (!contain(data.predecessors, predecessors)) {
        data.predecessors = union(data.predecessors, predecessors)
      }
    }

    await ctx.teach.update(targets, argv)
  })

  ctx.on('dialogue/after-modify', async ({ options: { createSuccessor }, dialogues, session }) => {
    // create a new dialogue with > # and set the current dialogue as its predecessor
    if (!createSuccessor) return
    if (!dialogues.length) return session.send(session.text('.flowgraph.not-found'))
    const command = ctx.command('teach')
    const argv = { ...command.parse(createSuccessor), session, command }
    const target = argv.options['setPred'] = dialogues.map(d => d.id).join(',')
    argv.source = `# ${createSuccessor} < ${target}`
    await command.execute(session.argv)
  })

  // get predecessors
  ctx.before('dialogue/detail', async ({ options, dialogues }) => {
    if (options.modify) return
    const predecessors = new Set<number>()
    for (const dialogue of dialogues) {
      for (const id of dialogue.predecessors) {
        predecessors.add(+id)
      }
    }
    const dialogueMap: Dict<Dialogue> = {}
    for (const dialogue of await ctx.teach.get([...predecessors])) {
      dialogueMap[dialogue.id] = dialogue
    }
    for (const dialogue of dialogues) {
      const predecessors = dialogue.predecessors.map(id => dialogueMap[id])
      Object.defineProperty(dialogue, '_predecessors', { writable: true, value: predecessors })
    }
  })

  ctx.on('dialogue/detail', async (dialogue, output, argv) => {
    if (dialogue.flag & Dialogue.Flag.context) {
      output.push(argv.session.text('.flowgraph.detail.context-mode'))
    }
    if ((dialogue.successorTimeout || successorTimeout) !== successorTimeout) {
      output.push(argv.session.text('.flowgraph.detail.timeout', dialogue))
    }
    if (dialogue._predecessors.length) {
      output.push(argv.session.text('.flowgraph.detail.predecessors'), ...formatQuestionAnswers(argv, dialogue._predecessors))
    }
    if (dialogue._successors.length) {
      output.push(argv.session.text('.flowgraph.detail.successors'), ...formatQuestionAnswers(argv, dialogue._successors))
    }
  })

  ctx.on('dialogue/detail-short', (dialogue, output, { session }) => {
    if ((dialogue.successorTimeout || successorTimeout) !== successorTimeout) {
      output.push(`z=${dialogue.successorTimeout / 1000}`)
    }
    if (dialogue.predecessors.length) {
      output.push(session.text('.flowgraph.abstract.has-pred'))
    }
    if (dialogue.flag & Dialogue.Flag.context) {
      output.push(session.text('.flowgraph.abstract.context-mode'))
    }
  })

  ctx.on('dialogue/search', async (argv, test, dialogues) => {
    const dMap = argv.dialogueMap || (argv.dialogueMap = {})
    const predecessors = dialogues.filter((dialogue) => {
      if (dialogue._successors) return
      dMap[dialogue.id] = dialogue
      Object.defineProperty(dialogue, '_successors', { writable: true, value: [] })
      return true
    }).map(d => d.id)
    if (!predecessors.length) return

    const successors = (await ctx.teach.get({
      ...test,
      question: undefined,
      answer: undefined,
      predecessors,
      // TODO investigate this filter
    })).filter(d => !Object.keys(dMap).includes('' + d.id))

    for (const dialogue of successors) {
      for (const id of dialogue.predecessors) {
        dMap[id]?._successors.push(dialogue)
      }
    }

    await argv.app.parallel('dialogue/search', argv, test, successors)
  })

  ctx.on('dialogue/list', ({ _successors }, output, prefix, argv) => {
    if (_successors) {
      output.push(...formatQuestionAnswers(argv, _successors, prefix + '> '))
    }
  })

  ctx.on('dialogue/state', (state) => {
    state.predecessors = {}
  })

  ctx.on('dialogue/receive', ({ test, predecessors, userId }) => {
    test.stateful = true
    test.predecessors = Object.keys({
      ...predecessors[0],
      ...predecessors[userId],
    })
  })

  ctx.on('dialogue/prepare', ({ dialogues, isSearch }) => {
    if (isSearch) {
      // dialogues with predecessors are not shown in search result
      for (const dialogue of dialogues) {
        if (dialogue.predecessors.length) dialogue._weight = 0
      }
    } else if (dialogues.some(d => d.predecessors.length)) {
      // dialogues with predecessors are preferred
      for (const dialogue of dialogues) {
        if (!dialogue.predecessors.length) dialogue._weight = 0
      }
    }
  })

  ctx.before('dialogue/send', ({ dialogue, predecessors, userId }) => {
    const time = Date.now()
    if (dialogue.flag & Dialogue.Flag.context) userId = ''
    const predMap = predecessors[userId] || (predecessors[userId] = {})
    for (const id of dialogue.predecessors) {
      delete predMap[id]
    }
    predMap[dialogue.id] = time
    setTimeout(() => {
      if (predMap[dialogue.id] === time) {
        delete predMap[dialogue.id]
      }
    }, dialogue.successorTimeout || successorTimeout)
  })

  ctx.on('dialogue/test', ({ predecessors, stateful, noRecursive }, query) => {
    if (noRecursive) {
      query.predecessors = { $size: 0 }
    } else if (predecessors !== undefined) {
      const $el = predecessors.map(i => i.toString())
      const $or: Query.Expr<Dialogue>[] = []
      if (stateful) $or.push({ predecessors: { $size: 0 } })
      if ($el.length) $or.push({ predecessors: { $el } })
      if ($or.length) query.$and.push({ $or })
    }
  })
}
