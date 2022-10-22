import { Argv, Awaitable, Context, Query, Schema, segment, Time } from 'koishi'
import * as Koishi from 'koishi'

// features
import { Abstract, DialogueService } from './service'
import { OrderedList } from './utils'
import command from './command'
import receiver from './receiver'
import search from './search'
import update from './update'
import review from './review'
import internal from './internal'
import probability from './probability'

export * from './command'
export * from './utils'
export * from './receiver'
export * from './search'
export * from './service'
export * from './update'
export * from './review'
export * from './probability'

declare module 'koishi' {
  interface Events {
    'dialogue/validate'(session: Dialogue.Session): void | string
    'dialogue/action'(session: Dialogue.Session): Awaitable<void | string | segment>
    'dialogue/before-action'(session: Dialogue.Session): Awaitable<void | string>
    'dialogue/permit'(session: Dialogue.Session, dialogue: Dialogue): boolean
    'dialogue/query'(test: DialogueTest, query: Query.Expr<Dialogue>): void
    'dialogue/abstract'(dialogue: Dialogue, output: Abstract, session: Dialogue.Session): void
    'dialogue/appendix'(dialogue: Dialogue, output: string[], prefix: string, session: Dialogue.Session): void
    'dialogue/usage'(output: OrderedList, session: Dialogue.Session): void
  }

  interface Context {
    dialogue: DialogueService
  }

  interface Tables {
    dialogue: Dialogue
  }
}

export interface Dialogue {
  id?: number
  question: string
  answer: string
  original: string
  flag: number
  _weight?: number
  _capture?: RegExpExecArray
  _type?: Dialogue.ModifyType
  _operator?: string
  _timestamp?: number
  _backup?: Readonly<Dialogue>
}

export interface DialogueTest {
  original?: string
  question?: string
  answer?: string
  regexp?: boolean
  activated?: boolean
  appellative?: boolean
  noRecursive?: boolean
}

export namespace Dialogue {
  export type ModifyType = 'create' | 'modify' | 'remove'
  export type Field = keyof Dialogue

  export interface Config {
    historyTimeout?: number
  }

  export interface Stats {
    questions: number
    dialogues: number
  }

  export enum Flag {
    /** 冻结：只有 4 级以上权限者可修改 */
    frozen = 1,
    /** 正则：使用正则表达式进行匹配 */
    regexp = 2,
    /** 上下文：后继问答可以被上下文内任何人触发 */
    context = 4,
    /** 代行者：由教学者完成回答的执行 */
    substitute = 8,
    /** 补集：上下文匹配时取补集 */
    complement = 16,
  }

  export interface Options {
    help?: boolean
    original?: string
    appellative?: boolean
    action?: 'review' | 'revert' | 'remove' | 'create' | 'search' | 'modify'
    skipped?: number[]
    updated?: number[]
    unknown?: number[]
    forbidden?: number[]
    dialogues?: Dialogue[]
    dialogueMap?: Record<number, Dialogue>
  }

  export interface Session extends Koishi.Session<'authority'> {
    argv: Argv<'authority', never, string[], Dialogue.Options>
  }
}

export type Config = Dialogue.Config

export const schema: Schema<Config> = Schema.intersect([
  Schema.object({
    prefix: Schema.string().description('教学指令的前缀。').default('#'),
    historyTimeout: Schema.natural().role('ms').description('教学操作在内存中的保存时间。').default(Time.minute * 10),
  }).description('通用设置'),

  Schema.object({
    authority: Schema.object({
      base: Schema.natural().description('可访问教学系统的权限等级。').default(2),
      admin: Schema.natural().description('可修改非自己创建的问答的权限等级。').default(3),
      context: Schema.natural().description('可修改上下文设置的权限等级。').default(3),
      frozen: Schema.natural().description('可修改锁定的问答的权限等级。').default(4),
      regExp: Schema.natural().description('可使用正则表达式的权限等级。').default(3),
      writer: Schema.natural().description('可设置作者或匿名的权限等级。').default(2),
    }),
  }).description('权限设置'),

  Schema.object({
    maxRedirections: Schema.natural().description('问题重定向的次数上限。').default(3),
    successorTimeout: Schema.natural().role('ms').description('问答触发后继问答的持续时间。').default(Time.second * 20),
    appellationTimeout: Schema.natural().role('ms').description('称呼作为问题触发的后续效果持续时间。').default(Time.minute * 10),
  }).description('触发设置'),

  Schema.object({
    maxPreviews: Schema.natural().description('同时查看的最大问答数量。').default(10),
    previewDelay: Schema.natural().role('ms').description('显示两个问答之间的时间间隔。').default(Time.second * 0.5),
    itemsPerPage: Schema.natural().description('搜索结果每一页显示的最大数量。').default(30),
    maxAnswerLength: Schema.natural().description('搜索结果中回答显示的长度限制。').default(100),
    mergeThreshold: Schema.natural().description('合并搜索模式中，相同的问题和回答被合并的最小数量。').default(5),
  }).description('显示设置'),
])

export const name = 'dialogue'
export const using = ['database'] as const

export function apply(ctx: Context, config: Config) {
  ctx.i18n.define('zh', require('./locales/zh'))

  // features
  ctx.plugin(DialogueService, config)
  ctx.plugin(command, config)
  ctx.plugin(receiver, config)
  ctx.plugin(search, config)
  ctx.plugin(update, config)
  ctx.plugin(review, config)
  ctx.plugin(internal, config)
  ctx.plugin(probability, config)
}
