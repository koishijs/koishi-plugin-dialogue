import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'koishi-plugin-dialogue',
  description: '基于 koishi 的对话系统',

  themeConfig: {
    outline: [2, 3],
    sidebar: [{
      text: '指南',
      items: [
        { text: '基本用法', link: '/' },
        { text: '插值调用', link: '/interp.md' },
        { text: '概率机制', link: '/prob.md' },
        { text: '正则匹配', link: '/regexp.md' },
        { text: '上下文机制', link: '/context.md' },
        { text: '前置与后继问答', link: '/flow.md' },
        { text: '其他机制', link: '/misc.md' },
        { text: '配置项', link: '/config.md' },
      ],
    }],
  },

  vite: {
    resolve: {
      dedupe: ['vue'],
    },
  },
})
