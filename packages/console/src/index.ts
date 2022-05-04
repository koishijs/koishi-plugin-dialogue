import { Context, Schema } from 'koishi'
import { resolve } from 'path'
import { Dialogue } from 'koishi-plugin-dialogue'
import {} from '@koishijs/plugin-console'
import {} from '@koishijs/plugin-status'

declare module '@koishijs/plugin-status' {
  namespace MetaProvider {
    interface Payload extends Dialogue.Stats {}
  }

  namespace StatisticsProvider {
    interface Payload {
      questions: QuestionData[]
    }
  }
}

interface QuestionData {
  name: string
  value: number
}

export interface Config {}

export const Config: Schema<Config> = Schema.object({})

export const name = 'koishi-plugin-dialogue-console'

export const using = ['console.meta', 'console.stats'] as const

export function apply(ctx: Context, config: Config) {
  const { stats, meta } = ctx.console

  ctx.console.addEntry({
    dev: resolve(__dirname, '../client/index.ts'),
    prod: resolve(__dirname, '../dist'),
  })

  ctx.on('dialogue/before-send', ({ session, dialogue }) => {
    session._sendType = 'dialogue'
    stats.addDaily('dialogue', dialogue.id)
    stats.upload()
  })

  meta.extend(() => ctx.dialogue.stats())

  stats.extend(async (payload, data) => {
    const dialogueMap = stats.average(data.daily.map(data => data.dialogue))
    const dialogues = await ctx.database.get('dialogue', Object.keys(dialogueMap).map(i => +i), ['id', 'original'])
    const questionMap: Record<string, QuestionData> = {}
    for (const dialogue of dialogues) {
      const { id, original: name } = dialogue
      if (name.includes('[CQ:') || name.startsWith('hook:')) continue
      if (!questionMap[name]) {
        questionMap[name] = {
          name,
          value: dialogueMap[id],
        }
      } else {
        questionMap[name].value += dialogueMap[id]
      }
    }
    payload.questions = Object.values(questionMap)
  })
}
