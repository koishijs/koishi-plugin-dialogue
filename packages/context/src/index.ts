import { Context, defineProperty, difference, Schema, union } from 'koishi'
import { Dialogue, equal } from 'koishi-plugin-dialogue'

declare module 'koishi-plugin-dialogue' {
  interface DialogueTest {
    guilds?: string[]
    reversed?: boolean
    partial?: boolean
  }

  interface Dialogue {
    guilds: string[]
  }
}

export const RE_GROUPS = /^\d+(,\d+)*$/

export interface Config {
  authority?: number
}

export const Config: Schema<Config> = Schema.object({
  authority: Schema.number().default(3).description('修改上下文设置的权限等级。'),
})

export const name = 'koishi-plugin-dialogue-context'

export function apply(ctx: Context, config: Config) {
  const { authority } = config

  ctx.i18n.define('zh', require('./locales/zh'))

  ctx.model.extend('dialogue', {
    guilds: 'list(255)',
  })

  ctx.command('teach')
    .option('disable', '-d')
    .option('disableGlobal', '-D', { authority })
    .option('enable', '-e')
    .option('enableGlobal', '-E', { authority })
    .option('guilds', '-g <gids:string>', { authority, type: RE_GROUPS })
    .option('global', '-G')
    .before(({ options, session }) => {
      if (options.disable && options.enable) {
        return session.text('.options-conflict', ['-d, -e'])
      } else if (options.disableGlobal && options.enableGlobal) {
        return session.text('.options-conflict', ['-D, -E'])
      } else if (options.disableGlobal && options.disable) {
        return session.text('.options-conflict', ['-D, -d'])
      } else if (options.enable && options.enableGlobal) {
        return session.text('.options-conflict', ['-E, -e'])
      }

      let noContextOptions = false
      let reversed: boolean, partial: boolean, guilds: string[]
      if (options.disable) {
        reversed = true
        partial = !options.enableGlobal
        guilds = [session.gid]
      } else if (options.disableGlobal) {
        reversed = !!options.guilds
        partial = false
        guilds = options.enable ? [session.gid] : []
      } else if (options.enableGlobal) {
        reversed = !options.guilds
        partial = false
        guilds = []
      } else {
        noContextOptions = !options.enable
        if (options['target'] ? options.enable : !options.global) {
          reversed = false
          partial = true
          guilds = [session.gid]
        }
      }

      defineProperty(options, 'reversed', reversed)
      defineProperty(options, 'partial', partial)
      if ('guilds' in options) {
        if (noContextOptions) {
          return session.text('.context.modifier-expected')
        } else {
          defineProperty(options, '_guilds', options.guilds ? options.guilds.split(',').map(id => `${session.platform}:${id}`) : [])
        }
      } else if (session.subtype !== 'group' && options['partial']) {
        return session.text('.context.private-context')
      } else {
        defineProperty(options, '_guilds', guilds)
      }
    })

  ctx.on('dialogue/modify', ({ options }, data) => {
    const { _guilds, partial, reversed } = options
    if (!_guilds) return
    if (!data.guilds) data.guilds = []
    if (partial) {
      const newGroups = !(data.flag & Dialogue.Flag.complement) === reversed
        ? difference(data.guilds, _guilds)
        : union(data.guilds, _guilds)
      if (!equal(data.guilds, newGroups)) {
        data.guilds = newGroups.sort()
      }
    } else {
      data.flag = data.flag & ~Dialogue.Flag.complement | (+reversed * Dialogue.Flag.complement)
      if (!equal(data.guilds, _guilds)) {
        data.guilds = _guilds.sort()
      }
    }
  })

  ctx.before('dialogue/search', ({ options }, test) => {
    test.partial = options.partial
    test.reversed = options.reversed
    test.guilds = options._guilds
  })

  ctx.on('dialogue/detail', ({ guilds, flag }, output, { session }) => {
    const includeCurrentGuild = session.subtype === 'group' && guilds.includes(session.gid)
    const prefix = flag & Dialogue.Flag.complement ? 'enable-' : 'disable-'
    const path = includeCurrentGuild
      ? 'except-current-' + (guilds.length - 1 ? 'and-more' : 'only')
      : guilds.length ? 'except-some' : 'all'
    output.push(session.text('.context.' + prefix + path, [guilds.length]))
  })

  ctx.on('dialogue/detail-short', ({ guilds, flag }, output, { session, options }) => {
    if (!options._guilds && session.subtype === 'group') {
      const isReversed = flag & Dialogue.Flag.complement
      const hasGroup = guilds.includes(session.gid)
      output.unshift(!isReversed === hasGroup ? isReversed ? 'E' : 'e' : isReversed ? 'd' : 'D')
    }
  })

  ctx.on('dialogue/receive', ({ session, test }) => {
    test.partial = true
    test.reversed = false
    test.guilds = [session.gid]
  })

  ctx.on('dialogue/test', (test, query) => {
    if (!test.guilds || !test.guilds.length) return
    query.$and.push({
      $or: [{
        flag: { [test.reversed ? '$bitsAllSet' : '$bitsAllClear']: Dialogue.Flag.complement },
        $and: test.guilds.map($el => ({ guilds: { $el } })),
      }, {
        flag: { [test.reversed ? '$bitsAllClear' : '$bitsAllSet']: Dialogue.Flag.complement },
        $not: { guilds: { $el: test.guilds } },
      }],
    })
  })
}
