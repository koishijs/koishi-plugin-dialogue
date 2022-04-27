import { Context } from '@koishijs/client'
import {} from '@koishijs/plugin-status'
import Teach from './teach.vue'

export default (ctx: Context) => {
  ctx.addPage({
    path: '/teach',
    name: '问答',
    icon: 'book',
    authority: 3,
    fields: ['stats', 'meta'],
    component: Teach,
  })
}
