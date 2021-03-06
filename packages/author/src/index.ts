import { Context, Dict, Schema, User } from 'koishi'
import { Dialogue } from 'koishi-plugin-dialogue'

declare module 'koishi-plugin-dialogue' {
  interface DialogueTest {
    writer?: string
    frozen?: boolean
    substitute?: boolean
  }

  interface Dialogue {
    writer: string
  }

  namespace Dialogue {
    interface Options {
      writer?: string
      nameMap?: Dict<string>
      /**
       * a dict for storing user permissions, whose keys includes
       * all writers of the target dialogues list plus the -w option
       */
      authMap?: Dict<number>
      substitute?: boolean
    }
  }
}

export interface Config {
  authority?: {
    frozen?: number
    writer?: number
  }
}

export const Config: Schema<Config> = Schema.object({
  authority: Schema.object({
    frozen: Schema.number().default(2).description('设置作者或匿名的权限等级。'),
    writer: Schema.number().default(4).description('修改锁定状态的权限等级。'),
  }),
})

export const name = 'koishi-plugin-dialogue-author'

export const using = ['dialogue'] as const

export function apply(ctx: Context, config: Config) {
  const { authority } = config

  ctx.i18n.define('zh', require('./locales/zh'))

  ctx.model.extend('dialogue', {
    writer: 'string(255)',
  })

  ctx.command('teach')
    .option('frozen', '-f', { authority: authority.frozen })
    .option('frozen', '-F, --no-frozen', { authority: authority.frozen, value: false })
    .option('writer', '-w <uid:user>')
    .option('writer', '-W, --anonymous', { authority: authority.writer, value: '' })
    .option('substitute', '-s')
    .option('substitute', '-S, --no-substitute', { value: false })

  ctx.dialogue.flag('frozen')
  ctx.dialogue.flag('substitute')

  ctx.before('dialogue/detail', async (session) => {
    const { options } = session.argv
    options.nameMap = {}
    options.authMap = {}
    const { nameMap, dialogues, authMap } = options
    const writers = new Set(dialogues.map(d => d.writer).filter(Boolean))
    const fields: User.Field[] = ['id', 'authority', session.platform as never]
    if (options.writer === '') {
      options.writer = ''
    } else if (options.writer) {
      const [platform, userId] = options.writer.split(':')
      const user = await ctx.database.getUser(platform, userId, fields)
      if (user) {
        writers.add(user.id)
        options.writer = user.id
      }
    }
    if (options.action !== 'modify') fields.push('name')
    const users = await ctx.database.getUser('id', [...writers], fields)

    let hasUnnamed = false
    const idMap: Dict<string> = {}
    for (const user of users) {
      authMap[user.id] = user.authority
      if (options.action === 'modify') continue
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

    if (options.action !== 'modify' && hasUnnamed && session.subtype === 'group') {
      try {
        const memberMap = await session.bot.getGuildMemberMap(session.guildId)
        for (const userId in memberMap) {
          nameMap[idMap[userId]] ||= memberMap[userId]
        }
      } catch { }
    }
  })

  ctx.on('dialogue/detail', ({ writer, flag }, output, session) => {
    if (flag & Dialogue.Flag.frozen) {
      output.push(session.text('.writer.detail.frozen'))
    }
    if (writer) {
      const { nameMap } = session.argv.options
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
  ctx.on('dialogue/permit', (session, { writer, flag }) => {
    const { target, substitute, writer: newWriter, authMap } = session.argv.options
    const { id, authority } = session.user as User.Observed
    /* eslint-disable operator-linebreak */
    return (
      (newWriter && authority <= authMap[newWriter] && newWriter !== id) ||
      ((flag & Dialogue.Flag.frozen) && authority < config.authority.frozen) ||
      (writer !== id && (
        (target && authority < ctx.dialogue.config.authority.admin) || (
          (substitute || (flag & Dialogue.Flag.substitute)) &&
          (authority <= (authMap[writer] || ctx.dialogue.config.authority.base))
        )
      ))
    )
    /* eslint-enable operator-linebreak */
  })

  ctx.on('dialogue/abstract', ({ flag }, output, { session }) => {
    if (flag & Dialogue.Flag.frozen) {
      output.push(session.text('.writer.abstract.frozen'))
    }
    if (flag & Dialogue.Flag.substitute) {
      output.push(session.text('.writer.abstract.substitute'))
    }
  })

  ctx.before('dialogue/search', (session, test) => {
    test.writer = session.argv.options.writer
  })

  ctx.before('dialogue/modify', async (session) => {
    const { writer } = session.argv.options
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
      const { platform } = session
      const userFields = new Set<User.Field>(['name', 'flag', platform as never])
      ctx.app.emit(session, 'dialogue/before-attach-user', state, userFields)
      // do a little trick here
      session.platform = 'id'
      session.userId = dialogue.writer
      await session.observeUser(userFields)
      session.platform = platform
      session.userId = session.user[platform]
    }
  })

  ctx.on('dialogue/query', (test, query) => {
    if (test.writer !== undefined) query.writer = test.writer
  })
}
