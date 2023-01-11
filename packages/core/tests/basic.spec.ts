import { Logger } from 'koishi'
import Assets from '@koishijs/assets'
import createEnvironment from '.'
import * as jest from 'jest-mock'

const logger = new Logger('dialogue')

describe('koishi-plugin-dialogue (create)', () => {
  const { app, u3g1 } = createEnvironment()

  it('basic support', async () => {
    await u3g1.shouldNotReply('foo')
    await u3g1.shouldReply('# foo', '缺少问题或回答，请检查指令语法。')
    await u3g1.shouldReply('# foo bar', '问答已添加，编号为 1。')
    await u3g1.shouldReply('# foo bar baz', '存在多余的参数，请检查指令语法或将含有空格或换行的问答置于一对引号内。')
    await u3g1.shouldReply('foo', 'bar')
  })

  it('validate question', async () => {
    await u3g1.shouldReply('# <image/> bar', '问题必须是纯文本。')
    await u3g1.shouldReply('# foo[foo bar -x', '问题含有错误的或不支持的正则表达式语法。')
  })

  it('check duplicate', async () => {
    await u3g1.shouldReply('# foo bar', '问答已存在，编号为 1，如要修改请尝试使用 #1 指令。')
    await u3g1.shouldReply('# foo bar -P 1', '修改了已存在的问答，编号为 1。')
    await u3g1.shouldReply('# foo bar -P 1', '问答已存在，编号为 1，如要修改请尝试使用 #1 指令。')
  })

  it('handle error', async () => {
    logger.level = Logger.ERROR
    const mock = jest.spyOn(app.database, 'create')
    mock.mockRejectedValue(new Error('network error'))
    try {
      await u3g1.shouldReply('# foo baz', '添加问答时遇到错误。')
    } finally {
      mock.mockRestore()
      logger.level = Logger.WARN
    }
  })
})

describe('koishi-plugin-dialogue (modify)', () => {
  const { u3g1 } = createEnvironment({
    maxPreviews: 1,
  })

  it('modify text', async () => {
    await u3g1.shouldReply('# foo bar', '问答已添加，编号为 1。')
    await u3g1.shouldReply('#1', '问答 1 的详细信息：\n问题：foo\n回答：bar')
    await u3g1.shouldReply('#1 baz', '推测你想修改的是回答而不是问题。发送句号以修改回答，使用 -I 选项以忽略本提示。')
    await u3g1.shouldReply('.', '问答 1 已成功修改。')
    await u3g1.shouldReply('foo', 'baz')
    await u3g1.shouldReply('#1', '问答 1 的详细信息：\n问题：foo\n回答：baz')
    await u3g1.shouldReply('#1 foo', '问答 1 没有发生改动。')
  })

  it('modify flag', async () => {
    await u3g1.shouldNotReply('fooo')
    await u3g1.shouldReply('#1 -x', '问答 1 已成功修改。')
    await u3g1.shouldReply('#1', '问答 1 的详细信息：\n正则：foo\n回答：baz')
    await u3g1.shouldReply('#1 -x', '问答 1 没有发生改动。')
    await u3g1.shouldReply('fooo', 'baz')
  })

  it('multiple targets', async () => {
    await u3g1.shouldReply('# foo qux', '问答已添加，编号为 2。')
    await u3g1.shouldReply('#1,2', '一次最多同时预览 1 个问答。')
    await u3g1.shouldReply('#1..2 -x', '问答 2 已成功修改。\n问答 1 没有发生改动。')
  })

  it('remove dialogue', async () => {
    await u3g1.shouldReply('#1 -r', '问答 1 已成功删除。')
    await u3g1.shouldReply('#1', '没有搜索到编号为 1 的问答。')
  })
})

describe('koishi-plugin-dialogue (search)', () => {
  const { u3g1 } = createEnvironment({
    mergeThreshold: 1,
  })

  it('basic support', async () => {
    await u3g1.shouldReply('# foo bar', '问答已添加，编号为 1。')
    await u3g1.shouldReply('## foo', '问题“foo”的回答如下：\n1. bar')
    await u3g1.shouldReply('## bar', '没有搜索到问题“bar”，请尝试使用正则表达式匹配。')
    await u3g1.shouldReply('## bar -x', '没有搜索到含有正则表达式“bar”的问题。')
    await u3g1.shouldReply('## ~ bar', '回答“bar”的问题如下：\n1. foo')
    await u3g1.shouldReply('## ~ foo', '没有搜索到回答“foo”，请尝试使用正则表达式匹配。')
    await u3g1.shouldReply('## ~ foo -x', '没有搜索到含有正则表达式“foo”的回答。')
    await u3g1.shouldReply('## foo bar', '“foo”“bar”匹配的回答如下：\n1')
    await u3g1.shouldReply('## foo baz', '没有搜索到问答“foo”“baz”，请尝试使用正则表达式匹配。')
    await u3g1.shouldReply('## foo baz -x', '没有搜索到含有正则表达式“foo”“baz”的问答。')
  })

  it('regexp support', async () => {
    await u3g1.shouldReply('# foo baz', '问答已添加，编号为 2。')
    await u3g1.shouldReply('# goo baz', '问答已添加，编号为 3。')
    await u3g1.shouldReply('##', '共收录了 2 个问题和 3 个回答。')
    await u3g1.shouldReply('## fo -x', '问题正则表达式“fo”的搜索结果如下：\n1. 问题：foo，回答：bar\n2. 问题：foo，回答：baz')
    await u3g1.shouldReply('## ~ az -x', '回答正则表达式“az”的搜索结果如下：\n2. 问题：foo，回答：baz\n3. 问题：goo，回答：baz')
    await u3g1.shouldReply('## fo az -x', '问答正则表达式“fo”“az”的搜索结果如下：\n2. 问题：foo，回答：baz')
    await u3g1.shouldReply('### oo', '问题正则表达式“oo”的搜索结果如下：\nfoo (共 2 个回答)\ngoo (#3)')
    await u3g1.shouldReply('### ~ ba', '回答正则表达式“ba”的搜索结果如下：\nbar (#1)\nbaz (共 2 个问题)')
  })
})

describe('koishi-plugin-dialogue (assets)', () => {
  const logger = new Logger('teach')
  const { app, u3g1 } = createEnvironment()
  const upload = jest.fn(async (url: string) => url)

  app.plugin(class MockAssets extends Assets {
    types = ['image']
    upload = upload
    stats = async () => ({})
  })

  it('upload succeed', async () => {
    upload.mockResolvedValue('https://127.0.0.1/image/baz')
    await u3g1.shouldReply('# foo <image file=baz url=bar/>', '问答已添加，编号为 1。')
    await u3g1.shouldReply('foo', '<image url="https://127.0.0.1/image/baz"/>')
  })

  it('upload failed', async () => {
    logger.level = Logger.ERROR
    upload.mockRejectedValue('failed')
    try {
      await u3g1.shouldReply('#1 fooo', '问答 1 已成功修改。')
      await u3g1.shouldReply('#1 ~ <image file=bar url=baz/>', '上传资源时发生错误。')
    } finally {
      logger.level = Logger.WARN
    }
  })
})
