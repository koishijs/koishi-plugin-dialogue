import { defineConfig } from '@koishijs/vitepress'

const isDev = process.env.NODE_ENV === 'development' || process.env.VERCEL_ENV === 'preview'

export default defineConfig({
  title: 'koishi-plugin-dialogue',

  head: [
    ['link', { rel: 'icon', href: 'https://koishi.chat/logo.png' }],
    ['link', { rel: 'manifest', href: '/manifest.json' }],
    ['meta', { name: 'theme-color', content: '#5546a3' }],
  ],

  locales: {
    'zh-CN': require('./zh-CN'),
    ...(isDev ? {
    } : {}),
  },

  themeConfig: {
    indexName: 'koishi-dialogue',
    logo: 'https://koishi.chat/logo.png',

    socialLinks: {
      github: 'https://github.com/koishijs/koishi-plugin-dialogue',
    },
  },
})
