---
sidebarDepth: 2
---

# 扩展事件

## 基础事件

### dialogue/execute

### dialogue/before-execute

## 触发相关

### dialogue/before-search

### dialogue/receive

### dialogue/query

- **test:** `DialogueTest` 条件对象
- **query:** `Query` 查询对象
- **触发方式:** emit

将条件信息转化为 minato 可用的查询对象。

## 显示相关

### dialogue/abstract

- **dialogue:** `Dialogue` 问答对象
- **output:** `Output` 摘要对象
- **session:** `Session` 会话对象
- **触发方式:** emit

渲染问答的摘要信息。

### dialogue/detail

- **dialogue:** `Dialogue` 问答对象
- **output:** `string[]` 细节信息
- **session:** `Session` 会话对象
- **触发方式:** emit

渲染问答的细节信息。

### dialogue/appendix

## 操作相关

### dialogue/permit

### dialogue/modify

### dialogue/after-modify
