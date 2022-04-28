import { Context, Dict, User } from 'koishi'
import { Dialogue } from '../utils'

declare module '../utils' {
  interface DialogueTest {
    writer?: string
    frozen?: boolean
    substitute?: boolean
  }

  interface Dialogue {
    writer: string
  }

  namespace Dialogue {
    interface Argv {
      writer?: string
      nameMap?: Dict<string>
      /**
       * a dict for storing user permissions, whose keys includes
       * all writers of the target dialogues list plus the -w option
       */
      authMap?: Dict<number>
    }

    interface Config {
      useWriter?: boolean
    }
  }
}

export default function apply(ctx: Context, config: Dialogue.Config) {
  if (config.useWriter === false) return
  const { authority } = config

  ctx.command('teach')
    .option('frozen', '-f', { authority: authority.frozen })
    .option('frozen', '-F, --no-frozen', { authority: authority.frozen, value: false })
    .option('writer', '-w <uid:user>')
    .option('writer', '-W, --anonymous', { authority: authority.writer, value: '' })
    .option('substitute', '-s')
    .option('substitute', '-S, --no-substitute', { value: false })

  ctx.emit('dialogue/flag', 'frozen')
  ctx.emit('dialogue/flag', 'substitute')

  ctx.before('dialogue/detail', async (argv) => {
    argv.nameMap = {}
    argv.authMap = {}
    const { options, nameMap, session, dialogues, authMap } = argv
    const writers = new Set(dialogues.map(d => d.writer).filter(Boolean))
    const fields: User.Field[] = ['id', 'authority', session.platform as never]
    if (options.writer === '') {
      argv.writer = ''
    } else if (options.writer) {
      const [platform, userId] = options.writer.split(':')
      const user = await ctx.database.getUser(platform, userId, fields)
      if (user) {
        writers.add(user.id)
        argv.writer = user.id
      }
    }
    if (!options.modify) fields.push('name')
    const users = await ctx.database.getUser('id', [...writers], fields)

    let hasUnnamed = false
    const idMap: Dict<string> = {}
    for (const user of users) {
      authMap[user.id] = user.authority
      if (options.modify) continue
      const userId = user[session.platform]
      if (user.name) {
        nameMap[user.id] = `${user.name} (${userId})`
      } else if (userId === session.userId) {
        nameMap[user.id] = `${session.author.nickname || session.author.username} (${session.userId})`
      } else {
        hasUnnamed = true
        idMap[userId] = user.id
      }
    }

    if (!options.modify && hasUnnamed && session.subtype === 'group') {
      try {
        const memberMap = await session.bot.getGuildMemberMap(session.guildId)
        for (const userId in memberMap) {
          nameMap[idMap[userId]] ||= memberMap[userId]
        }
      } catch { }
    }
  })

  ctx.on('dialogue/detail', ({ writer, flag }, output, { session, nameMap }) => {
    if (flag & Dialogue.Flag.frozen) {
      output.push(session.text('.writer.detail.frozen'))
    }
    if (writer) {
      const name = nameMap[writer] || session.text('.writer.detail.unknown')
      output.push(session.text('.writer.detail.writer', [name]))
      if (flag & Dialogue.Flag.substitute) {
        output.push(session.text('.writer.detail.substitute'))
      }
    }
  })

  // 1. when modifying a dialogue, if the operator is not the writer,
  //    an `admin` authority is required
  // 2. when adding or modifying a dialogue, if the dialogue is in substitute mode,
  //    or the operator is to set the dialogue to substitute mode,
  //    a higher authority than the original writer is required
  // 3. when using -w, the original writer authority should be higher than the target user
  // 4. frozen dialogues require `frozen` authority to modify
  ctx.on('dialogue/permit', ({ session, target, options, authMap }, { writer, flag }) => {
    const { substitute, writer: newWriter } = options
    const { id, authority } = session.user
    /* eslint-disable operator-linebreak */
    return (
      (newWriter && authority <= authMap[newWriter] && newWriter !== id) ||
      ((flag & Dialogue.Flag.frozen) && authority < config.authority.frozen) ||
      (writer !== id && (
        (target && authority < config.authority.admin) || (
          (substitute || (flag & Dialogue.Flag.substitute)) &&
          (authority <= (authMap[writer] || config.authority.base))
        )
      ))
    )
    /* eslint-enable operator-linebreak */
  })

  ctx.on('dialogue/detail-short', ({ flag }, output, { session }) => {
    if (flag & Dialogue.Flag.frozen) {
      output.push(session.text('.writer.abstract.frozen'))
    }
    if (flag & Dialogue.Flag.substitute) {
      output.push(session.text('.writer.abstract.substitute'))
    }
  })

  ctx.before('dialogue/search', ({ writer }, test) => {
    test.writer = writer
  })

  ctx.before('dialogue/modify', async ({ writer, options, session }) => {
    if (options.writer && typeof writer === 'undefined') {
      return session.text('.writer.target-not-exist')
    }
  })

  ctx.on('dialogue/modify', ({ writer, session, target }, data) => {
    if (typeof writer !== 'undefined') {
      data.writer = writer
    } else if (!target) {
      data.writer = session.user.id
    }
  })

  ctx.before('dialogue/attach-user', (state, userFields) => {
    for (const dialogue of state.dialogues) {
      if (dialogue.flag & Dialogue.Flag.substitute) {
        userFields.add('id')
      }
    }
  })

  // trigger substitute mode
  ctx.on('dialogue/before-send', async (state) => {
    const { dialogue, session } = state
    if (dialogue.flag & Dialogue.Flag.substitute && dialogue.writer && session.user.id !== dialogue.writer) {
      const userFields = new Set<User.Field>(['name', 'flag'])
      ctx.app.emit(session, 'dialogue/before-attach-user', state, userFields)
      // do a little trick here
      const { platform, userId } = session
      session.platform = 'id'
      session.userId = dialogue.writer
      session.user = null
      await session.observeUser(userFields)
      session.platform = platform
      session.userId = userId
    }
  })

  ctx.on('dialogue/test', (test, query) => {
    if (test.writer !== undefined) query.writer = test.writer
  })
}
