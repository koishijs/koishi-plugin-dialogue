import { Context, makeArray, Schema } from 'koishi'
import {} from 'koishi-plugin-dialogue'

declare module 'koishi-plugin-dialogue/lib/receiver' {
  interface SessionState {
    counters?: Record<number, number>
    initiators?: string[]
    loopTimestamp?: number
  }
}

export interface ThrottleConfig {
  interval: number
  responses: number
}

const ThrottleConfig: Schema<ThrottleConfig> = Schema.object({
  interval: Schema.number(),
  responses: Schema.number(),
})

export interface LoopConfig {
  participants: number
  length: number
  debounce?: number
}

const LoopConfig: Schema<LoopConfig> = Schema.object({
  participants: Schema.number(),
  length: Schema.number(),
  debounce: Schema.number(),
})

export interface Config {
  throttle?: ThrottleConfig | ThrottleConfig[]
  preventLoop?: number | LoopConfig | LoopConfig[]
}

export const Config: Schema<Config> = Schema.object({
  throttle: Schema.union([
    Schema.array(ThrottleConfig),
    Schema.transform(ThrottleConfig, config => [config]),
  ]),
  preventLoop: Schema.union([
    Schema.array(LoopConfig),
    Schema.transform(LoopConfig, config => [config]),
    Schema.transform(Number, length => [{ participants: 1, length }]),
  ]),
})

export const name = 'koishi-plugin-dialogue-rate-limit'

export const using = ['dialogue'] as const

export function apply(ctx: Context, config: Config) {
  const throttleConfig = makeArray(config.throttle)
  const counters: Record<number, number> = {}
  for (const { interval, responses } of throttleConfig) {
    counters[interval] = responses
  }

  ctx.on('dialogue/state', (state) => {
    state.counters = { ...counters }
  })

  ctx.on('dialogue/receive', ({ counters, session }) => {
    if (session._redirected) return
    for (const interval in counters) {
      if (counters[interval] <= 0) return true
    }
  })

  ctx.before('dialogue/send', ({ counters, session }) => {
    if (session._redirected) return
    for (const { interval } of throttleConfig) {
      counters[interval]--
      setTimeout(() => counters[interval]++, interval)
    }
  })

  const { preventLoop } = config

  const preventLoopConfig: LoopConfig[] = !preventLoop ? []
    : typeof preventLoop === 'number' ? [{ length: preventLoop, participants: 1 }]
      : makeArray(preventLoop)
  const initiatorCount = Math.max(0, ...preventLoopConfig.map(c => c.length))

  ctx.on('dialogue/state', (state) => {
    state.initiators = []
  })

  ctx.on('dialogue/receive', (state) => {
    if (state.session._redirected) return
    const timestamp = Date.now()
    for (const { participants, length, debounce } of preventLoopConfig) {
      if (state.initiators.length < length) break
      const initiators = new Set(state.initiators.slice(0, length))
      if (initiators.size <= participants
        && initiators.has(state.userId)
        && !(debounce > timestamp - state.loopTimestamp)) {
        state.loopTimestamp = timestamp
        return true
      }
    }
  })

  ctx.before('dialogue/send', (state) => {
    if (state.session._redirected) return
    state.initiators.unshift(state.userId)
    state.initiators.splice(initiatorCount, Infinity)
    state.loopTimestamp = null
  })
}
