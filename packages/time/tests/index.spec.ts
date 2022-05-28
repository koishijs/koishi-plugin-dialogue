import createEnvironment from 'koishi-plugin-dialogue/tests'
import { install } from '@sinonjs/fake-timers'
import { Time } from 'koishi'
import * as time from '../src'

const DETAIL_HEAD = '问答 1 的详细信息：\n问题：foo\n回答：bar\n'
const SEARCH_HEAD = '问题“foo”的回答如下：\n'

describe('Time', () => {
  const { app, u3g1 } = createEnvironment({})

  app.plugin(time)

  it('time', async () => {
    await u3g1.shouldReply('# bar foo -t baz', '选项 startTime 输入无效，请输入正确的时间。')
    await u3g1.shouldReply('# foo bar -t 8 -T 16', '问答已添加，编号为 1。')
    await u3g1.shouldReply('#1', DETAIL_HEAD + '触发时段：8:00-16:00')
    await u3g1.shouldReply('## foo', SEARCH_HEAD + '1. [8:00-16:00] bar')
    await u3g1.shouldReply('## foo -t 12', SEARCH_HEAD + '1. [8:00-16:00] bar')
    await u3g1.shouldReply('## foo -T 12', '没有搜索到问题“foo”，请尝试使用正则表达式匹配。')
  })

  it('receiver', async () => {
    const clock = install({
      now: new Date('2020-1-1 12:00'),
      shouldAdvanceTime: true,
      advanceTimeDelta: 5,
    })

    try {
      await u3g1.shouldReply('foo', 'bar')
      clock.tick(8 * Time.hour) // 20:00
      await u3g1.shouldNotReply('foo')
      clock.tick(8 * Time.hour) // 4:00
      await u3g1.shouldNotReply('foo')
      clock.tick(8 * Time.hour) // 12:00
      await u3g1.shouldReply('foo', 'bar')
    } finally {
      clock.uninstall()
    }
  })
})
