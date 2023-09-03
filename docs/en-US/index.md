# 基本用法

::: tip 提示
本章介绍的功能都由 koishi-plugin-dialogue 插件提供。
:::

**问答**是 Koishi 教学系统中的基本单位。一个问答包含一个问题、其对应的回答以及其他相关的设置。**问题**用于匹配 Bot 收到的消息，如果匹配成功，则会将**回答**作为该消息的响应。一个问题可以对应多种回答，每种回答也可能包含多条消息。但无论如何这都可以用一条问答来表示。

**问答编号**是每个问答特有的编号，你可以用其修改问答本身或是设置前置和后继问题。

## 添加问答

使用 `# 问题 回答` 的语法来添加问答。

<chat-panel>
<chat-message nickname="Alice"># foo bar</chat-message>
<chat-message nickname="Koishi">问答已添加，编号为 1001。</chat-message>
<chat-message nickname="Alice">foo</chat-message>
<chat-message nickname="Koishi">bar</chat-message>
</chat-panel>

如果问题或回答中包含空白字符（空格，换行等），应该将对应的部分用引号包裹起来（半角全角均可）：

<chat-panel>
<chat-message nickname="Alice"># “有空格 的问题” “有换行<br>的回答”</chat-message>
<chat-message nickname="Koishi">问答已添加，编号为 1002。</chat-message>
<chat-message nickname="Alice">有空格 的问题</chat-message>
<chat-message nickname="Koishi">有换行<br>的回答</chat-message>
</chat-panel>

如果要添加的问答已经存在，且拥有修改权限，则会使用额外传入的参数对现有的问答进行修改。添加或修改完成后会提示该问答的编号。

## 搜索问答

使用 `## 问题 回答` 的语法来搜索问答的编号。如果只搜索特定问题的所有回答，可以使用 `## 问题`。反之，如果只搜索特定回答的所有问题，可以使用 `## ~ 回答`。这里的 `~` 充当占位符的作用。

<chat-panel>
<chat-message nickname="Alice">## foo</chat-message>
<chat-message nickname="Koishi">问题“foo”的回答如下：<br>1001. bar</chat-message>
<chat-message nickname="Alice">## ~ bar</chat-message>
<chat-message nickname="Koishi">回答“bar”的问题如下：<br>1001. foo</chat-message>
</chat-panel>

由于过长的文本容易带来刷屏的不良体验，因此 Koishi 一次只会提供不超过 30 条搜索结果。如果搜索结果超过这个数字则会进行分页，同时只显示第一页的内容。可以通过 `/ 页码` 调整要查看的页码。

## 查看和修改问答

::: tip 提示
为了避免刷屏，一次查看的问答数量不能超过 10。批量修改问答则没有这个限制。你可以通过配置 [maxPreviews](./config.md#max-previews) 修改这个行为。
:::

使用 `#id` 查看一个问答的具体设置。

<chat-panel>
<chat-message nickname="Alice">#1001</chat-message>
<chat-message nickname="Koishi">编号为 1001 的问答信息：<br>问题：foo<br>回答：bar</chat-message>
</chat-panel>

如果传入了额外的选项和参数，则会视为对该问题的修改。例如，`#id 问题` 用于修改该问答的问题，`#id ~ 回答` 用于修改该问答的回答，`#id -p 0.5` 用于设置问答的概率为 0.5（参见 [概率机制](./prob.md) 一节），`#id -e` 用于使该问答在本群生效（参见 [上下文机制](./context.md) 一节）等等。

<chat-panel>
<chat-message nickname="Alice">#1001 ~ baz</chat-message>
<chat-message nickname="Koishi">问答 1001 已成功修改。</chat-message>
<chat-message nickname="Alice">foo</chat-message>
<chat-message nickname="Koishi">baz</chat-message>
</chat-panel>

特别地，`#id -r` 用于彻底删除一个问答，之后无法恢复。

<chat-panel>
<chat-message nickname="Alice">#1002 -r</chat-message>
<chat-message nickname="Koishi">问答 1002 已成功删除。</chat-message>
<chat-message nickname="Alice">有空格 的问题</chat-message>
  '——— 无事发生 ———',
</chat-panel>

你也可以将上面的 `id` 替换成由半角逗号隔开的多个问答编号，这样就可以同时查看或者修改多个问答了，例如 `#123,456`。更特别地，如果你要查看或修改的多个问答有着连续的编号，你还可以使用 `#123..126` 表示 `#123,124,125,126`。

## Fuzzy Matching

为了提高教学问答的覆盖面，Koishi 有一套默认的模糊匹配机制。对于每个添加的问题，Koishi 会对其做以下处理：

- 繁体字转简体字，大写转小写，全角转半角
- 去除开头和结尾处的标点符号
- 去除问题中间的空白字符
- 去除问题开头的称呼前缀（这里的机制较为复杂，会在后面专门介绍）

因此，“我喜欢你”和“我 喜 歡 你！”会被认为是相同的问题。但是尽管如此，处理过后的问题往往失去了较高的可读性，因此 Koishi 实际上会保存你教学时使用的原问题，当显示搜索结果和查看问题时显示原问题，而当真正匹配时才使用处理过后的版本。

## 特殊语法

最后，在回答中可以使用一些特殊语法：

- **$$**：一个普通的 $ 字符
- **$0**：收到的原文本
- **$n**：分条发送
- **$A**：@所有人
- **$a**：@说话人
- **$m**：@机器人
- **$s**：说话人的名字

下面是一个简单的例子：

<chat-panel>
<chat-message nickname="Alice"># 你好啊 $s，你好啊~</chat-message>
<chat-message nickname="Koishi">问答已添加，编号为 1003。</chat-message>
<chat-message nickname="Alice">你好啊！</chat-message>
<chat-message nickname="Koishi">Alice，你好啊~</chat-message>
</chat-panel>

## 管道操作

可以使用 `## 查询内容 | 修改操作` 来进行问答的批量修改。它的功能是对查询到的每一个问答执行后面的修改操作。

例如：`## 摸摸 | -p 0.5` 将会把所有问题为摸摸的问答的概率修改为 0.5。

当然，如果查询到的问答没有足够的修改权限，还是会提示无法修改的。

## 查询近期操作

可以使用 `## -v` 来查询近期的教学操作：

<chat-panel>
<chat-message nickname="Alice">## -v</chat-message>
<chat-message nickname="Koishi">1003. [添加-25s] 问题：你好啊，回答：$s，你好啊~</chat-message>
</chat-panel>

或者使用 `#id -v` 来查看特定问答近期的教学操作（这里会显示修改前的版本）：

<chat-panel>
<chat-message nickname="Alice">#1001 -v</chat-message>
<chat-message nickname="Koishi">编号为 1001 的问答信息：<br>问题：foo<br>回答：bar<br>修改于：15 秒前</chat-message>
</chat-panel>

## 回退近期操作

可以使用 `#id -V` 来回退特定问答近期的教学操作：

<chat-panel>
<chat-message nickname="Alice">#1001 -V</chat-message>
<chat-message nickname="Koishi">问答 1001 已回退完成。</chat-message>
<chat-message nickname="Alice">foo</chat-message>
<chat-message nickname="Koishi">bar</chat-message>
</chat-panel>
