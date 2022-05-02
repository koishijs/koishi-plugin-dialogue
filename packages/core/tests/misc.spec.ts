import { App, Assets, Logger } from 'koishi'
import createEnvironment from '.'
import * as teach from '../src'
import * as jest from 'jest-mock'

describe('Teach Plugin - Miscellaneous', () => {
  describe('Assets', () => {
    const logger = new Logger('teach')
    const { app, u3g1 } = createEnvironment({})
    const upload = jest.fn(async (url: string) => url)

    app.plugin(class MockAssets extends Assets {
      types = ['image']
      upload = upload
      stats = async () => ({})
    })

    it('upload succeed', async () => {
      upload.mockResolvedValue('https://127.0.0.1/image/baz')
      await u3g1.shouldReply('# foo [CQ:image,file=baz,url=bar]', '问答已添加，编号为 1。')
      await u3g1.shouldReply('foo', '[CQ:image,url=https://127.0.0.1/image/baz]')
    })

    it('upload failed', async () => {
      logger.level = Logger.ERROR
      upload.mockRejectedValue('failed')
      await u3g1.shouldReply('#1 fooo', '问答 1 已成功修改。')
      await u3g1.shouldReply('#1 ~ [CQ:image,file=bar,url=baz]', '上传资源时发生错误。')
      logger.level = Logger.WARN
    })
  })

  describe('Rate Limit', () => {
    // make coverage happy
    new App().plugin(teach, { throttle: [] })
    new App().plugin(teach, { preventLoop: [] })
    new App().plugin(teach, { preventLoop: 10 })

    it('throttle', async () => {
      const { u2g1, u3g1, u4g1, u4g2, start, stop } = createEnvironment({
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
      const { u2g1, u3g1, u4g1, start, stop } = createEnvironment({
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
})
