import { Assets, Logger, Random } from 'koishi'
import { MessageClient } from '@koishijs/plugin-mock'
import { install, InstalledClock } from '@sinonjs/fake-timers'
import createEnvironment from '.'
import * as jest from 'jest-mock'

describe('Teach Plugin - Appellative', () => {
  const { u3g1 } = createEnvironment({})

  let clock: InstalledClock
  const randomReal = jest.spyOn(Random, 'real')

  before(() => {
    clock = install({ shouldAdvanceTime: true, advanceTimeDelta: 5 })
    randomReal.mockReturnValue(1 - Number.EPSILON)
  })

  after(() => {
    clock.uninstall()
    randomReal.mockRestore()
  })

  it('appellative', async () => {
    await u3g1.shouldReply('# koishi,foo bar', '问答已添加，编号为 1。')
    await u3g1.shouldNotReply('foo')
    // should strip spaces
    await u3g1.shouldReply('koishi, foo', 'bar')
    // should strip punctuations
    await u3g1.shouldReply('satori, foo?', 'bar')
    // TODO support at-trigger
    // await u3g1.shouldReply(`[CQ:at,id=${app.selfId}] foo`, 'bar')
    await u3g1.shouldReply('#1', '问答 1 的详细信息：\n问题：koishi,foo\n回答：bar\n触发权重：p=0, P=1')
    await u3g1.shouldReply('## foo', '问题“foo”的回答如下：\n1. [p=0, P=1] bar')
  })

  it('activated', async () => {
    await u3g1.shouldReply('# koishi ?', '问答已添加，编号为 2。')
    await u3g1.shouldReply('koishi', '?')
    await u3g1.shouldReply('foo', 'bar')

    // due to mocked Random.real
    await u3g1.shouldReply('# satori ! -p 0.5', '问答已添加，编号为 3。')
    await u3g1.shouldNotReply('satori')
  })

  it('regular expression', async () => {
    clock.runAll()
    await u3g1.shouldReply('# foo baz -xP 0.5', '问答已添加，编号为 4。')
    await u3g1.shouldNotReply('foo')
    await u3g1.shouldReply('koishi, fooo', 'baz')
    await u3g1.shouldReply('#4 -p 0.5 -P 1', '问答 4 已成功修改。')
    await u3g1.shouldReply('koishi, fooo', 'baz')
  })

  it('unescape semgent (#309)', async () => {
    await u3g1.shouldReply('# ^有人说&#91;:：&#93;(.+) 谁说过$1？ -x', '问答已添加，编号为 5。')
    await u3g1.shouldReply('有人说：要有光', '谁说过要有光？')
  })
})

describe('Teach Plugin - Interpolate', () => {
  function createTest(title: string, callback: (u3g1: MessageClient) => Promise<void>) {
    it(title, async () => {
      const { app, u3g1, start, stop } = createEnvironment({})
      app.command('bar').action(() => 'hello')
      app.command('baz').action(({ session }) => session.sendQueued('hello'))
      app.command('report [text]').action(async ({ session }, text) => {
        await session.sendQueued(text)
        await session.sendQueued('end')
      })

      await start()
      await callback(u3g1)
      await stop()
    })
  }

  createTest('basic support', async (u3g1) => {
    await u3g1.shouldReply('# foo $(bar)', '问答已添加，编号为 1。')
    await u3g1.shouldReply('foo', ['hello'])
    await u3g1.shouldReply('#1 ~ 1$(bar)2', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['1hello2'])
    await u3g1.shouldReply('#1 ~ 1$(bar)2$(bar)3', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['1hello2hello3'])
    await u3g1.shouldReply('#1 ~ 1$(barrr)2', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['12'])
    await u3g1.shouldReply('#1 ~ $(barrr)', '问答 1 已成功修改。')
    await u3g1.shouldNotReply('foo')
  })

  createTest('queued messages', async (u3g1) => {
    await u3g1.shouldReply('# foo $(baz)', '问答已添加，编号为 1。')
    await u3g1.shouldReply('foo', ['hello'])
    await u3g1.shouldReply('#1 ~ 1$(baz)2', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['1hello', '2'])
    await u3g1.shouldReply('#1 ~ $(bar)$(baz)', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['hellohello'])
    await u3g1.shouldReply('#1 ~ $(baz)$(bar)', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['hello', 'hello'])
    await u3g1.shouldReply('#1 ~ 1$n$(bar)$n2', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['1', 'hello', '2'])
    await u3g1.shouldReply('#1 ~ 1$n$(baz)$n2', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', ['1', 'hello', '2'])
  })

  createTest('capturing groups', async (u3g1) => {
    await u3g1.shouldReply('# ^foo(.*) $(report $1) -x', '问答已添加，编号为 1。')
    await u3g1.shouldReply('foobar', ['bar', 'end'])
    await u3g1.shouldReply('foo', ['end'])
    await u3g1.shouldReply('#1 ~ foo$0', '问答 1 已成功修改。')
    await u3g1.shouldReply('foobar', ['foofoobar'])
  })
})
