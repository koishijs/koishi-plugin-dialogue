import createEnvironment from 'koishi-plugin-dialogue/tests'
import { App } from 'koishi'
import * as rateLimit from '../src'

describe('Rate Limit', () => {
  // make coverage happy
  new App().plugin(rateLimit, { throttle: [] })
  new App().plugin(rateLimit, { preventLoop: [] })
  new App().plugin(rateLimit, { preventLoop: 10 })

  it('throttle', async () => {
    const { app, u2g1, u3g1, u4g1, u4g2, start, stop } = createEnvironment({})

    app.plugin(rateLimit, {
      throttle: { interval: 1000, responses: 2 },
    })

    await start()
    await u3g1.shouldReply('# baz bar', '问答已添加，编号为 1。')
    await u3g1.shouldReply('# foo => baz', '问答已添加，编号为 2。')
    await u2g1.shouldReply('foo', 'bar')
    await u3g1.shouldReply('foo', 'bar')
    await u4g1.shouldNotReply('foo')
    await u4g2.shouldReply('foo', 'bar')
    await stop()
  })

  it('preventLoop', async () => {
    const { app, u2g1, u3g1, u4g1, start, stop } = createEnvironment({})

    app.plugin(rateLimit, {
      preventLoop: { length: 5, participants: 2 },
    })

    await start()
    await u3g1.shouldReply('# baz bar', '问答已添加，编号为 1。')
    await u3g1.shouldReply('# foo => baz', '问答已添加，编号为 2。')
    await u2g1.shouldReply('foo', 'bar')
    await u2g1.shouldReply('foo', 'bar')
    await u3g1.shouldReply('foo', 'bar')
    await u3g1.shouldReply('foo', 'bar')
    await u2g1.shouldReply('foo', 'bar')
    await u2g1.shouldNotReply('foo')
    await u3g1.shouldNotReply('foo')
    await u4g1.shouldReply('foo', 'bar')
    await stop()
  })
})
