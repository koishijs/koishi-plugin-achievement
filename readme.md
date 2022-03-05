# koishi-plugin-achievement [WIP]
 
[![npm](https://img.shields.io/npm/v/koishi-plugin-achievement?style=flat-square)](https://www.npmjs.com/package/koishi-plugin-achievement)

基于 Koishi 的成就系统。

> 注意：此插件需要依赖数据库服务运行。

## 基本用法

这是一个基础插件，它提供了名为 achievement 的服务。其他插件可以使用此服务注册不同的成就，并通过事件系统在期望的时机触发成就。

下面将以猜数字游戏为例，介绍成就系统的注册方法。

### 注册成就

```ts
export const using = ['achievement'] as const

export function apply(ctx: Context) {
  ctx.achievement.register({
    // 成就的唯一标识符
    id: 'guess-number.quick',
    // 用于显示的成就名称
    name: '预言家',
    // 成就的描述文本
    desc: '在一局猜数字游戏中在 3 步之内猜对结果。',
  })
}
```

### 隐藏成就

默认情况下未取得的成就的名称和描述都是可见的。如果想要设计隐藏成就，我们提供了两种方案。

1. 如果想要隐藏整个成就，可以使用 `hidden` 选项。被隐藏的成就不会显示在成就列表中，也无法用成就名查看。当用户使用 `-A` 选项查看未获得的成就时，成就名将会显示为 `????`。
2. 如果想要隐藏成就的描述，可以使用 `hint` 选项。当成就未被取得时，成就描述将被替换为 `hint` 中定义的文本。

### 成就进度

如果想在未取得成就的状态下显示获取进度，可以使用 `progress` 选项。它应该是一个函数，接收一个用户对象，返回一个 0~1 之间的进度值。这个回调函数所需的用户字段可以使用 `userFields` 参数指定。

## 配置项
